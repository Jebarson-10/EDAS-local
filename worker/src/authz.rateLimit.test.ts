import { describe, expect, it, beforeEach } from "vitest";
import { checkRateLimit, _resetRateLimitsForTests } from "./rateLimit.js";
import { hasPermission } from "./index.js";

describe("rateLimit", () => {
  beforeEach(() => _resetRateLimitsForTests());

  it("allows up to limit then returns 429-style denial", () => {
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("t", { limit: 3, windowMs: 60_000 }).ok).toBe(true);
    }
    const denied = checkRateLimit("t", { limit: 3, windowMs: 60_000 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.retryAfterSec).toBeGreaterThan(0);
  });
});

describe("hasPermission matrix", () => {
  it("VIEWER cannot write masters or generate", () => {
    expect(hasPermission("VIEWER", "master.read")).toBe(true);
    expect(hasPermission("VIEWER", "master.write")).toBe(false);
    expect(hasPermission("VIEWER", "allocation.generate")).toBe(false);
  });

  it("DATA_OPERATOR can import but not approve", () => {
    expect(hasPermission("DATA_OPERATOR", "import.apply")).toBe(true);
    expect(hasPermission("DATA_OPERATOR", "allocation.approve")).toBe(false);
  });

  it("OFFICER can generate and approve; ADMIN can manage rules", () => {
    expect(hasPermission("OFFICER", "allocation.generate")).toBe(true);
    expect(hasPermission("OFFICER", "allocation.approve")).toBe(true);
    expect(hasPermission("OFFICER", "rules.manage")).toBe(false);
    expect(hasPermission("ADMIN", "rules.manage")).toBe(true);
  });
});
