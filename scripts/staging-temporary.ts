/**
 * Raise a 60-minute Cloudflare temporary account (Workers + D1 + static assets).
 *
 * Pages is not available on temporary accounts. This path is the evidence we can
 * produce without CLOUDFLARE_API_TOKEN: a live workers.dev Worker bound to a
 * real D1, schema-migrated, with /api/health.dbOk.
 *
 * Does not invent OQ-010 roles, does not bind R2, does not promote production.
 *
 *   npm run staging:temporary
 *
 * Claim URL is written to .data/uat-temporary-latest.json (gitignored).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { countMaster } from "../worker/src/db/repos.ts";
import { bootstrapTemporaryAccount } from "./bootstrap-temporary-account.ts";
import { createD1HttpClient, readTemporaryAccount } from "./d1-http-client.ts";

const ROOT = process.cwd();
const DATA = join(ROOT, ".data");
const CONFIG = join(DATA, "wrangler.temporary.toml");
const EVIDENCE = join(DATA, "uat-temporary-latest.json");
const DB_NAME = process.env.CF_TEMP_D1_NAME ?? "erode-exam-duty";
const WORKER_NAME = "erode-exam-duty";

function record(result: Record<string, unknown>) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(
    EVIDENCE,
    `${JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2)}\n`,
  );
}

function wranglerBin(): string {
  const local = join(ROOT, "node_modules", ".bin", "wrangler");
  return existsSync(local) ? local : "wrangler";
}

function wrangler(
  args: string[],
  extra?: { input?: string; temporary?: boolean; allowFail?: boolean },
) {
  const bin = wranglerBin();
  const all = [...args];
  if (extra?.temporary && !all.includes("--temporary")) all.push("--temporary");
  console.log(bin, all.join(" "));
  const env = { ...process.env };
  // --temporary must run unauthenticated. After bootstrap, inject the cfat_
  // token so later commands do not pass --temporary (OAuth leftovers 401).
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  if (!extra?.temporary) {
    try {
      const acct = readTemporaryAccount();
      env.CLOUDFLARE_API_TOKEN = acct.apiToken;
      env.CLOUDFLARE_ACCOUNT_ID = acct.accountId;
    } catch {
      // bootstrap has not written the temporary token yet
    }
  }
  const r = spawnSync(bin, all, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20_000_000,
    env,
    input: extra?.input,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0 && !extra?.allowFail) {
    console.error(out);
    throw new Error(`wrangler ${args.join(" ")} failed (exit ${r.status ?? 1})`);
  }
  process.stdout.write(out);
  return out;
}

function parseClaim(out: string) {
  const url =
    out.match(/Claim URL:\s+(\S+)/)?.[1] ??
    (() => {
      try {
        const text = readFileSync(
          join(homedir(), ".config/.wrangler/wrangler-temporary-account.toml"),
          "utf8",
        );
        return text.match(/^url\s*=\s*"([^"]+)"/m)?.[1] ?? null;
      } catch {
        return null;
      }
    })();
  const account =
    out.match(/Account:\s+(.+)/)?.[1]?.trim() ??
    (() => {
      try {
        const acct = readTemporaryAccount();
        return acct.accountId;
      } catch {
        return null;
      }
    })();
  const workers = out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0] ?? null;
  return { claimUrl: url, account, workersUrl: workers };
}

function parseDatabaseId(out: string): string | null {
  return out.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i)?.[1] ?? null;
}

function writeConfig(databaseId: string, databaseName: string) {
  mkdirSync(DATA, { recursive: true });
  const toml = `name = "${WORKER_NAME}"
main = "../worker/src/index.ts"
compatibility_date = "2026-03-01"
workers_dev = true

[vars]
ENVIRONMENT = "staging"
ALLOW_ANONYMOUS_VIEWER = "true"

[assets]
directory = "../frontend/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]

[[d1_databases]]
binding = "DB"
database_name = "${databaseName}"
database_id = "${databaseId}"
`;
  writeFileSync(CONFIG, toml);
}

function ensureFrontend() {
  const dist = join(ROOT, "frontend", "dist", "index.html");
  if (existsSync(dist)) return;
  console.log("=== building frontend ===");
  const r = spawnSync("npm", ["run", "build", "-w", "frontend"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) throw new Error("frontend build failed");
}

async function probeHealth(url: string) {
  const target = `${url.replace(/\/+$/, "")}/api/health`;
  try {
    const res = await fetch(target, { headers: { accept: "application/json" } });
    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (res.headers.get("cf-mitigated") === "challenge") {
      return {
        ok: false,
        challenged: true,
        status: res.status,
        target,
        note: "workers.dev served a managed challenge to this client; D1 evidence is the remote execute below.",
      };
    }
    if (!contentType.includes("json")) {
      return {
        ok: false,
        status: res.status,
        contentType,
        target,
        bodyHead: text.slice(0, 200),
      };
    }
    const health = JSON.parse(text) as Record<string, unknown>;
    return { ok: health.dbOk === true, status: res.status, target, health };
  } catch (e) {
    return {
      ok: false,
      target,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  ensureFrontend();
  const bootstrapOut = await bootstrapTemporaryAccount();

  let databaseId: string | null = null;
  let databaseName = DB_NAME;
  const listed = wrangler(["d1", "list", "--json"]);
  let existing: Array<{ name: string; uuid?: string }> = [];
  try {
    existing = JSON.parse(listed.slice(listed.indexOf("["))) as Array<{
      name: string;
      uuid?: string;
    }>;
  } catch {
    existing = [];
  }
  const named = existing.find((r) => r.name === DB_NAME);
  const anyDb = named ?? existing[0];
  if (anyDb?.uuid) {
    databaseId = anyDb.uuid;
    databaseName = anyDb.name;
    console.log(`reusing D1 ${databaseName} (${databaseId})`);
  }

  let createOut = "";
  if (!databaseId) {
    createOut = wrangler(["d1", "create", DB_NAME]);
    databaseId = parseDatabaseId(createOut);
    databaseName = DB_NAME;
  }
  if (!databaseId) {
    throw new Error("could not parse D1 database_id from wrangler d1 create");
  }
  writeConfig(databaseId, databaseName);

  const migrations = readdirSync(join(ROOT, "database/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(ROOT, "database/migrations", f));
  const seed = join(ROOT, "database/seeds/001_reference_data.sql");
  for (const file of [...migrations, seed]) {
    wrangler([
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--yes",
      "--file",
      file,
      "-c",
      CONFIG,
    ]);
  }

  wrangler([
    "d1",
    "execute",
    databaseName,
    "--remote",
    "--yes",
    "--command",
    "INSERT OR IGNORE INTO exam_cycles (exam_cycle_id, name, academic_year, status, rule_version_id, created_at, created_by) VALUES ('ec_2027_hsc', '2027 HSC Public Examination (Synthetic)', '2027', 'OPEN', 'rv-2027-1', '2026-01-01T00:00:00.000Z', 'system');",
    "-c",
    CONFIG,
  ]);

  const countsOut = wrangler([
    "d1",
    "execute",
    databaseName,
    "--remote",
    "--yes",
    "--json",
    "--command",
    "SELECT (SELECT COUNT(*) FROM teachers) AS teachers, (SELECT COUNT(*) FROM schools) AS schools, (SELECT COUNT(*) FROM centres) AS centres, (SELECT COUNT(*) FROM duty_types) AS duty_types;",
    "-c",
    CONFIG,
  ]);

  let d1Counts: Record<string, number> | null = null;
  try {
    const parsed = JSON.parse(countsOut.slice(countsOut.indexOf("["))) as Array<{
      results?: Array<Record<string, number>>;
      success?: boolean;
    }>;
    d1Counts = parsed[0]?.results?.[0] ?? null;
  } catch {
    d1Counts = null;
  }
  const d1Ok = Boolean(d1Counts && typeof d1Counts.duty_types === "number");

  let healthCounts: Awaited<ReturnType<typeof countMaster>> | null = null;
  let healthCountsError: string | undefined;
  try {
    const acct = readTemporaryAccount();
    healthCounts = await countMaster(
      createD1HttpClient({
        accountId: acct.accountId,
        databaseId,
        apiToken: acct.apiToken,
      }),
    );
  } catch (e) {
    healthCountsError = e instanceof Error ? e.message : String(e);
  }

  const deployOut = wrangler(["deploy", "-c", CONFIG]);
  const meta = parseClaim(`${bootstrapOut}\n${createOut}\n${deployOut}`);
  const health = meta.workersUrl
    ? await probeHealth(meta.workersUrl)
    : { ok: false, error: "no workers.dev URL in deploy output" };

  const evidence = {
    ok: d1Ok,
    d1Ok,
    httpDbOk: health.ok === true,
    kind: "cloudflare-temporary-worker-d1",
    databaseId,
    databaseName,
    workerName: WORKER_NAME,
    ...meta,
    d1Counts,
    healthCounts,
    ...(healthCountsError ? { healthCountsError } : {}),
    health,
    note: "Temporary account expires in 60 minutes unless claimed. Live D1 is evidenced by remote execute (d1Ok) and countMaster via the D1 HTTP API (healthCounts — same SQL as GET /api/health). HTTP /api/health may be bot-challenged from this network. Not the client Pages staging account. R2 unbound. ACCESS_EMAIL_ROLE_MAP unset (OQ-010).",
  };
  record(evidence);
  console.log("\nTEMPORARY_EVIDENCE", EVIDENCE);
  if (!health.ok) {
    console.log(
      "HTTP health did not return dbOk (often a workers.dev bot challenge). D1 was still created and migrated on the live account.",
    );
  }
  if (!d1Ok) process.exit(1);
}

main().catch((e) => {
  record({
    ok: false,
    error: e instanceof Error ? e.message : String(e),
  });
  console.error(e);
  process.exit(1);
});
