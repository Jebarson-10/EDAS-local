import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyD1Binding,
  assertPagesTomlHasNoStagingEnv,
  extractEnvSection,
  isD1BindingReady,
  wranglerEnvFor,
} from "./wrangler-env.ts";

const rootTomlPath = resolve(import.meta.dirname, "../wrangler.toml");
const workerTomlPath = resolve(import.meta.dirname, "../worker/wrangler.toml");

describe("wranglerEnvFor", () => {
  it("maps product staging to Pages preview", () => {
    expect(wranglerEnvFor("staging")).toBe("preview");
    expect(wranglerEnvFor("preview")).toBe("preview");
    expect(wranglerEnvFor("production")).toBe("production");
  });

  it("rejects unknown envs", () => {
    expect(() => wranglerEnvFor("staging-uat")).toThrow(/Unknown --env/);
    expect(() => wranglerEnvFor(undefined)).toThrow(/Missing --env/);
  });
});

describe("repo wrangler.toml", () => {
  it("Pages config uses [env.preview] not [env.staging]", () => {
    const toml = readFileSync(rootTomlPath, "utf8");
    assertPagesTomlHasNoStagingEnv(toml);
    expect(toml).toContain("[env.preview]");
    expect(toml).toContain("ENVIRONMENT = \"staging\"");
  });

  it("worker config also uses [env.preview] for UAT", () => {
    const toml = readFileSync(workerTomlPath, "utf8");
    expect(toml).toContain("[env.preview]");
    expect(toml).not.toContain("[env.staging]");
  });

  it("preview D1 is not ready until REPLACE_ME is replaced", () => {
    const toml = readFileSync(rootTomlPath, "utf8");
    const section = extractEnvSection(toml, "preview");
    expect(section).toBeTruthy();
    expect(isD1BindingReady(section!)).toBe(false);
  });
});

describe("applyD1Binding", () => {
  it("uncomments preview D1 and writes real ids", () => {
    const input = `
[env.preview]
vars = { ENVIRONMENT = "staging" }
# [[env.preview.d1_databases]]
# binding = "DB"
# database_name = "erode-exam-duty-preview"
# database_id = "REPLACE_ME_STAGING"
# [[env.preview.r2_buckets]]
# binding = "FILES"
# bucket_name = "erode-exam-duty-files-preview"

[env.production]
vars = { ENVIRONMENT = "production" }
`;
    const out = applyD1Binding(input, "preview", {
      name: "erode-exam-duty-preview",
      id: "11111111-2222-3333-4444-555555555555",
    });
    const section = extractEnvSection(out, "preview")!;
    expect(isD1BindingReady(section)).toBe(true);
    expect(section).toContain("database_id = \"11111111-2222-3333-4444-555555555555\"");
    expect(section).toMatch(/# \[\[env\.preview\.r2_buckets\]\]/);
    expect(extractEnvSection(out, "production")).toContain(
      'vars = { ENVIRONMENT = "production" }',
    );
  });
});
