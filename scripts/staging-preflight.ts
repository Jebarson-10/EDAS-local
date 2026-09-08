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
run("check:bindings (report)", "npm", ["run", "check:bindings"]);
// Strict env gate documents blocker; expect fail until client fills REPLACE_ME
const bindStatus = run(
  "check:bindings --env staging (expect fail until D1/R2 ids)",
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
console.log("\n=== pages /api routes file present ===");
console.log(routes);

console.log("\nstaging:preflight complete.");
if (bindStatus !== 0) {
  console.log(
    "NOTE: Cloudflare D1/R2 bindings still REPLACE_ME — §107 staging deploy blocked until client fills ids (expected).",
  );
} else {
  console.log(
    "Binding gate green — proceed to wrangler login + db:migrate:remote.",
  );
}
