import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTemporaryPreviewAccount,
  formatTemporaryAccountToml,
  solvePreviewChallenge,
  writeTemporaryAccountToml,
} from "./temporary-preview-account.ts";

describe("temporary preview account POW", () => {
  it("rejects a seed that is not 32 bytes", () => {
    expect(() =>
      solvePreviewChallenge({
        challengeToken: "tok",
        seed: Buffer.alloc(8).toString("base64url"),
        k: 1,
        g: 1,
      }),
    ).toThrow(/32 bytes/);
  });

  it("returns base64 checkpoints for a tiny valid challenge", () => {
    const seed = Buffer.alloc(32, 7).toString("base64url");
    const solved = solvePreviewChallenge({
      challengeToken: "tok",
      seed,
      k: 1,
      g: 2,
    });
    expect(solved.challengeToken).toBe("tok");
    expect(Buffer.from(solved.solution.checkpoints, "base64").length).toBe(
      32 * 2,
    );
  });
});

describe("temporary account toml", () => {
  it("round-trips fields wrangler reads from wrangler-temporary-account.toml", () => {
    const dir = mkdtempSync(join(tmpdir(), "edas-tmp-acct-"));
    const file = join(dir, "wrangler-temporary-account.toml");
    writeTemporaryAccountToml(
      {
        account: {
          id: "acct-1",
          name: "Peppermint Mint",
          apiToken: "cfat_test",
          expiresAt: "2026-09-08T13:00:00Z",
        },
        claim: {
          url: "https://dash.cloudflare.com/claim-preview?claimToken=abc",
          expiresAt: "2026-09-08T13:00:00.000Z",
        },
      },
      file,
    );
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(/^id = "acct-1"$/m);
    expect(text).toMatch(/^apiToken = "cfat_test"$/m);
    expect(text).toContain("claim-preview?claimToken=abc");
    expect(formatTemporaryAccountToml).toBeTypeOf("function");
  });
});

describe("createTemporaryPreviewAccount", () => {
  it("solves the challenge then posts acceptTermsOfService=yes", async () => {
    const seed = Buffer.alloc(32, 3).toString("base64url");
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const account = await createTemporaryPreviewAccount({
      apiBase: "https://api.example.test/previews",
      fetchImpl: async (input, init) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        calls.push({ url, body });
        if (url.endsWith("/challenge")) {
          return new Response(
            JSON.stringify({
              success: true,
              result: { challengeToken: "ch", seed, k: 1, g: 1 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        expect(body.acceptTermsOfService).toBe("yes");
        expect(body.challengeToken).toBe("ch");
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              account: {
                id: "acct-new",
                name: "Early Kidney",
                apiToken: "cfat_new",
                expiresAt: "2026-09-08T14:00:00Z",
              },
              claim: {
                url: "https://dash.cloudflare.com/claim-preview?claimToken=z",
                expiresAt: "2026-09-08T14:00:00Z",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.example.test/previews/challenge",
      "https://api.example.test/previews",
    ]);
    expect(account.account.id).toBe("acct-new");
    expect(account.claim.url).toContain("claimToken=z");
  });
});
