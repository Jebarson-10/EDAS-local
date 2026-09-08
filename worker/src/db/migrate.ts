import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DbClient } from "./client.js";

/**
 * Apply SQL migrations in filename order, then reference seeds once.
 * Existing DBs that already recorded `001_initial_schema` skip re-running it;
 * newer files (e.g. `002_…`) apply on next boot.
 */
export async function applyMigrations(
  db: DbClient,
  rootDir = process.cwd(),
): Promise<void> {
  await db.exec?.(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );`,
  );
  await db.exec?.("PRAGMA foreign_keys = ON;");

  const migrationsDir = join(rootDir, "database/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/i, "");
    const existing = await db
      .prepare("SELECT id FROM _migrations WHERE id = ?")
      .bind(id)
      .first<{ id: string }>();
    if (existing) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await db.exec?.(sql.replace(/^PRAGMA foreign_keys = ON;\s*/m, ""));
    await db
      .prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)")
      .bind(id, new Date().toISOString())
      .run();
  }

  const seedFile = join(rootDir, "database/seeds/001_reference_data.sql");
  const seedId = "001_reference_data";
  const seeded = await db
    .prepare("SELECT id FROM _migrations WHERE id = ?")
    .bind(seedId)
    .first<{ id: string }>();
  if (!seeded) {
    const seedSql = readFileSync(seedFile, "utf8");
    await db.exec?.(seedSql);
    await db
      .prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)")
      .bind(seedId, new Date().toISOString())
      .run();
  }
}
