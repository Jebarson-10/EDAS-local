/**
 * Poll the Pages API until a Pages-capable token exists, then run staging:raise.
 *
 * Unclaimed accounts 403 Pages. Claiming keeps Workers + D1; the preview
 * cfat_ token still cannot call Pages. After claim, drop a dashboard token
 * with Pages edit (and optional ACCESS_EMAIL_ROLE_MAP from OQ-010) as
 * gitignored .data/cloudflare-client.env — this loop re-resolves every poll.
 *
 * Do not remint while D1 still lists — that would drop a claimed (or still
 * live) restored database. Remint only when D1 is gone (unclaimed expiry).
 *
 *   npm run staging:wait-claimed
 *
 * Evidence: .data/staging-wait-claimed-latest.json
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  injectAccessEmailRoleMap,
  injectCloudflareCredentials,
  previewD1FromTemporaryToml,
  resolveCloudflareCredentials,
  waitClaimedShouldRenew,
} from "./cloudflare-credentials.ts";

const ROOT = process.cwd();
const DATA = join(ROOT, ".data");
const EVIDENCE = join(DATA, "staging-wait-claimed-latest.json");
const INTERVAL_MS = Number(process.env.CLAIM_POLL_MS ?? 15_000);

function record(result: Record<string, unknown>) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(
    EVIDENCE,
    `${JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2)}\n`,
  );
}

function deadlineMs(claimExpiresAt?: string): number {
  if (claimExpiresAt) {
    const t = Date.parse(claimExpiresAt);
    if (!Number.isNaN(t)) return t + 60_000;
  }
  return Date.now() + 55 * 60_000;
}

async function pagesApiOk(
  token: string,
  accountId: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { ok: res.ok, status: res.status };
}

async function d1Listable(token: string, accountId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database?per_page=5`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function d1Counts(
  token: string,
  accountId: string,
): Promise<Record<string, number> | null> {
  const tomlPath = join(ROOT, ".data/wrangler.temporary.toml");
  if (!existsSync(tomlPath)) return null;
  const db = previewD1FromTemporaryToml(readFileSync(tomlPath, "utf8"));
  if (!db) return null;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${db.id}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: "SELECT (SELECT COUNT(*) FROM teachers) t, (SELECT COUNT(*) FROM schools) s, (SELECT COUNT(*) FROM centres) c, (SELECT COUNT(*) FROM duty_assignment_history) h",
        }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: { results?: { t: number; s: number; c: number; h: number }[] }[];
    };
    const row = json.result?.[0]?.results?.[0];
    if (!row) return null;
    return {
      teachers: row.t,
      schools: row.s,
      centres: row.c,
      history: row.h,
    };
  } catch {
    return null;
  }
}

function renewTemporary(): boolean {
  const env = { ...process.env, CF_TEMP_FORCE_NEW: "1" };
  console.log(
    "Renewing temporary Cloudflare account (D1 unreachable — unclaimed window elapsed or token 401)…",
  );
  const mint = spawnSync("npm", ["run", "staging:temporary"], {
    cwd: ROOT,
    stdio: "inherit",
    env,
  });
  if (mint.status !== 0) return false;
  const restore = spawnSync("npm", ["run", "staging:restore"], {
    cwd: ROOT,
    stdio: "inherit",
    env,
  });
  return restore.status === 0;
}

async function main() {
  let creds = resolveCloudflareCredentials();
  if (!creds) {
    record({
      ok: false,
      error: "no-credentials",
      note: "Need CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, or npm run staging:temporary.",
    });
    console.error("staging:wait-claimed — no Cloudflare credentials");
    process.exit(2);
  }

  const maxRenews = Number(process.env.CLAIM_MAX_RENEWS ?? 12);
  let renews = 0;

  while (renews <= maxRenews) {
    const until = deadlineMs(creds.claimExpiresAt);
    console.log(
      `Polling Pages API on ${creds.source} account ${creds.accountId} until ${new Date(until).toISOString()} (D1-live accounts keep polling after that instead of reminting)`,
    );
    if (creds.claimUrl) {
      console.log(`Claim URL: ${creds.claimUrl}`);
    }

    let consecutiveD1Failures = 0;
    let loggedLivePastWindow = false;

    for (;;) {
      const probe = await pagesApiOk(creds.token, creds.accountId);
      const d1ok = await d1Listable(creds.token, creds.accountId);
      consecutiveD1Failures = d1ok ? 0 : consecutiveD1Failures + 1;
      const claimWindowElapsed = Date.now() >= until;
      const counts = d1ok
        ? await d1Counts(creds.token, creds.accountId)
        : null;
      record({
        ok: false,
        waiting: !probe.ok,
        pagesStatus: probe.status,
        d1Listable: d1ok,
        d1Counts: counts,
        consecutiveD1Failures,
        claimWindowElapsed,
        source: creds.source,
        accountId: creds.accountId,
        claimUrl: creds.claimUrl ?? null,
        claimExpiresAt: creds.claimExpiresAt ?? null,
        renews,
      });
      if (probe.ok) {
        console.log("Pages API reachable — running npm run staging:raise");
        injectCloudflareCredentials(creds);
        const r = spawnSync("npm", ["run", "staging:raise"], {
          cwd: ROOT,
          stdio: "inherit",
          env: process.env,
        });
        record({
          ok: r.status === 0,
          pagesStatus: probe.status,
          raiseExit: r.status ?? 1,
          claimUrl: creds.claimUrl ?? null,
        });
        process.exit(r.status ?? 1);
      }

      if (
        waitClaimedShouldRenew({
          d1Listable: d1ok,
          consecutiveD1Failures,
          claimWindowElapsed,
        })
      ) {
        record({
          ok: false,
          error: "d1-unreachable",
          pagesStatus: probe.status,
          claimUrl: creds.claimUrl ?? null,
          claimExpiresAt: creds.claimExpiresAt ?? null,
          note: "D1 no longer lists. Minting a new 60-minute preview account from the canonical snapshot.",
        });
        console.error("staging:wait-claimed — D1 unreachable; renewing temporary account");
        break;
      }

      if (claimWindowElapsed && d1ok && !loggedLivePastWindow) {
        loggedLivePastWindow = true;
        console.log(
          "Claim window elapsed but D1 still lists — not reminting (account claimed or not yet deleted). Waiting for a Pages-edit dashboard token.",
        );
      }

      const wait = Math.min(INTERVAL_MS, 15_000);
      await new Promise((r) => setTimeout(r, wait));

      // Pick up a dashboard token from env or gitignored .data/cloudflare-client.env.
      const again = resolveCloudflareCredentials();
      if (again) {
        if (again.source !== creds.source) {
          console.log(
            `Credentials source is now ${again.source} (account ${again.accountId})`,
          );
        }
        if (again.source === "client-env") {
          injectCloudflareCredentials(again);
        } else {
          // Do not inject the preview cfat_ into process.env (that would
          // mask a later dashboard drop file). Still pass through OQ-010.
          injectAccessEmailRoleMap(again.accessEmailRoleMap);
        }
        creds = again;
      }
    }

    if (!renewTemporary()) {
      record({ ok: false, error: "renew-failed", renews });
      console.error("staging:wait-claimed — renew failed");
      process.exit(1);
    }
    renews += 1;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    creds = resolveCloudflareCredentials();
    if (!creds) {
      record({ ok: false, error: "no-credentials-after-renew", renews });
      process.exit(1);
    }
  }

  record({ ok: false, error: "max-renews", renews });
  console.error("staging:wait-claimed — hit CLAIM_MAX_RENEWS");
  process.exit(1);
}

void main();
