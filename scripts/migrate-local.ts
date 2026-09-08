/**
 * Apply D1-shaped migrations to the local SQLite file used by npm run api:local.
 * Usage: npm run db:migrate:local
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createSqliteClient } from "../worker/src/db/client.ts";
import { applyMigrations } from "../worker/src/db/migrate.ts";

async function main() {
  const ROOT = process.cwd();
  const DATA_DIR = join(ROOT, ".data");
  const DB_PATH = join(DATA_DIR, "erode-exam-duty.sqlite");

  mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("foreign_keys = ON");
  const db = createSqliteClient(sqlite);
  await applyMigrations(db, ROOT);
  console.log("Migrations applied:", DB_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
