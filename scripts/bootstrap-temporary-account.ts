/**
 * Mint or reuse a 60-minute Cloudflare preview account.
 *
 * Reuse whenever D1 still lists. CF_TEMP_FORCE_NEW cannot destroy a live
 * restored D1 (claimed accounts keep D1 while Pages stays 403 on cfat_).
 * Mint only when the token cannot list D1 (unclaimed expiry or 401).
 */
import { existsSync, unlinkSync } from "node:fs";
import {
  resolveCloudflareCredentials,
  shouldReplaceTemporaryAccount,
} from "./cloudflare-credentials.ts";
import { readTemporaryAccount } from "./d1-http-client.ts";
import {
  createTemporaryPreviewAccount,
  temporaryAccountTomlPath,
  writeTemporaryAccountToml,
} from "./temporary-preview-account.ts";

export async function tokenCanListD1(): Promise<boolean> {
  try {
    const acct = readTemporaryAccount();
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${acct.accountId}/d1/database?per_page=20`,
      { headers: { Authorization: `Bearer ${acct.apiToken}` } },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function waitUntilTokenCanListD1(attempts = 8): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await tokenCanListD1()) return true;
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return false;
}

export async function bootstrapTemporaryAccount(): Promise<string> {
  const forceNew = process.env.CF_TEMP_FORCE_NEW === "1";
  const d1Listable = await tokenCanListD1();
  if (!shouldReplaceTemporaryAccount(d1Listable)) {
    const acct = readTemporaryAccount();
    if (forceNew) {
      const creds = resolveCloudflareCredentials();
      console.log(
        `ignoring CF_TEMP_FORCE_NEW — D1 still reachable on ${acct.accountId} until ${creds?.claimExpiresAt ?? "unknown"}`,
      );
    } else {
      console.log(`reusing temporary account ${acct.accountId}`);
    }
    return "";
  }
  if (forceNew) {
    console.log("CF_TEMP_FORCE_NEW — minting a new preview account (D1 unreachable)");
  }
  const cached = temporaryAccountTomlPath();
  if (existsSync(cached)) {
    unlinkSync(cached);
  }
  console.log("minting Cloudflare temporary preview account…");
  const preview = await createTemporaryPreviewAccount();
  writeTemporaryAccountToml(preview);
  if (!(await waitUntilTokenCanListD1())) {
    throw new Error(
      "temporary account token is not usable for D1. Re-run npm run staging:temporary.",
    );
  }
  return [
    `Temporary account ready:`,
    `  Account:        ${preview.account.name} (created)`,
    `  Claim within:   60 minutes`,
    `  Claim URL:      ${preview.claim.url}`,
  ].join("\n");
}
