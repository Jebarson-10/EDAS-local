/**
 * Raise Cloudflare Pages preview (product staging) from API credentials.
 *
 * Credentials (first match):
 *   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
 *   wrangler-temporary-account.toml from `npm run staging:temporary`
 *     (Pages stays 403 until that preview account is claimed)
 *
 * Optional:
 *   CF_D1_PREVIEW_NAME   default erode-exam-duty-preview
 *   CF_D1_PREVIEW_ID     skip create when set
 *   CF_PAGES_PROJECT     default erode-exam-duty
 *   CF_R2_PREVIEW_BUCKET leave FILES unbound when unset (honest stored:false)
 *   ACCESS_EMAIL_ROLE_MAP  OQ-010 JSON; never invented — set as Pages secret when present
 *
 * Does not promote production.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  injectCloudflareCredentials,
  pagesForbiddenOnTemporaryAccount,
  previewD1FromTemporaryToml,
  resolveCloudflareCredentials,
} from "./cloudflare-credentials.ts";
import { applyD1Binding } from "./wrangler-env.ts";
import { placeholderRoleMapError } from "./section-107-guards.ts";

const ROOT = process.cwd();
const DATA = join(ROOT, ".data");

type CfResult<T> = {
  success: boolean;
  errors?: Array<{ message?: string; code?: number }>;
  result: T;
};

function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

function run(label: string, cmd: string, args: string[]) {
  console.log(`\n=== ${label} ===`);
  console.log(cmd, args.join(" "));
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`${label} failed (exit ${r.status ?? 1})`);
  }
  return r.status ?? 0;
}

async function cf<T>(
  token: string,
  accountId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as CfResult<T>;
  if (!res.ok || body.success === false) {
    const detail = JSON.stringify(body.errors ?? body).slice(0, 800);
    throw new Error(`Cloudflare API ${res.status} ${path}: ${detail}`);
  }
  return body.result;
}

async function ensureD1(token: string, accountId: string) {
  const name = process.env.CF_D1_PREVIEW_NAME ?? "erode-exam-duty-preview";
  const givenId = process.env.CF_D1_PREVIEW_ID;
  if (givenId) {
    return { name, id: givenId, created: false };
  }
  const listed = await cf<Array<{ uuid?: string; id?: string; name: string }>>(
    token,
    accountId,
    "/d1/database?per_page=100",
  );
  const rows = Array.isArray(listed) ? listed : [];
  const existing = rows.find((d) => d.name === name);
  if (existing) {
    const id = existing.uuid ?? existing.id;
    if (!id) throw new Error(`D1 ${name} listed without uuid`);
    return { name, id, created: false };
  }
  const created = await cf<{ uuid?: string; id?: string; name: string }>(
    token,
    accountId,
    "/d1/database",
    { method: "POST", body: JSON.stringify({ name }) },
  );
  const id = created.uuid ?? created.id;
  if (!id) throw new Error("D1 create response missing uuid");
  return { name: created.name ?? name, id, created: true };
}

async function ensurePagesProject(
  token: string,
  accountId: string,
  projectName: string,
) {
  try {
    await cf(token, accountId, `/pages/projects/${projectName}`);
    return { created: false };
  } catch {
    await cf(token, accountId, "/pages/projects", {
      method: "POST",
      body: JSON.stringify({
        name: projectName,
        production_branch: "main",
      }),
    });
    return { created: true };
  }
}

async function assertPagesApi(
  token: string,
  accountId: string,
  source: "client-env" | "temporary",
  claim?: { claimUrl?: string; claimExpiresAt?: string },
) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.ok) return;
  if (res.status === 403 && source === "temporary") {
    fail(
      pagesForbiddenOnTemporaryAccount({
        token,
        accountId,
        source,
        claimUrl: claim?.claimUrl,
        claimExpiresAt: claim?.claimExpiresAt,
      }),
    );
  }
  const detail = await res.text();
  fail(`Cloudflare Pages API HTTP ${res.status}: ${detail.slice(0, 400)}`);
}

async function main() {
  const creds = resolveCloudflareCredentials();
  if (!creds) {
    fail(`§107 staging:raise blocked — no Cloudflare credentials in this environment.

Need both:
  CLOUDFLARE_API_TOKEN     Account permissions: D1 edit, Cloudflare Pages edit, Workers scripts
  CLOUDFLARE_ACCOUNT_ID    32-char account id from the Cloudflare dashboard

Or claim a temporary preview account from npm run staging:temporary, then re-run this command
(the same token gains Pages after claim).

Optional:
  CF_D1_PREVIEW_ID / CF_D1_PREVIEW_NAME
  CF_R2_PREVIEW_BUCKET     omit to leave R2 unbound (stored:false backups)
  ACCESS_EMAIL_ROLE_MAP    OQ-010 email→role JSON; never invent officer emails

Then:
  npm run staging:raise

Do not paste REPLACE_ME ids. This command creates the preview D1 and deploys Pages preview.
Production promote still needs explicit human approval.`);
  }

  const { token, accountId } = creds;
  injectCloudflareCredentials(creds);

  if (
    creds.source === "temporary" &&
    !process.env.CF_D1_PREVIEW_ID &&
    existsSync(join(DATA, "wrangler.temporary.toml"))
  ) {
    const existing = previewD1FromTemporaryToml(
      readFileSync(join(DATA, "wrangler.temporary.toml"), "utf8"),
    );
    if (existing) {
      process.env.CF_D1_PREVIEW_ID = existing.id;
      process.env.CF_D1_PREVIEW_NAME = existing.name;
      console.log(
        `Reusing temporary D1 ${existing.name} ${existing.id} (already restored).`,
      );
    }
  }

  mkdirSync(DATA, { recursive: true });

  console.log(
    creds.source === "temporary"
      ? "Verifying temporary Cloudflare preview account…"
      : "Verifying Cloudflare account…",
  );
  await cf<{ id: string; name?: string }>(token, accountId, "");
  await assertPagesApi(token, accountId, creds.source, {
    claimUrl: creds.claimUrl,
    claimExpiresAt: creds.claimExpiresAt,
  });

  run("check:pages", "npm", ["run", "check:pages"]);

  const d1 = await ensureD1(token, accountId);
  console.log(
    d1.created
      ? `Created D1 ${d1.name} ${d1.id}`
      : `Using D1 ${d1.name} ${d1.id}`,
  );

  const rootTomlPath = join(ROOT, "wrangler.toml");
  const workerTomlPath = join(ROOT, "worker/wrangler.toml");
  const originalRoot = readFileSync(rootTomlPath, "utf8");
  const originalWorker = readFileSync(workerTomlPath, "utf8");
  const rootFilled = applyD1Binding(originalRoot, "preview", d1);
  const workerFilled = applyD1Binding(originalWorker, "preview", d1);
  writeFileSync(rootTomlPath, rootFilled);
  writeFileSync(workerTomlPath, workerFilled);
  writeFileSync(join(DATA, "wrangler.preview.toml"), rootFilled);
  const restoreCommittedToml = () => {
    if (creds.source !== "temporary") return;
    writeFileSync(rootTomlPath, originalRoot);
    writeFileSync(workerTomlPath, originalWorker);
  };

  const projectName = process.env.CF_PAGES_PROJECT ?? "erode-exam-duty";
  const map = process.env.ACCESS_EMAIL_ROLE_MAP;
  if (map) {
    const mapError = placeholderRoleMapError(map);
    if (mapError) fail(`§107 ACCESS_EMAIL_ROLE_MAP rejected — ${mapError}`);
  }

  try {
    const pages = await ensurePagesProject(token, accountId, projectName);
    console.log(
      pages.created
        ? `Created Pages project ${projectName}`
        : `Using Pages project ${projectName}`,
    );

    const previewBindings: Record<string, unknown> = {
      d1_databases: { DB: { id: d1.id } },
      env_vars: {
        ENVIRONMENT: { type: "plain_text", value: "staging" },
      },
    };
    if (map) {
      (previewBindings.env_vars as Record<string, unknown>).ACCESS_EMAIL_ROLE_MAP =
        {
          type: "secret_text",
          value: map,
        };
    }
    await cf(token, accountId, `/pages/projects/${projectName}`, {
      method: "PATCH",
      body: JSON.stringify({
        deployment_configs: { preview: previewBindings },
      }),
    });
    if (!map) {
      console.log(
        "ACCESS_EMAIL_ROLE_MAP unset — OQ-010 still open; Access users default to VIEWER. Not inventing officers.",
      );
    }

    run("db:migrate:remote", "npm", [
      "run",
      "db:migrate:remote",
      "--",
      "--env",
      "staging",
    ]);
    process.env.CF_D1_PREVIEW_ID = d1.id;
    run("staging:restore", "npm", ["run", "staging:restore"]);
    run("pages:build", "npm", ["run", "pages:build"]);
    // Never pass a positional assets dir — Wrangler would ignore wrangler.toml
    // and ship the SPA without functions/ or the D1 binding.
    run("pages:deploy:preview", "npx", [
      "wrangler",
      "pages",
      "deploy",
      "--project-name",
      projectName,
      "--branch",
      "preview",
    ]);
  } catch (e) {
    writeFileSync(
      join(DATA, "staging-raise-latest.json"),
      JSON.stringify(
        {
          ok: false,
          at: new Date().toISOString(),
          accountId,
          credentialSource: creds.source,
          d1,
          pagesProject: projectName,
          error: e instanceof Error ? e.message : String(e),
        },
        null,
        2,
      ),
    );
    throw e;
  } finally {
    restoreCommittedToml();
  }

  const evidence = {
    ok: true,
    at: new Date().toISOString(),
    accountId,
    credentialSource: creds.source,
    d1,
    pagesProject: projectName,
    r2: process.env.CF_R2_PREVIEW_BUCKET ?? null,
    accessRoleMapConfigured: Boolean(map),
    note:
      creds.source === "temporary"
        ? "Raised Pages on a claimed temporary account. Temporary D1 ids were not left in committed wrangler.toml. Production was not deployed."
        : "Production was not deployed. Human promote still required. OQ answers still client-supplied.",
  };
  writeFileSync(
    join(DATA, "staging-raise-latest.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("\nWrote .data/staging-raise-latest.json");
  if (creds.source === "temporary") {
    console.log(
      "Temporary D1 ids were written only to .data/wrangler.preview.toml — committed wrangler.toml was restored.",
    );
  } else {
    console.log(
      "Filled D1 ids are in wrangler.toml working tree — review before committing (ids are not secrets; never commit the API token).",
    );
  }
  console.log(
    "Probe the preview URL /api/health: dbOk must be true. r2Ok may be false until a bucket is bound.",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
