/**
 * Report / gate Cloudflare binding readiness in wrangler.toml files.
 *
 * Usage:
 *   npm run check:bindings                  # report placeholders; exit 0 (CI-safe)
 *   npm run check:bindings -- --strict      # exit 1 if any REPLACE_ME remains
 *   npm run check:bindings -- --env staging # exit 1 if staging D1/R2 not ready
 *   npm run check:bindings -- --env production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = [
  resolve(root, "wrangler.toml"),
  resolve(root, "worker/wrangler.toml"),
];

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const envIdx = args.indexOf("--env");
const onlyEnv = envIdx >= 0 ? args[envIdx + 1] : null;

let blocked = false;

for (const file of files) {
  const text = readFileSync(file, "utf8");

  if (!onlyEnv) {
    const replaceHits = [...text.matchAll(/REPLACE_ME[A-Z0-9_]*/g)].map(
      (m) => m[0],
    );
    const unique = [...new Set(replaceHits)];
    if (unique.length) {
      blocked = true;
      console.log(
        `[${file}] §107 blocked — placeholders: ${unique.join(", ")}`,
      );
    } else {
      console.log(`[${file}] no REPLACE_ME placeholders`);
    }
    continue;
  }

  const envMarker =
    onlyEnv === "staging"
      ? "[env.staging]"
      : onlyEnv === "production"
        ? "[env.production]"
        : null;
  if (!envMarker) {
    console.error(`Unknown --env ${onlyEnv} (use staging|production)`);
    process.exit(2);
  }
  const start = text.indexOf(envMarker);
  if (start < 0) {
    blocked = true;
    console.error(`[${file}] missing ${envMarker} section`);
    continue;
  }
  const nextEnv = text.indexOf("\n[env.", start + envMarker.length);
  const section = text.slice(start, nextEnv < 0 ? undefined : nextEnv);
  const sectionHits = [...section.matchAll(/REPLACE_ME[A-Z0-9_]*/g)].map(
    (m) => m[0],
  );
  const uncommentedD1 = /^\s*\[\[env\.[^\]]+\.d1_databases\]\]/m.test(section);
  const hasReplace = sectionHits.length > 0;

  if (hasReplace || !uncommentedD1) {
    blocked = true;
    console.error(
      `[${file}] ${onlyEnv}: D1/R2 bindings not ready (placeholders or still commented)`,
    );
  } else {
    console.log(
      `[${file}] ${onlyEnv}: binding blocks present without REPLACE_ME`,
    );
  }
}

if (blocked) {
  console.log(
    "\nBinding check: NOT READY for live Cloudflare staging/production (§107).",
  );
  console.log(
    "Client must set real D1 database_id + R2 bucket, then: npm run check:bindings -- --env staging",
  );
  if (strict || onlyEnv) {
    process.exit(1);
  }
  process.exit(0);
}

console.log("\ncheck:bindings OK.");
