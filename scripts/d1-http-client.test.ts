import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import {
  canonicalBackupCandidates,
  createD1HttpClient,
  readCanonicalBackupText,
  readTemporaryAccount,
  resolveD1HttpTarget,
} from "./d1-http-client.ts";
import { buildRestoreSql } from "./d1-restore-canonical.ts";

describe("D1 HTTP client", () => {
  it("runs bound SELECT queries through the Cloudflare D1 HTTP API", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = createD1HttpClient({
      accountId: "acct",
      databaseId: "dbid",
      apiToken: "tok",
      fetchImpl: async (input, init) => {
        expect(String(input)).toContain("/accounts/acct/d1/database/dbid/query");
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer tok",
        );
        const body = JSON.parse(String(init?.body)) as {
          sql: string;
          params: unknown[];
        };
        calls.push(body);
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ results: [{ n: 120 }], success: true }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM teachers WHERE 1 = ?")
      .bind(1)
      .first<{ n: number }>();
    expect(row?.n).toBe(120);
    expect(calls).toEqual([
      { sql: "SELECT COUNT(*) AS n FROM teachers WHERE 1 = ?", params: [1] },
    ]);
  });

  it("reads wrangler temporary-account toml without inventing fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "edas-tmp-acct-"));
    const file = join(dir, "wrangler-temporary-account.toml");
    writeFileSync(
      file,
      `[account]\nid = "abc123"\nname = "Early Kidney"\napiToken = "cfat_test"\n`,
    );
    expect(readTemporaryAccount(file)).toEqual({
      accountId: "abc123",
      apiToken: "cfat_test",
    });
  });

  it("prefers client env credentials over the temporary account", () => {
    const target = resolveD1HttpTarget({
      env: {
        CLOUDFLARE_API_TOKEN: "cfat_client",
        CLOUDFLARE_ACCOUNT_ID: "acct-client",
        CF_D1_PREVIEW_ID: "11111111-2222-3333-4444-555555555555",
      } as NodeJS.ProcessEnv,
      cwd: "/tmp/does-not-exist",
      readFile: () => {
        throw new Error("should not read files when env is complete");
      },
    });
    expect(target).toEqual({
      accountId: "acct-client",
      databaseId: "11111111-2222-3333-4444-555555555555",
      apiToken: "cfat_client",
      source: "client-env",
    });
  });

  it("batches statement runs in order", async () => {
    const sqls: string[] = [];
    const db = createD1HttpClient({
      accountId: "acct",
      databaseId: "dbid",
      apiToken: "tok",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { sql: string };
        sqls.push(body.sql);
        return new Response(
          JSON.stringify({ success: true, result: [{ success: true, results: [] }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    await db.batch?.([
      db.prepare("DELETE FROM teachers"),
      db.prepare("INSERT INTO teachers (teacher_id) VALUES ('t1')"),
    ]);
    expect(sqls).toEqual([
      "DELETE FROM teachers",
      "INSERT INTO teachers (teacher_id) VALUES ('t1')",
    ]);
  });
});

describe("canonical snapshot files", () => {
  it("lists gzip encodings after the uncompressed json path", () => {
    const paths = canonicalBackupCandidates("/tmp/edas-snap");
    const json = paths.indexOf("/tmp/edas-snap/fixtures/staging-canonical-d1.json");
    const gz = paths.indexOf("/tmp/edas-snap/fixtures/staging-canonical-d1.json.gz");
    const b64 = paths.indexOf(
      "/tmp/edas-snap/fixtures/staging-canonical-d1.json.gz.b64",
    );
    expect(json).toBeGreaterThanOrEqual(0);
    expect(gz).toBeGreaterThan(json);
    expect(b64).toBeGreaterThan(gz);
  });

  it("inflates gzip and gzip+base64 snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "edas-snap-"));
    const body = JSON.stringify({ teachers: [{ teacherId: "t1" }], history: [] });
    const gz = gzipSync(Buffer.from(body, "utf8"));
    const gzPath = join(dir, "snap.json.gz");
    const b64Path = join(dir, "snap.json.gz.b64");
    writeFileSync(gzPath, gz);
    writeFileSync(b64Path, gz.toString("base64"));
    expect(readCanonicalBackupText(gzPath)).toBe(body);
    expect(readCanonicalBackupText(b64Path)).toBe(body);
  });
});

describe("canonical restore SQL", () => {
  it("deletes dumped tables then inserts in chunks", () => {
    const chunks = buildRestoreSql([
      'INSERT OR REPLACE INTO teachers VALUES (1);',
      'INSERT OR REPLACE INTO schools VALUES (2);',
    ]);
    expect(chunks[0]).toMatch(/DELETE FROM teachers/);
    expect(chunks[0]).toMatch(/DELETE FROM schools/);
    expect(chunks.join("\n")).toMatch(/INSERT OR REPLACE INTO teachers/);
  });
});
