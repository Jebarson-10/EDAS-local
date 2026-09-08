import { describe, expect, it } from "vitest";
import {
  backupArchiveOfficerMessage,
  backupCatalogListNote,
  backupCatalogRowHasStoredPayload,
  backupWasStored,
  importUploadOfficerMessage,
  inlineCanonicalBackupPayload,
  isLoadableBackupPayload,
  publishBackupSuffix,
} from "./backupReceipt.js";

const canonical = {
  teachers: [{ teacherId: "t1" }],
  schools: [],
  centres: [],
  exam_cycles: [],
};

describe("inlineCanonicalBackupPayload", () => {
  it("uses the worker inline snapshot only when stored is false", () => {
    expect(
      inlineCanonicalBackupPayload({
        backupId: "bak-1",
        stored: false,
        payload: canonical,
      }),
    ).toEqual(canonical);
    expect(
      inlineCanonicalBackupPayload({
        backupId: "bak-1",
        stored: true,
        payload: canonical,
      }),
    ).toBeNull();
    expect(
      inlineCanonicalBackupPayload({
        backupId: "bak-1",
        stored: false,
        error: "nope",
        payload: canonical,
      }),
    ).toBeNull();
  });
});

describe("backup officer copy", () => {
  it("does not call an unstored catalog row a server archive", () => {
    expect(backupWasStored({ backupId: "bak-1", stored: false })).toBe(false);
    expect(backupWasStored({ backupId: "bak-1", stored: true })).toBe(true);
    expect(backupWasStored({ backupId: "bak-1" })).toBe(true);

    const unstored = backupArchiveOfficerMessage({
      backupId: "bak-1",
      stored: false,
      checksum: "abc123def456",
    });
    expect(unstored.ok).toBe(false);
    expect(unstored.text).toContain("payload was not stored");
    expect(unstored.text).not.toContain("Server archive created");

    const stored = backupArchiveOfficerMessage({
      backupId: "bak-1",
      stored: true,
      checksum: "abc123def456",
    });
    expect(stored.ok).toBe(true);
    expect(stored.text).toContain("Server archive created");

    expect(publishBackupSuffix({ backupId: "abcdef01-xxxx", stored: false })).toBe(
      " · backup catalog abcdef01… (payload not stored)",
    );
    expect(publishBackupSuffix({ backupId: "abcdef01-xxxx", stored: true })).toBe(
      " · server backup abcdef01…",
    );
  });
});

describe("backup catalog row stored payload", () => {
  it("refuses RECORDED_NO_R2 even when r2_key is present", () => {
    expect(
      backupCatalogRowHasStoredPayload({
        backup_id: "bak-unstored",
        status: "RECORDED_NO_R2",
        r2_key: "backups/bak-unstored.json",
      }),
    ).toBe(false);
    expect(
      backupCatalogRowHasStoredPayload({
        backup_id: "bak-stored",
        status: "STORED",
        r2_key: "backups/bak-stored.json",
      }),
    ).toBe(true);
    expect(
      backupCatalogRowHasStoredPayload({
        backup_id: "bak-nokey",
        status: "STORED",
        r2_key: null,
      }),
    ).toBe(false);
    expect(
      backupCatalogRowHasStoredPayload({
        backup_id: "bak-legacy",
        r2_key: "/tmp/bak.json",
      }),
    ).toBe(true);
  });

  it("lists catalog-only rows separately from stored archives", () => {
    expect(backupCatalogListNote([])).toContain("No catalog rows yet");
    expect(
      backupCatalogListNote([
        {
          backup_id: "a",
          status: "RECORDED_NO_R2",
          r2_key: "backups/a.json",
        },
      ]),
    ).toBe("1 catalog row(s) — payload not stored");
    expect(
      backupCatalogListNote([
        { backup_id: "a", status: "STORED", r2_key: "backups/a.json" },
        {
          backup_id: "b",
          status: "RECORDED_NO_R2",
          r2_key: "backups/b.json",
        },
      ]),
    ).toBe("2 catalog row(s) (1 stored, 1 payload not stored)");
  });

  it("does not treat GET error JSON as a restorable snapshot", () => {
    expect(
      isLoadableBackupPayload({
        error: "Backup payload was not stored",
        backupId: "bak-1",
        stored: false,
      }),
    ).toBe(false);
    expect(isLoadableBackupPayload({})).toBe(false);
    expect(isLoadableBackupPayload({ teachers: [] })).toBe(false);
    expect(
      isLoadableBackupPayload({ teachers: [], schools: [], centres: [] }),
    ).toBe(true);
    expect(isLoadableBackupPayload(canonical)).toBe(true);
    expect(
      isLoadableBackupPayload({
        backupId: "bak-1",
        stored: false,
        teachers: { length: 0 },
        schools: [],
        centres: [],
      }),
    ).toBe(false);
  });
});

describe("importUploadOfficerMessage", () => {
  it("does not claim archive when the file was not stored", () => {
    expect(
      importUploadOfficerMessage(
        { importId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", stored: false },
        12,
      ),
    ).toContain("file not archived");
    expect(
      importUploadOfficerMessage(
        {
          importId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          stored: true,
          fileHash: "deadbeefcafebabe",
        },
        12,
      ),
    ).toMatch(/^Archived upload aaaaaaaa…/);
  });
});
