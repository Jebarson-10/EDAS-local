import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("db:migrate:remote argv", () => {
  it("exits 2 when --env is missing", () => {
    const r = spawnSync("npx", ["tsx", "scripts/migrate-remote.ts"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Missing --env/);
  });

  it("exits 1 when preview D1 is still REPLACE_ME", () => {
    const r = spawnSync(
      "npx",
      ["tsx", "scripts/migrate-remote.ts", "--env", "staging"],
      { cwd: root, encoding: "utf8" },
    );
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/D1 is commented or still REPLACE_ME/);
  });
});

describe("staging:raise", () => {
  it("exits 2 when Cloudflare credentials are missing", () => {
    const r = spawnSync("npx", ["tsx", "scripts/staging-raise.ts"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "" },
    });
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toMatch(/CLOUDFLARE_API_TOKEN/);
  });
});
