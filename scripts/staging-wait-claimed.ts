/**
 * Poll the Pages API until the temporary preview account is claimed (or a
 * client token is present), then run staging:raise.
 *
 * Unclaimed accounts 403 Pages. After claim the same token can create a
 * *.pages.dev project. Does not invent ACCESS_EMAIL_ROLE_MAP.
 *
 *   npm run staging:wait-claimed
 *
 * Evidence: .data/staging-wait-claimed-latest.json
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  injectCloudflareCredentials,
  resolveCloudflareCredentials,
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

async function main() {
  const creds = resolveCloudflareCredentials();
  if (!creds) {
    record({
      ok: false,
      error: "no-credentials",
      note: "Need CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, or npm run staging:temporary.",
    });
    console.error("staging:wait-claimed — no Cloudflare credentials");
    process.exit(2);
  }
  injectCloudflareCredentials(creds);
  const until = deadlineMs(creds.claimExpiresAt);
  console.log(
    `Polling Pages API on ${creds.source} account ${creds.accountId} until ${new Date(until).toISOString()}`,
  );
  if (creds.claimUrl) {
    console.log(`Claim URL: ${creds.claimUrl}`);
  }

  let lastStatus = 0;
  while (Date.now() < until) {
    const probe = await pagesApiOk(creds.token, creds.accountId);
    lastStatus = probe.status;
    record({
      ok: false,
      waiting: !probe.ok,
      pagesStatus: probe.status,
      claimUrl: creds.claimUrl ?? null,
      claimExpiresAt: creds.claimExpiresAt ?? null,
    });
    if (probe.ok) {
      console.log("Pages API reachable — running npm run staging:raise");
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
    if (probe.status === 401) {
      record({
        ok: false,
        error: "token-expired",
        pagesStatus: 401,
        note: "Temporary account gone. Run npm run staging:temporary && npm run staging:restore.",
      });
      console.error("staging:wait-claimed — token 401, account expired");
      process.exit(1);
    }
    const wait = Math.min(INTERVAL_MS, Math.max(5_000, until - Date.now()));
    await new Promise((r) => setTimeout(r, wait));
  }

  record({
    ok: false,
    error: "claim-window-elapsed",
    pagesStatus: lastStatus,
    claimUrl: creds.claimUrl ?? null,
    claimExpiresAt: creds.claimExpiresAt ?? null,
    note: "Pages stayed 403. Claim the preview account or supply a client token.",
  });
  console.error("staging:wait-claimed — claim window elapsed, Pages still forbidden");
  process.exit(1);
}

void main();
