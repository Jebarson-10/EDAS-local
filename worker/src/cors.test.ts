import { describe, expect, it } from "vitest";
import { resolveCorsOrigin } from "./index.js";

describe("resolveCorsOrigin", () => {
  it("allows localhost origins in development", () => {
    const req = new Request("http://api.local/api/health", {
      headers: { origin: "http://127.0.0.1:43123" },
    });
    expect(resolveCorsOrigin(req, { ENVIRONMENT: "development" })).toBe(
      "http://127.0.0.1:43123",
    );
  });

  it("rejects arbitrary origins in production without allowlist", () => {
    const req = new Request("https://api.example/api/health", {
      headers: { origin: "https://evil.example" },
    });
    expect(resolveCorsOrigin(req, { ENVIRONMENT: "production" })).toBeNull();
  });

  it("allows listed origins in production", () => {
    const req = new Request("https://api.example/api/health", {
      headers: { origin: "https://erode-exam-duty.pages.dev" },
    });
    expect(
      resolveCorsOrigin(req, {
        ENVIRONMENT: "production",
        ALLOWED_ORIGINS:
          "https://erode-exam-duty.pages.dev,https://ceo.example.gov.in",
      }),
    ).toBe("https://erode-exam-duty.pages.dev");
  });
});
