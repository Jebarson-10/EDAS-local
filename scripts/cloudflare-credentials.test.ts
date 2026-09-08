import { describe, expect, it } from "vitest";
import {
  pagesForbiddenOnTemporaryAccount,
  parseTemporaryAccountToml,
  previewD1FromTemporaryToml,
  resolveCloudflareCredentials,
  temporaryClaimExpiringSoon,
} from "./cloudflare-credentials.ts";

const TOML = `[account]
id = "0015795d6b950669539e966be9821c82"
name = "Season Driver"
apiToken = "cfat_test"
expiresAt = "2026-09-08T14:20:36Z"

[claim]
url = "https://dash.cloudflare.com/claim-preview?claimToken=abc"
expiresAt = "2026-09-08T14:20:36.493Z"
`;

describe("parseTemporaryAccountToml", () => {
  it("reads claim URL from the [claim] section, not the account id line", () => {
    const parsed = parseTemporaryAccountToml(TOML);
    expect(parsed.accountId).toBe("0015795d6b950669539e966be9821c82");
    expect(parsed.accountName).toBe("Season Driver");
    expect(parsed.claimUrl).toContain("claim-preview?claimToken=abc");
    expect(parsed.claimExpiresAt).toBe("2026-09-08T14:20:36.493Z");
    expect(parsed.expiresAt).toBe("2026-09-08T14:20:36Z");
  });
});

describe("resolveCloudflareCredentials", () => {
  it("prefers client env over the temporary toml", () => {
    const creds = resolveCloudflareCredentials({
      env: {
        CLOUDFLARE_API_TOKEN: "cfat_client",
        CLOUDFLARE_ACCOUNT_ID: "acct-client",
      } as NodeJS.ProcessEnv,
      temporaryAccountFile: "/tmp/does-not-matter.toml",
      exists: () => true,
      readFile: () => TOML,
    });
    expect(creds).toEqual({
      token: "cfat_client",
      accountId: "acct-client",
      source: "client-env",
    });
  });

  it("falls back to the temporary preview account when env is empty", () => {
    const creds = resolveCloudflareCredentials({
      env: {} as NodeJS.ProcessEnv,
      temporaryAccountFile: "/tmp/wrangler-temporary-account.toml",
      exists: () => true,
      readFile: () => TOML,
    });
    expect(creds?.source).toBe("temporary");
    expect(creds?.accountId).toBe("0015795d6b950669539e966be9821c82");
    expect(creds?.claimUrl).toContain("claimToken=abc");
  });

  it("returns null when neither env nor toml is present", () => {
    expect(
      resolveCloudflareCredentials({
        env: {} as NodeJS.ProcessEnv,
        temporaryAccountFile: "/tmp/missing.toml",
        exists: () => false,
        readFile: () => {
          throw new Error("should not read");
        },
      }),
    ).toBeNull();
  });
});

describe("pagesForbiddenOnTemporaryAccount", () => {
  it("tells the operator to claim, not to invent a role map", () => {
    const message = pagesForbiddenOnTemporaryAccount({
      token: "cfat_test",
      accountId: "acct",
      source: "temporary",
      claimUrl: "https://dash.cloudflare.com/claim-preview?claimToken=abc",
      claimExpiresAt: "2026-09-08T14:20:36Z",
    });
    expect(message).toMatch(/Pages API HTTP 403/);
    expect(message).toContain("claimToken=abc");
    expect(message).toMatch(/Do not invent ACCESS_EMAIL_ROLE_MAP/);
    expect(message).not.toMatch(/example\.gov\.in/);
  });
});

describe("temporaryClaimExpiringSoon", () => {
  it("is true when claim expiry is within the window", () => {
    expect(
      temporaryClaimExpiringSoon(
        { claimExpiresAt: "2026-09-08T14:20:36.493Z" },
        Date.parse("2026-09-08T14:15:00Z"),
        8 * 60_000,
      ),
    ).toBe(true);
  });

  it("is false when more than the window remains", () => {
    expect(
      temporaryClaimExpiringSoon(
        { claimExpiresAt: "2026-09-08T14:20:36.493Z" },
        Date.parse("2026-09-08T14:00:00Z"),
        8 * 60_000,
      ),
    ).toBe(false);
  });
});

describe("previewD1FromTemporaryToml", () => {
  it("reads the live D1 id from wrangler.temporary.toml", () => {
    expect(
      previewD1FromTemporaryToml(`
name = "erode-exam-duty"
[[d1_databases]]
database_name = "erode-exam-duty"
database_id = "2e725c33-f78e-4168-96ef-87b2fac4412a"
`),
    ).toEqual({
      name: "erode-exam-duty",
      id: "2e725c33-f78e-4168-96ef-87b2fac4412a",
    });
  });
});
