import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checksumOf,
  readLocalAutosaveMeta,
  writeLocalAutosave,
} from "./local-autosave.ts";

describe("local autosave", () => {
  it("writes latest.json + meta and reports checksum", () => {
    const dir = mkdtempSync(join(tmpdir(), "autosave-"));
    try {
      const payload = { teachers: [{ id: "t1" }], schools: [], centres: [] };
      const meta = writeLocalAutosave(dir, payload);
      expect(meta.bytes).toBeGreaterThan(10);
      expect(meta.checksum).toBe(
        checksumOf(JSON.stringify(payload)),
      );
      const round = readLocalAutosaveMeta(dir);
      expect(round?.checksum).toBe(meta.checksum);
      const latest = JSON.parse(
        readFileSync(join(dir, "autosave", "latest.json"), "utf8"),
      );
      expect(latest.teachers[0].id).toBe("t1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores the volatile metadata envelope when detecting changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "autosave-meta-"));
    try {
      const first = writeLocalAutosave(dir, {
        metadata: { createdAt: "2026-01-01T00:00:00.000Z" },
        teachers: [{ id: "t1" }],
      });
      const again = writeLocalAutosave(dir, {
        metadata: { createdAt: "2026-01-02T00:00:00.000Z" },
        teachers: [{ id: "t1" }],
      });
      expect(first.checksum).not.toBe(checksumOf("{}"));
      expect(again.unchanged).toBe(true);
      expect(again.savedAt).toBe(first.savedAt);
      expect(
        readdirSync(join(dir, "autosave")).filter((f) => f.startsWith("snap-")),
      ).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps history slots when the payload has not changed", () => {
    const dir = mkdtempSync(join(tmpdir(), "autosave-same-"));
    try {
      const first = writeLocalAutosave(dir, { teachers: [{ id: "t1" }] });
      const again = writeLocalAutosave(dir, { teachers: [{ id: "t1" }] });
      expect(again.unchanged).toBe(true);
      expect(again.savedAt).toBe(first.savedAt);
      const snaps = readdirSync(join(dir, "autosave")).filter((f) =>
        f.startsWith("snap-"),
      );
      expect(snaps).toHaveLength(1);

      const changed = writeLocalAutosave(dir, { teachers: [{ id: "t2" }] });
      expect(changed.unchanged).toBeUndefined();
      expect(
        readdirSync(join(dir, "autosave")).filter((f) => f.startsWith("snap-")),
      ).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes to the twelve most recent snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "autosave-prune-"));
    try {
      for (let i = 0; i < 15; i += 1) {
        writeLocalAutosave(dir, { n: i });
      }
      const snaps = readdirSync(join(dir, "autosave")).filter((f) =>
        f.startsWith("snap-"),
      );
      expect(snaps).toHaveLength(12);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when nothing has been saved", () => {
    const dir = mkdtempSync(join(tmpdir(), "autosave-empty-"));
    try {
      expect(readLocalAutosaveMeta(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
