/**
 * Gate the standalone app server: one port serving the built UI + API + SQLite,
 * which is exactly what the desktop executable runs.
 *
 * Asserts a fresh data directory bootstraps itself, SPA deep links fall back to
 * index.html, the API answers on the same origin, and path traversal cannot
 * read outside the asset root.
 *
 * Usage: npm run check:app   (needs npm run app:build first)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const bundle = resolve(root, "desktop/dist/api-server.cjs");
const staticDir = resolve(root, "desktop/ui");
const port = Number(process.env.APP_CHECK_PORT ?? 43128);
const base = `http://127.0.0.1:${port}`;

if (!existsSync(bundle) || !existsSync(join(staticDir, "index.html"))) {
  console.error("check:app needs a build first — run: npm run app:build");
  process.exit(2);
}

const dataDir = mkdtempSync(join(tmpdir(), "exam-app-check-"));
const child = spawn(process.execPath, [bundle], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    API_PORT: String(port),
    API_HOST: "127.0.0.1",
    APP_STATIC_DIR: staticDir,
    APP_RESOURCE_DIR: root,
    APP_DATA_DIR: dataDir,
  },
});

let log = "";
child.stdout.on("data", (c: Buffer) => (log += c.toString()));
child.stderr.on("data", (c: Buffer) => (log += c.toString()));

const problems: string[] = [];

function cleanup() {
  if (!child.killed) child.kill();
  rmSync(dataDir, { recursive: true, force: true });
}

async function waitForReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (/APP_READY /.test(log)) return true;
    if (child.exitCode !== null) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  if (!(await waitForReady(60_000))) {
    cleanup();
    console.error(`check:app FAILED — server never became ready.\n${log.slice(-2000)}`);
    process.exit(1);
  }

  const health = await fetch(`${base}/api/health`).then((r) => r.json() as Promise<Record<string, unknown>>);
  if (health.dbOk !== true) {
    problems.push(`fresh data dir did not bootstrap (dbOk=${String(health.dbOk)})`);
  }
  const counts = (health.counts ?? {}) as Record<string, number>;
  if (!(counts.teachers > 0)) {
    problems.push("demo seed did not land in a fresh database");
  }
  if (String(health.dbPath ?? "").startsWith(root)) {
    problems.push("APP_DATA_DIR was ignored — the database landed in the checkout");
  }

  const index = await fetch(base);
  if (!(index.headers.get("content-type") ?? "").includes("html")) {
    problems.push("/ did not serve the built SPA");
  }

  // Client-routed deep links must not 404 in the packaged app.
  const deep = await fetch(`${base}/master`);
  if (deep.status !== 200 || !(deep.headers.get("content-type") ?? "").includes("html")) {
    problems.push(`SPA deep link /master returned ${deep.status}`);
  }

  const traversal = await fetch(`${base}/../../../../etc/passwd`);
  const traversalBody = await traversal.text();
  if (traversalBody.includes("root:")) {
    problems.push("static serving escaped the asset root");
  }

  // The API must still own /api/* even with static serving enabled.
  const unknownApi = await fetch(`${base}/api/does-not-exist`);
  if (unknownApi.status !== 404) {
    problems.push(`/api/does-not-exist returned ${unknownApi.status}, expected 404`);
  }

  cleanup();

  if (problems.length) {
    console.error("check:app FAILED:");
    for (const p of problems) console.error(` - ${p}`);
    process.exit(1);
  }

  console.log(
    `check:app OK — fresh install bootstrapped SQLite (${counts.teachers} teachers), served the SPA and API on ${base}, deep links fall back, traversal blocked.`,
  );
  process.exit(0);
}

void main().catch((e) => {
  cleanup();
  console.error(e);
  process.exit(1);
});
