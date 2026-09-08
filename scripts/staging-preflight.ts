/**
 * Single gate for inventable staging readiness checks (no live CF required until bindings filled).
 *   npm run staging:preflight
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function run(label: string, cmd: string, args: string[], allowFail = false) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: false });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0 && !allowFail) {
    console.error(`\nstaging:preflight FAILED at: ${label}`);
    process.exit(r.status ?? 1);
  }
  return r.status ?? 0;
}

run("check:routes", "npm", ["run", "check:routes"]);
run("check:pages", "npm", ["run", "check:pages"]);
run("check:bindings (report)", "npm", ["run", "check:bindings"]);
// Strict env gate documents blocker; expect fail until client fills REPLACE_ME
const bindStatus = run(
  "check:bindings --env staging (expect fail until preview D1 id)",
  "npm",
  ["run", "check:bindings", "--", "--env", "staging"],
  true,
);
run("typecheck", "npm", ["run", "typecheck"]);
run("test", "npm", ["test"]);
run("e2e:cycle", "npm", ["run", "e2e:cycle"]);
run("uat:local", "npm", ["run", "uat:local"]);

// UI gates need a live dev server; skip cleanly rather than fail the whole gate.
const uiUp =
  spawnSync("curl", ["-sf", "-o", "/dev/null", "http://127.0.0.1:43123/"], {
    shell: false,
  }).status === 0;
if (uiUp) {
  run("smoke:ui", "npm", ["run", "smoke:ui"]);
  run("check:responsive", "npm", ["run", "check:responsive"]);
} else {
  console.log(
    "\n=== smoke:ui / check:responsive skipped (no dev server on 43123) ===",
  );
}

const routes = resolve(root, "frontend/public/_routes.json");
if (!existsSync(routes)) {
  console.error("Missing frontend/public/_routes.json");
  process.exit(1);
}

// The desktop executable runs this same server, so gate the offline install too.
// It builds into desktop/ui, leaving frontend/dist as the hosted Pages bundle.
run("app:build", "npm", ["run", "app:build"]);
run("check:app (standalone one-port install)", "npm", ["run", "check:app"]);

// Miniflare runs the same wrangler.toml, functions/ and D1 binding a deploy
// uses, so this is the strongest staging evidence available without an account.
run("check:pages:dev (Pages pipeline + D1 via Miniflare)", "npm", [
  "run",
  "check:pages:dev",
]);

console.log("\nstaging:preflight complete.");
if (bindStatus !== 0) {
  console.log(
    "NOTE: Cloudflare Pages preview D1 still REPLACE_ME — §107 staging deploy blocked until CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (npm run staging:raise) or a real database_id in [env.preview] (expected).",
  );
} else {
  console.log(
    "Binding gate green — proceed to wrangler login + db:migrate:remote.",
  );
}
