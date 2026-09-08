import { describe, expect, it } from "vitest";
import { DefaultAuthAdapter, parseEmailRoleMap } from "./adapter.js";

const adapter = new DefaultAuthAdapter();

describe("AuthAdapter / resolveAuth policy", () => {
  it("accepts Cloudflare Access email and defaults role to VIEWER without inventing IdP map", () => {
    const req = new Request("https://example.test/api/me", {
      headers: { "Cf-Access-Authenticated-User-Email": "a@example.gov" },
    });
    const id = adapter.resolve(req, "production");
    expect(id?.email).toBe("a@example.gov");
    expect(id?.role).toBe("VIEWER");
    expect(id?.source).toBe("cloudflare-access");
  });

  it("honours X-Access-Role when Access is present (interim until OQ-010)", () => {
    const req = new Request("https://example.test/api/me", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "a@example.gov",
        "X-Access-Role": "OFFICER",
      },
    });
    expect(adapter.resolve(req, "staging")?.role).toBe("OFFICER");
  });

  it("applies ACCESS_EMAIL_ROLE_MAP when client provides OQ-010 mapping", () => {
    const req = new Request("https://example.test/api/me", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "Ceo.Admin@Example.Gov",
      },
    });
    const id = adapter.resolve(req, "production", {
      emailRoleMap: parseEmailRoleMap(
        JSON.stringify({ "ceo.admin@example.gov": "ADMIN" }),
      ),
    });
    expect(id?.role).toBe("ADMIN");
  });

  it("email map wins over claim header when both present", () => {
    const req = new Request("https://example.test/api/me", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "officer@example.gov",
        "X-Access-Role": "VIEWER",
      },
    });
    const id = adapter.resolve(req, "staging", {
      emailRoleMap: { "officer@example.gov": "OFFICER" },
    });
    expect(id?.role).toBe("OFFICER");
  });

  it("ignores invalid ACCESS_EMAIL_ROLE_MAP JSON", () => {
    expect(parseEmailRoleMap("{not-json")).toEqual({});
    expect(parseEmailRoleMap('{"x@y":"SUPERUSER"}')).toEqual({});
  });

  it("refuses X-Dev-Role spoof in production and staging", () => {
    const req = new Request("https://example.test/api/me", {
      headers: { "X-Dev-Role": "ADMIN", "X-Dev-Email": "evil@x" },
    });
    expect(adapter.resolve(req, "production")).toBeNull();
    expect(adapter.resolve(req, "staging")).toBeNull();
  });

  it("allows X-Dev-Role in development", () => {
    const req = new Request("https://example.test/api/me", {
      headers: { "X-Dev-Role": "DATA_OPERATOR", "X-Dev-Email": "op@local" },
    });
    const id = adapter.resolve(req, "development");
    expect(id?.role).toBe("DATA_OPERATOR");
    expect(id?.source).toBe("dev-headers");
  });

  it("accepts X-Dev-User as email alias in development", () => {
    const req = new Request("https://example.test/api/me", {
      headers: { "X-Dev-Role": "ADMIN", "X-Dev-User": "smoke@local" },
    });
    const id = adapter.resolve(req, "local-sqlite");
    expect(id?.email).toBe("smoke@local");
    expect(id?.userId).toBe("dev:smoke@local");
    expect(id?.role).toBe("ADMIN");
  });
});
