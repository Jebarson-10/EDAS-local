/**
 * Apply schema + reference seeds to a remote Cloudflare D1 database.
 * Requires wrangler auth and a real database_id in wrangler.toml.
 *
 * Usage:
 *   npm run db:migrate:remote -- --env staging
 *   WRANGLER_CONFIG=./wrangler.toml npm run db:migrate:remote
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const migrationsDir = join(ROOT, "database/migrations");
const seed = join(ROOT, "database/seeds/001_reference_data.sql");
const config = process.env.WRANGLER_CONFIG ?? join(ROOT, "wrangler.toml");

if (!existsSync(migrationsDir) || !existsSync(seed)) {
  console.error("Missing migration or seed SQL under database/");
  process.exit(1);
}

const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => join(migrationsDir, f));

const extra = process.argv.slice(2);
const base = [
  "d1",
  "execute",
  "erode-exam-duty",
  "--remote",
  "--config",
  config,
  ...extra,
];

function run(file: string) {
  const args = [...base, "--file", file];
  console.log("wrangler", args.join(" "));
  const r = spawnSync("npx", ["wrangler", ...args], {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });
  if (r.status !== 0) {
    console.error(
      "Remote D1 migrate failed. Bind a real database_id in wrangler.toml and run `npx wrangler login` (client Cloudflare account).",
    );
    process.exit(r.status ?? 1);
  }
}

for (const file of migrationFiles) {
  run(file);
}
run(seed);
console.log(
  "Remote D1 migrate OK (",
  migrationFiles.length,
  "migrations + seed)",
);
