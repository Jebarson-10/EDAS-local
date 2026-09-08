import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("staging-temporary remint guard", () => {
  it("delegates minting to shouldReplaceTemporaryAccount", () => {
    const bootstrap = readFileSync("scripts/bootstrap-temporary-account.ts", "utf8");
    const staging = readFileSync("scripts/staging-temporary.ts", "utf8");
    expect(bootstrap).toMatch(/shouldReplaceTemporaryAccount/);
    expect(staging).toMatch(/bootstrap-temporary-account/);
    expect(staging).not.toMatch(/claim window nearly elapsed/);
    expect(bootstrap).not.toMatch(/temporaryClaimExpiringSoon/);
  });
});
