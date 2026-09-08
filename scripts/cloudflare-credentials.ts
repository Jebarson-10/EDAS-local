/**
 * Resolve Cloudflare API credentials for staging:raise / section:107.
 *
 * Preference:
 *   1. CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (process env)
 *   2. gitignored `.data/cloudflare-client.env` (dashboard token drop file)
 *   3. wrangler-temporary-account.toml from `npm run staging:temporary`
 *
 * Claiming keeps Workers + D1. The preview cfat_ token still cannot call
 * Pages or R2 — staging:raise needs a dashboard API token with Pages edit.
 * Unclaimed preview accounts are deleted after ~60 minutes.
 *
 * `staging:wait-claimed` re-resolves every poll, so dropping the env file is
 * enough — do not remint while D1 still lists. The drop file may include
 * ACCESS_EMAIL_ROLE_MAP (OQ-010); that is injected into staging:raise.
 * Preview `cfat_` tokens in process env are ignored the same way as in the
 * drop file so they cannot mask a later dashboard token.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CLIENT_CREDENTIALS_FILE = join(
  process.cwd(),
  ".data/cloudflare-client.env",
);

export type CloudflareCredentialSource = "client-env" | "temporary";

export type CloudflareCredentials = {
  token: string;
  accountId: string;
  source: CloudflareCredentialSource;
  accountName?: string;
  expiresAt?: string;
  claimUrl?: string;
  claimExpiresAt?: string;
  /** OQ-010 JSON from env or the drop file. Never invented. */
  accessEmailRoleMap?: string;
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

/** Parse KEY=VALUE drop file. Preview `cfat_` tokens are ignored (not Pages-capable). */
export function parseDotEnvText(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.replace(/^export\s+/, "");
    const eq = stripped.indexOf("=");
    if (eq < 1) continue;
    const key = stripped.slice(0, eq).trim();
    let val = stripped.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

export function isPreviewApiToken(token: string): boolean {
  return token.startsWith("cfat_");
}

export function accessEmailRoleMapFromDotEnv(
  text: string,
): string | undefined {
  const map = parseDotEnvText(text).ACCESS_EMAIL_ROLE_MAP?.trim();
  return map || undefined;
}

export function parseClientCredentialsEnv(
  text: string,
): { token: string; accountId: string; accessEmailRoleMap?: string } | null {
  const vars = parseDotEnvText(text);
  const token = vars.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = vars.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !accountId) return null;
  if (isPreviewApiToken(token)) return null;
  const accessEmailRoleMap = vars.ACCESS_EMAIL_ROLE_MAP?.trim();
  return accessEmailRoleMap
    ? { token, accountId, accessEmailRoleMap }
    : { token, accountId };
}

function overlayAccessEmailRoleMap(
  creds: CloudflareCredentials,
  env: NodeJS.ProcessEnv,
  fromDrop?: string,
): CloudflareCredentials {
  const fromEnv = env.ACCESS_EMAIL_ROLE_MAP?.trim();
  const map = fromEnv || fromDrop || creds.accessEmailRoleMap;
  if (!map || creds.accessEmailRoleMap === map) return creds;
  return { ...creds, accessEmailRoleMap: map };
}

export function resolveCloudflareCredentials(opts?: {
  env?: NodeJS.ProcessEnv;
  temporaryAccountFile?: string;
  clientCredentialsFile?: string;
  readFile?: (path: string) => string;
  exists?: (path: string) => boolean;
}): CloudflareCredentials | null {
  const env = opts?.env ?? process.env;
  const exists = opts?.exists ?? existsSync;
  const read = opts?.readFile ?? ((p) => readFileSync(p, "utf8"));
  const drop = opts?.clientCredentialsFile ?? CLIENT_CREDENTIALS_FILE;

  let dropMap: string | undefined;
  let dropCreds: {
    token: string;
    accountId: string;
    accessEmailRoleMap?: string;
  } | null = null;
  if (exists(drop)) {
    try {
      const text = read(drop);
      dropMap = accessEmailRoleMapFromDotEnv(text);
      dropCreds = parseClientCredentialsEnv(text);
    } catch {
      /* fall through */
    }
  }

  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (token && accountId && !isPreviewApiToken(token)) {
    return overlayAccessEmailRoleMap(
      { token, accountId, source: "client-env" },
      env,
      dropMap,
    );
  }

  if (dropCreds) {
    return overlayAccessEmailRoleMap(
      { ...dropCreds, source: "client-env" },
      env,
      dropCreds.accessEmailRoleMap ?? dropMap,
    );
  }

  const file = opts?.temporaryAccountFile ?? temporaryAccountTomlPath();
  if (!exists(file)) return null;
  try {
    return overlayAccessEmailRoleMap(
      { ...parseTemporaryAccountToml(read(file)), source: "temporary" },
      env,
      dropMap,
    );
  } catch {
    return null;
  }
}

/** Set ACCESS_EMAIL_ROLE_MAP when present. Does not clear an existing env map. */
export function injectAccessEmailRoleMap(
  map: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (map) env.ACCESS_EMAIL_ROLE_MAP = map;
}

export function injectCloudflareCredentials(
  creds: CloudflareCredentials,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env.CLOUDFLARE_API_TOKEN = creds.token;
  env.CLOUDFLARE_ACCOUNT_ID = creds.accountId;
  injectAccessEmailRoleMap(creds.accessEmailRoleMap, env);
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

After claim, create a dashboard API token on that account with D1 edit + Cloudflare Pages edit + Workers R2 Storage edit, then either:

  export CLOUDFLARE_API_TOKEN=...
  export CLOUDFLARE_ACCOUNT_ID=...
  npm run staging:raise

or write those two lines to gitignored .data/cloudflare-client.env
(optional ACCESS_EMAIL_ROLE_MAP from OQ-010 — never invent officer emails).
staging:wait-claimed picks that file up on the next poll.

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
