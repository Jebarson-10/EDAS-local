/**
 * Prove the Cloudflare Pages pipeline end to end without a Cloudflare account.
 *
 * Runs `wrangler pages dev` (Miniflare) against wrangler.toml, so the same
 * pages_build_output_dir, /api/* routing, functions/api/[[path]].ts adapter and
 * D1 binding a real deploy uses are exercised locally. A green run means the
 * deploy layout is correct; only the live account/ids stay client-blocked.
 *
 * Usage: npm run check:pages:dev
 * Evidence: .data/pages-dev-latest.json
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { createSqliteClient } from "../worker/src/db/client.ts";
import { applyMigrations } from "../worker/src/db/migrate.ts";

const root = resolve(import.meta.dirname, "..");
const persistTo = resolve(root, ".wrangler/pages-dev-check");
const d1Name = "erode-exam-duty-check";

/** A fixed port turns any stray listener into a 90s timeout with no diagnosis. */
function freePort(): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const probe = createServer();
    probe.on("error", rejectP);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const chosen = typeof address === "object" && address ? address.port : 0;
      probe.close(() =>
        chosen ? resolveP(chosen) : rejectP(new Error("no free port")),
      );
    });
  });
}

let port = 0;
let base = "";

function record(result: Record<string, unknown>) {
  const dir = resolve(root, ".data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "pages-dev-latest.json"),
    `${JSON.stringify({ checkedAt: new Date().toISOString(), port, ...result }, null, 2)}\n`,
  );
}

async function waitForJson(
  path: string,
  timeoutMs: number,
): Promise<{ status: number; contentType: string; body: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { accept: "application/json" },
      });
      const body = await res.text();
      return {
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body,
      };
    } catch {
      await new Promise((r) => setTimeout(r, 750));
    }
  }
  return null;
}

/** Miniflare names its D1 file by a content hash, so pick it up by scanning. */
function miniflareD1File(): string | null {
  const dir = resolve(persistTo, "v3/d1/miniflare-D1DatabaseObject");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".sqlite") && f !== "metadata.sqlite",
  );
  return files.length === 1 ? resolve(dir, files[0]!) : null;
}

async function main() {
  port = Number(process.env.PAGES_DEV_PORT ?? 0) || (await freePort());
  base = `http://127.0.0.1:${port}`;

  if (!existsSync(resolve(root, "frontend/dist/index.html"))) {
    console.log("Building frontend/dist first…");
    const build = spawnSync("npm", ["run", "pages:build"], {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    if (build.status !== 0) {
      record({ ok: false, error: "pages:build failed" });
      process.exit(1);
    }
  }

  const child = spawn(
    "npx",
    [
      "wrangler",
      "pages",
      "dev",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--d1",
      `DB=${d1Name}`,
      "--persist-to",
      persistTo,
    ],
    // Own process group: wrangler spawns workerd children that survive a
    // SIGTERM aimed at the parent alone and keep holding their ports.
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: false, detached: true },
  );

  const stopServer = () => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  };
  process.on("exit", stopServer);
  let log = "";
  child.stdout.on("data", (c: Buffer) => (log += c.toString()));
  child.stderr.on("data", (c: Buffer) => (log += c.toString()));

  const fail = (error: string, extra: Record<string, unknown> = {}) => {
    stopServer();
    record({ ok: false, error, ...extra, wranglerLog: log.slice(-4000) });
    console.error(`check:pages:dev FAILED — ${error}`);
    process.exit(1);
  };

  // First probe also forces Miniflare to materialise the D1 store.
  const first = await waitForJson("/api/health", 90_000);
  if (!first) fail("wrangler pages dev never answered /api/health");
  if (!first!.contentType.includes("json")) {
    fail(
      "/api/health returned the SPA shell, not the Worker — functions/api/[[path]].ts is not being deployed",
      { status: first!.status, contentType: first!.contentType },
    );
  }

  const dbFile = miniflareD1File();
  if (!dbFile) fail("could not locate the Miniflare D1 store to migrate");
  const sqlite = new Database(dbFile!);
  const db = createSqliteClient(sqlite);
  await applyMigrations(db, root);
  sqlite.close();

  const second = await waitForJson("/api/health", 20_000);
  if (!second) fail("/api/health stopped answering after migration");
  let health: Record<string, unknown> = {};
  try {
    health = JSON.parse(second!.body) as Record<string, unknown>;
  } catch {
    fail("/api/health returned invalid JSON after migration");
  }
  if (health.dbOk !== true) {
    fail(`D1 binding not usable through Pages (dbOk=${String(health.dbOk)})`, {
      health,
    });
  }

  const spa = await fetch(base).then((r) => ({
    status: r.status,
    contentType: r.headers.get("content-type") ?? "",
  }));
  if (!spa.contentType.includes("html")) {
    fail("/ did not serve the built SPA", spa);
  }

  stopServer();
  record({ ok: true, health, spa, d1Store: dbFile });
  console.log(
    "check:pages:dev OK — Pages pipeline served /api/health from the Worker with a working D1 binding, and / from frontend/dist.",
  );
  console.log(
    `r2Ok=${String(health.r2Ok)} (FILES unbound is the honest local state) · evidence: .data/pages-dev-latest.json`,
  );
  process.exit(0);
}

void main();
