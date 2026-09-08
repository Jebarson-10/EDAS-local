/**
 * Resolve Cloudflare API credentials for staging:raise / section:107.
 *
 * Preference: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (client account).
 * Fallback: wrangler-temporary-account.toml from `npm run staging:temporary`.
 *
 * Claiming keeps Workers + D1. The preview cfat_ token still cannot call
 * Pages or R2 — staging:raise needs a dashboard API token with Pages edit.
 * Unclaimed preview accounts are deleted after ~60 minutes.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CloudflareCredentialSource = "client-env" | "temporary";

export type CloudflareCredentials = {
  token: string;
  accountId: string;
  source: CloudflareCredentialSource;
  accountName?: string;
  expiresAt?: string;
  claimUrl?: string;
  claimExpiresAt?: string;
};

export function temporaryAccountTomlPath(
  configDir = join(homedir(), ".config/.wrangler"),
): string {
  return join(configDir, "wrangler-temporary-account.toml");
}

export function parseTemporaryAccountToml(text: string): Omit<
  CloudflareCredentials,
  "source"
> {
  const accountBlock = text.includes("[claim]")
    ? text.slice(0, text.indexOf("[claim]"))
    : text;
  const claimBlock = text.includes("[claim]")
    ? text.slice(text.indexOf("[claim]"))
    : "";
  const accountId = accountBlock.match(/^id\s*=\s*"([^"]+)"/m)?.[1];
  const token = accountBlock.match(/^apiToken\s*=\s*"([^"]+)"/m)?.[1];
  if (!accountId || !token) {
    throw new Error("temporary account id or apiToken missing");
  }
  return {
    token,
    accountId,
    accountName: accountBlock.match(/^name\s*=\s*"([^"]+)"/m)?.[1],
    expiresAt: accountBlock.match(/^expiresAt\s*=\s*"([^"]+)"/m)?.[1],
    claimUrl: claimBlock.match(/^url\s*=\s*"([^"]+)"/m)?.[1],
    claimExpiresAt: claimBlock.match(/^expiresAt\s*=\s*"([^"]+)"/m)?.[1],
  };
}

export function resolveCloudflareCredentials(opts?: {
  env?: NodeJS.ProcessEnv;
  temporaryAccountFile?: string;
  readFile?: (path: string) => string;
  exists?: (path: string) => boolean;
}): CloudflareCredentials | null {
  const env = opts?.env ?? process.env;
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (token && accountId) {
    return { token, accountId, source: "client-env" };
  }

  const file = opts?.temporaryAccountFile ?? temporaryAccountTomlPath();
  const exists = opts?.exists ?? existsSync;
  const read = opts?.readFile ?? ((p) => readFileSync(p, "utf8"));
  if (!exists(file)) return null;
  try {
    return { ...parseTemporaryAccountToml(read(file)), source: "temporary" };
  } catch {
    return null;
  }
}

export function injectCloudflareCredentials(
  creds: CloudflareCredentials,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env.CLOUDFLARE_API_TOKEN = creds.token;
  env.CLOUDFLARE_ACCOUNT_ID = creds.accountId;
}

export function pagesForbiddenOnTemporaryAccount(
  creds: CloudflareCredentials,
): string {
  const when = creds.claimExpiresAt
    ? ` before ${creds.claimExpiresAt}`
    : "";
  const claim = creds.claimUrl
    ? `\nClaim the preview account${when}:\n  ${creds.claimUrl}`
    : "\nRun npm run staging:temporary and claim the printed URL.";
  return `Pages API HTTP 403 on the temporary Cloudflare account.${claim}

After claim, create a dashboard API token on that account with D1 edit + Cloudflare Pages edit, then:

  export CLOUDFLARE_API_TOKEN=...
  export CLOUDFLARE_ACCOUNT_ID=...
  npm run staging:raise

The preview cfat_ token is not a Pages token (temporary accounts only support Workers + D1 among our bindings). Temporary workers.dev is not §107 Pages UAT. Do not invent ACCESS_EMAIL_ROLE_MAP.`;
}

export function previewD1FromTemporaryToml(toml: string): {
  name: string;
  id: string;
} | null {
  const id = toml.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i)?.[1];
  const name = toml.match(/database_name\s*=\s*"([^"]+)"/)?.[1];
  if (!id || !name) return null;
  return { name, id };
}

/** True when the preview claim/account expires within `withinMs` (default 8 minutes). */
export function temporaryClaimExpiringSoon(
  creds: { claimExpiresAt?: string; expiresAt?: string },
  now = Date.now(),
  withinMs = 8 * 60_000,
): boolean {
  const raw = creds.claimExpiresAt ?? creds.expiresAt;
  if (!raw) return false;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return false;
  return t - now <= withinMs;
}

/**
 * Replace the cached preview account only when its D1 is unreachable.
 * A live D1 after the claim deadline means the account was claimed (or not
 * yet deleted). Pages stays 403 on the preview token either way — do not
 * mint a second account and lose the pointer to the restored D1.
 */
export function shouldReplaceTemporaryAccount(d1Listable: boolean): boolean {
  return !d1Listable;
}

/**
 * Wait-claimed remints only when D1 is gone. Three consecutive list failures
 * during the claim window absorb transient API blips; after the window, one
 * failure is enough (unclaimed accounts are deleted).
 */
export function waitClaimedShouldRenew(opts: {
  d1Listable: boolean;
  consecutiveD1Failures: number;
  claimWindowElapsed: boolean;
}): boolean {
  if (opts.d1Listable) return false;
  if (opts.claimWindowElapsed) return true;
  return opts.consecutiveD1Failures >= 3;
}
