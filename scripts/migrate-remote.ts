/**
 * Apply schema + reference seeds to a remote Cloudflare D1 database.
 * Requires wrangler auth and a real database_id in wrangler.toml.
 *
 * Usage:
 *   npm run db:migrate:remote -- --env staging
 *   npm run db:migrate:remote -- --env production
 *   WRANGLER_CONFIG=./wrangler.toml npm run db:migrate:remote -- --env staging
 *
 * Product staging uses wrangler --env preview (Pages constraint).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractEnvSection,
  isD1BindingReady,
  uncommentedD1DatabaseName,
  wranglerEnvFor,
} from "./wrangler-env.ts";

const ROOT = process.cwd();
const migrationsDir = join(ROOT, "database/migrations");
const seed = join(ROOT, "database/seeds/001_reference_data.sql");
const config = process.env.WRANGLER_CONFIG ?? join(ROOT, "wrangler.toml");

if (!existsSync(migrationsDir) || !existsSync(seed)) {
  console.error("Missing migration or seed SQL under database/");
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const extra: string[] = [];
  let productEnv: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env" && argv[i + 1]) {
      productEnv = argv[++i];
      continue;
    }
    extra.push(argv[i]!);
  }
  return { extra, productEnv };
}

const { extra, productEnv } = parseArgs(process.argv.slice(2));
let wranglerEnv: ReturnType<typeof wranglerEnvFor>;
try {
  wranglerEnv = wranglerEnvFor(productEnv);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}

const toml = readFileSync(config, "utf8");
const section = extractEnvSection(toml, wranglerEnv);
if (!section || !isD1BindingReady(section)) {
  console.error(
    `Remote D1 migrate blocked: ${config} [env.${wranglerEnv}] D1 is commented or still REPLACE_ME.`,
  );
  console.error(
    "Run `npm run staging:raise` with CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, or paste a real database_id.",
  );
  process.exit(1);
}

const databaseName = uncommentedD1DatabaseName(section);
if (!databaseName) {
  console.error(`No uncommented database_name in [env.${wranglerEnv}] of ${config}`);
  process.exit(1);
}

const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => join(migrationsDir, f));

const base = [
  "d1",
  "execute",
  databaseName,
  "--remote",
  "--env",
  wranglerEnv,
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
      "Remote D1 migrate failed. Need a client Cloudflare account token and a real database_id.",
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
  "migrations + seed) on",
  databaseName,
  `(wrangler env ${wranglerEnv})`,
);
