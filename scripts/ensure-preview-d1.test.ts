import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensurePreviewD1 } from "./ensure-preview-d1.ts";

const luckId = "6b13cc42-9ebc-48c6-b0bb-2b2dd056d399";
const luckAcct = "89be250f69dea40413433b7e91f4706f";

describe("ensurePreviewD1", () => {
  it("reuses CF_D1_PREVIEW_ID without listing", async () => {
    const result = await ensurePreviewD1({
      accountId: luckAcct,
      previewName: "erode-exam-duty-preview",
      givenId: "given-id",
      dataDir: "/tmp",
      listDatabases: async () => {
        throw new Error("should not list");
      },
      createDatabase: async () => {
        throw new Error("should not create");
      },
    });
    expect(result).toEqual({
      name: "erode-exam-duty-preview",
      id: "given-id",
      created: false,
      fromTemporary: false,
    });
  });

  it("reuses the restored temporary D1 on the same account (dashboard token path)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "edas-d1-"));
    writeFileSync(
      join(dir, "wrangler.temporary.toml"),
      `[[d1_databases]]\ndatabase_name = "erode-exam-duty"\ndatabase_id = "${luckId}"\n`,
    );
    let created = 0;
    const result = await ensurePreviewD1({
      accountId: luckAcct,
      previewName: "erode-exam-duty-preview",
      dataDir: dir,
      readAccount: () => ({ accountId: luckAcct, apiToken: "cfat_test" }),
      listDatabases: async () => [{ name: "erode-exam-duty", uuid: luckId }],
      createDatabase: async () => {
        created += 1;
        throw new Error("must not create a second D1 on a one-database account");
      },
    });
    expect(created).toBe(0);
    expect(result).toEqual({
      name: "erode-exam-duty",
      id: luckId,
      created: false,
      fromTemporary: true,
    });
  });

  it("creates erode-exam-duty-preview on a client org with production D1 only", async () => {
    const result = await ensurePreviewD1({
      accountId: "client-org",
      previewName: "erode-exam-duty-preview",
      dataDir: "/tmp/does-not-exist",
      listDatabases: async () => [{ name: "erode-exam-duty", id: "prod-only" }],
      createDatabase: async (name) => ({ name, uuid: "new-preview" }),
    });
    expect(result).toEqual({
      name: "erode-exam-duty-preview",
      id: "new-preview",
      created: true,
      fromTemporary: false,
    });
  });
});
