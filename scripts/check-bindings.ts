/**
 * Report / gate Cloudflare binding readiness in wrangler.toml files.
 *
 * Usage:
 *   npm run check:bindings                  # report placeholders; exit 0 (CI-safe)
 *   npm run check:bindings -- --strict      # exit 1 if any REPLACE_ME remains
 *   npm run check:bindings -- --env staging # exit 1 if Pages preview D1 not ready
 *   npm run check:bindings -- --env production
 *
 * Product staging = Cloudflare Pages [env.preview]. R2 is optional
 * (unbound FILES is an honest stored:false path).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertPagesTomlHasNoStagingEnv,
  extractEnvSection,
  isD1BindingReady,
  wranglerEnvFor,
} from "./wrangler-env.ts";

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

const pagesToml = readFileSync(files[0]!, "utf8");
try {
  assertPagesTomlHasNoStagingEnv(pagesToml);
} catch (e) {
  blocked = true;
  console.error(e instanceof Error ? e.message : e);
}

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

  let wranglerEnv: ReturnType<typeof wranglerEnvFor>;
  try {
    wranglerEnv = wranglerEnvFor(onlyEnv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  }

  const section = extractEnvSection(text, wranglerEnv);
  if (!section) {
    blocked = true;
    console.error(`[${file}] missing [env.${wranglerEnv}] section`);
    continue;
  }

  if (!isD1BindingReady(section)) {
    blocked = true;
    console.error(
      `[${file}] ${onlyEnv} (wrangler env ${wranglerEnv}): D1 not ready (commented or REPLACE_ME). R2/FILES is optional.`,
    );
  } else {
    console.log(
      `[${file}] ${onlyEnv} (wrangler env ${wranglerEnv}): D1 binding present without REPLACE_ME`,
    );
  }
}

if (blocked) {
  console.log(
    "\nBinding check: NOT READY for live Cloudflare staging/production (§107).",
  );
  console.log(
    "Set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID and run `npm run staging:raise`,",
  );
  console.log(
    "or paste a real D1 database_id into [env.preview] then: npm run check:bindings -- --env staging",
  );
  if (strict || onlyEnv) {
    process.exit(1);
  }
  process.exit(0);
}

console.log("\ncheck:bindings OK.");
