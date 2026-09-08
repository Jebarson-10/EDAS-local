import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createD1HttpClient,
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
