/**
 * Mint a Cloudflare temporary preview account the same way Wrangler does
 * (`POST /provisioning/previews/challenge` + proof-of-work + accept ToS).
 *
 * `wrangler whoami --temporary` is not a real flag; `--temporary` is only on
 * deploy / D1 / KV. This helper writes wrangler-temporary-account.toml so
 * later wrangler commands can use the cfat_ token without --temporary.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const TEMPORARY_TERMS_URLS = {
  termsOfService: "https://www.cloudflare.com/terms/",
  privacyPolicy: "https://www.cloudflare.com/privacypolicy/",
} as const;

export const POW_MAX_ITERATIONS = 64_000_000;

export type PreviewChallenge = {
  challengeToken: string;
  seed: string;
  k: number;
  g: number;
};

export type TemporaryPreviewAccount = {
  account: {
    id: string;
    name: string;
    apiToken: string;
    expiresAt: string;
  };
  claim: {
    url: string;
    expiresAt: string;
  };
};

function sha256(value: Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

export function solvePreviewChallenge(challenge: PreviewChallenge): {
  challengeToken: string;
  solution: { checkpoints: string };
} {
  const seedBytes = Buffer.from(challenge.seed, "base64url");
  if (seedBytes.length !== 32) {
    throw new Error("seed must decode to 32 bytes");
  }
  if (!Number.isInteger(challenge.k) || challenge.k <= 0) {
    throw new Error("k must be a positive integer");
  }
  if (!Number.isInteger(challenge.g) || challenge.g <= 0) {
    throw new Error("g must be a positive integer");
  }
  if (challenge.k * challenge.g > POW_MAX_ITERATIONS) {
    throw new Error("k * g must not exceed 64,000,000");
  }

  const checkpoints: Buffer[] = [];
  let hash = sha256(seedBytes);
  checkpoints.push(hash);
  for (let segment = 0; segment < challenge.k; segment++) {
    for (let iteration = 0; iteration < challenge.g; iteration++) {
      hash = sha256(hash);
    }
    checkpoints.push(hash);
  }
  return {
    challengeToken: challenge.challengeToken,
    solution: { checkpoints: Buffer.concat(checkpoints).toString("base64") },
  };
}

export function temporaryAccountTomlPath(
  configDir = join(homedir(), ".config/.wrangler"),
): string {
  return join(configDir, "wrangler-temporary-account.toml");
}

export function formatTemporaryAccountToml(
  account: TemporaryPreviewAccount,
): string {
  return `[account]
id = "${account.account.id}"
name = "${account.account.name}"
apiToken = "${account.account.apiToken}"
expiresAt = "${account.account.expiresAt}"

[claim]
url = "${account.claim.url}"
expiresAt = "${account.claim.expiresAt}"
`;
}

export function writeTemporaryAccountToml(
  account: TemporaryPreviewAccount,
  file = temporaryAccountTomlPath(),
): string {
  mkdirSync(dirname(file), { recursive: true });
  const body = formatTemporaryAccountToml(account);
  writeFileSync(file, body, { mode: 0o600 });
  return file;
}

type PreviewApi = {
  fetchImpl?: typeof fetch;
  apiBase?: string;
};

async function postJson(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

export async function createTemporaryPreviewAccount(
  opts?: PreviewApi,
): Promise<TemporaryPreviewAccount> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const apiBase =
    opts?.apiBase ?? "https://api.cloudflare.com/client/v4/provisioning/previews";

  const challengeRes = await postJson(`${apiBase}/challenge`, {}, fetchImpl);
  const challenge = (challengeRes.json.result ?? {}) as PreviewChallenge;
  if (
    challengeRes.status >= 400 ||
    !challenge.challengeToken ||
    !challenge.seed ||
    challenge.k == null ||
    challenge.g == null
  ) {
    throw new Error(
      `temporary account challenge failed (${challengeRes.status})`,
    );
  }
  const pow = solvePreviewChallenge(challenge);
  const created = await postJson(
    apiBase,
    {
      termsOfService: TEMPORARY_TERMS_URLS.termsOfService,
      privacyPolicy: TEMPORARY_TERMS_URLS.privacyPolicy,
      acceptTermsOfService: "yes",
      challengeToken: pow.challengeToken,
      solution: pow.solution,
    },
    fetchImpl,
  );
  const result = created.json.result as TemporaryPreviewAccount | undefined;
  if (
    created.status >= 400 ||
    !result?.account?.id ||
    !result.account.apiToken ||
    !result.account.expiresAt ||
    !result.claim?.url ||
    !result.claim.expiresAt
  ) {
    const err = created.json.errors as Array<{ message?: string }> | undefined;
    const detail = err?.map((e) => e.message).filter(Boolean).join("; ");
    throw new Error(
      `temporary account create failed (${created.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  return result;
}
