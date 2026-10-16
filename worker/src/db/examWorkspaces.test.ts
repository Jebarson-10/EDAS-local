import { beforeEach, afterEach, describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import { emptyExamWorkspace, type WorkspaceRun } from "@exam-duty/shared";
import { createSqliteClient } from "./client.js";
import { applyMigrations } from "./migrate.js";
import {
  saveWorkspace,
  readWorkspace,
  saveWorkspaceRun,
  listWorkspaceRuns,
  workspaceEndpoint,
  workspaceHistoryReference,
  publishWorkspaceRun,
} from "./examWorkspaces.js";

describe("isolated cycle storage", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof createSqliteClient>;
  beforeEach(async () => {
    sqlite = new Database(":memory:");
    db = createSqliteClient(sqlite);
    await applyMigrations(db, join(process.cwd(), ".."));
  });
  afterEach(() => sqlite.close());
  it("does not confirm an empty result even if its client reports no errors", async () => {
    const w = emptyExamWorkspace("empty", "Empty");
    w.settings.confirmed = true;
    await saveWorkspace(db, w);
    await saveWorkspaceRun(db, w.id, {
      id: "empty-run",
      standard: "12",
      module: "THEORY",
      createdAt: "2026-10-16",
      ruleVersion: w.ruleVersion,
      seed: "s",
      inputRevision: 1,
      assignments: [],
      shortages: [],
      errors: [],
      published: false,
    });
    await expect(publishWorkspaceRun(db, w.id, "empty-run")).rejects.toThrow(
      "non-empty duty list",
    );
    expect((await listWorkspaceRuns(db, w.id))[0]!.published).toBe(false);
  });
  it("saves a large master across chunks and reopens without losing records", async () => {
    const w = emptyExamWorkspace("a", "A");
    w.schools = Array.from({ length: 1500 }, (_, i) => ({
      udise: String(i),
      name: `Synthetic school ${i}`,
      block: "B",
      educationalDistrict: "D",
      level: "HIGH",
      management: "GOVERNMENT",
      latitude: 11.3,
      longitude: 77.7,
      raw: { address: "Synthetic address" },
    }));
    await saveWorkspace(db, w);
    const read = await readWorkspace(db, "a");
    expect(read.schools).toEqual(w.schools);
    expect(read.revision).toBe(1);
  });
  it("new cycles do not copy any import and do not change the previous cycle", async () => {
    const a = emptyExamWorkspace("a", "A");
    a.imports = [{ name: "source.xlsx", at: "2026-10-16", rows: 400 }];
    await saveWorkspace(db, a);
    await saveWorkspace(db, emptyExamWorkspace("b", "B"));
    expect((await readWorkspace(db, "b")).imports).toEqual([]);
    expect((await readWorkspace(db, "a")).imports).toHaveLength(1);
  });
  it("rejects stale saves instead of silently overwriting a newer window", async () => {
    const w = emptyExamWorkspace("a", "A");
    await saveWorkspace(db, w);
    await expect(saveWorkspace(db, w)).rejects.toThrow("another window");
    expect((await readWorkspace(db, "a")).revision).toBe(1);
  });
  it("retains immutable run input when current school names are edited", async () => {
    const w = emptyExamWorkspace("a", "Original");
    await saveWorkspace(db, w);
    const run: WorkspaceRun = {
      id: "r",
      standard: "12",
      module: "THEORY",
      createdAt: "2026-10-16",
      ruleVersion: w.ruleVersion,
      seed: "seed",
      inputRevision: 1,
      assignments: [],
      shortages: [],
      errors: ["No input"],
      published: false,
    };
    await saveWorkspaceRun(db, "a", run);
    await saveWorkspace(db, { ...w, revision: 1, name: "Changed" });
    const original = (await workspaceEndpoint(
      db,
      "GET",
      new URLSearchParams({ id: "a", runId: "r" }),
    )) as { workspace: { name: string } };
    expect(original.workspace.name).toBe("Original");
    expect(await listWorkspaceRuns(db, "a")).toHaveLength(1);
    await expect(saveWorkspaceRun(db, "a", run)).rejects.toThrow(
      "input changed",
    );
  });
  it("restores inputs and saved runs into another cycle without changing their originals", async () => {
    const w = emptyExamWorkspace("a", "Original");
    await saveWorkspace(db, w);
    const run: WorkspaceRun = {
      id: "r",
      standard: "12",
      module: "THEORY",
      createdAt: "2026-10-16",
      ruleVersion: w.ruleVersion,
      seed: "seed",
      inputRevision: 1,
      assignments: [],
      shortages: [],
      errors: ["Incomplete"],
      published: false,
    };
    await saveWorkspaceRun(db, "a", run);
    const backup = await workspaceEndpoint(
      db,
      "GET",
      new URLSearchParams({ id: "a", backup: "1" }),
    );
    const restored = (await workspaceEndpoint(
      db,
      "POST",
      new URLSearchParams(),
      { action: "restore", backup },
    )) as { id: string };
    expect(restored.id).not.toBe("a");
    expect(await listWorkspaceRuns(db, restored.id)).toHaveLength(1);
    expect((await readWorkspace(db, "a")).name).toBe("Original");
    expect(await workspaceHistoryReference(db, restored.id)).toEqual([]);
  });
});
