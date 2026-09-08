/**
 * Restore a canonical D1 snapshot (theory/practical/hall + history) onto
 * the client preview D1 or the temporary Worker D1.
 *
 *   npm run staging:restore
 *
 * Snapshot search order: CANONICAL_BACKUP, .data/uat-temporary-canonical.json,
 * fixtures/staging-canonical-d1.json, then .json.gz / .json.gz.b64.
 * Does not invent Access maps or promote production. R2 stays unbound
 * unless the destination already has FILES.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createSqliteClient } from "../worker/src/db/client.ts";
import { applyMigrations } from "../worker/src/db/migrate.ts";
import {
  countMaster,
  transactionalRestore,
  validateBackupPayload,
  type BackupPayload,
} from "../worker/src/db/repos.ts";
import {
  createD1HttpClient,
  findCanonicalBackup,
  readCanonicalBackupText,
  resolveD1HttpTarget,
} from "./d1-http-client.ts";

const ROOT = process.cwd();
const CHUNK_BYTES = 40_000;

function dumpInserts(sqlitePath: string): string[] {
  const dump = spawnSync("sqlite3", [sqlitePath, ".dump"], {
    encoding: "utf8",
    maxBuffer: 20_000_000,
  });
  if (dump.status !== 0) {
    throw new Error(dump.stderr || "sqlite3 .dump failed");
  }
  return dump.stdout
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return (
        t.startsWith("INSERT INTO ") &&
        !/INSERT INTO ["']?sqlite_/i.test(t) &&
        !/INSERT INTO ["']?_migrations/i.test(t)
      );
    })
    .map((line) => line.replace(/^INSERT INTO /, "INSERT OR REPLACE INTO "));
}

function sqlChunks(inserts: string[]): string[] {
  const tables = [
    ...new Set(
      inserts.flatMap((line) => {
        const m = line.match(/^INSERT OR REPLACE INTO ["']?([A-Za-z0-9_]+)/);
        return m?.[1] ? [m[1]] : [];
      }),
    ),
  ];
  const prelude = [
    "PRAGMA defer_foreign_keys = TRUE;",
    ...tables.map((t) => `DELETE FROM ${t};`),
  ];
  const chunks: string[] = [prelude.join("\n")];
  let buf = "";
  for (const line of inserts) {
    const next = buf ? `${buf}\n${line}` : line;
    if (next.length > CHUNK_BYTES && buf) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export function buildRestoreSql(inserts: string[]): string[] {
  return sqlChunks(inserts);
}

async function main() {
  const snapshot = findCanonicalBackup(ROOT);
  if (!snapshot) {
    console.warn(
      "staging:restore skipped — no canonical snapshot. Run npm run staging:temporary:backup or set CANONICAL_BACKUP.",
    );
    process.exit(0);
  }
  const payload = JSON.parse(readCanonicalBackupText(snapshot)) as BackupPayload;
  const valid = validateBackupPayload(payload);
  if (!valid.ok) throw new Error(`snapshot invalid: ${valid.error}`);

  const target = resolveD1HttpTarget();
  const remote = createD1HttpClient(target);
  const dir = mkdtempSync(join(tmpdir(), "edas-d1-restore-"));
  const sqlitePath = join(dir, "restore.sqlite");
  try {
    const sqlite = new Database(sqlitePath);
    const local = createSqliteClient(sqlite);
    await applyMigrations(local, ROOT);
    const restored = await transactionalRestore(local, payload, {
      adminConfirmed: true,
      includeHistory: true,
    });
    if (!restored.ok) throw new Error(restored.error);
    const localCounts = await countMaster(local);
    sqlite.close();
    const inserts = dumpInserts(sqlitePath);
    const chunks = buildRestoreSql(inserts);
    for (const [i, chunk] of chunks.entries()) {
      process.stdout.write(`restore chunk ${i + 1}/${chunks.length} (${chunk.length} bytes)\n`);
      await remote.exec(chunk);
    }
    const remoteCounts = await countMaster(remote);
    const evidence = {
      checkedAt: new Date().toISOString(),
      ok:
        remoteCounts.teachers === localCounts.teachers &&
        remoteCounts.history === localCounts.history,
      kind: "cloudflare-d1-canonical-restore",
      snapshot,
      source: target.source,
      databaseId: target.databaseId,
      localCounts,
      remoteCounts,
      inserts: inserts.length,
      chunks: chunks.length,
      note: "Restored onto live D1 via HTTP. Not Pages/Access/OQ-010. Production was not promoted.",
    };
    mkdirSync(join(ROOT, ".data"), { recursive: true });
    writeFileSync(
      join(ROOT, ".data/uat-restore-latest.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    console.log(JSON.stringify(evidence));
    if (!evidence.ok) process.exit(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isDirect =
  process.argv[1] !== undefined &&
  process.argv[1].includes("d1-restore-canonical");
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
