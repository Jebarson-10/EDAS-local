/** POST /api/backups and POST /api/imports success bodies (both surfaces). */
export type BackupWriteReceipt = {
  backupId?: string;
  checksum?: string;
  stored?: boolean;
  error?: string;
  payload?: Record<string, unknown>;
  note?: string;
};

export type ImportUploadReceipt = {
  importId?: string;
  fileHash?: string;
  stored?: boolean;
  error?: string;
};

/**
 * Worker without object storage still returns the canonical snapshot inline
 * (`stored: false` + `payload`). Local api:local always stores the file.
 */
export function inlineCanonicalBackupPayload(
  receipt: BackupWriteReceipt | null | undefined,
): Record<string, unknown> | null {
  if (!receipt || receipt.error) return null;
  if (receipt.stored !== false) return null;
  const payload = receipt.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload;
}

export function backupWasStored(
  receipt: BackupWriteReceipt | null | undefined,
): boolean {
  return Boolean(receipt?.backupId && !receipt.error && receipt.stored !== false);
}

export function backupArchiveOfficerMessage(
  receipt: BackupWriteReceipt,
): { ok: boolean; text: string } {
  const id = receipt.backupId ?? "";
  const checksum = receipt.checksum
    ? ` checksum=${receipt.checksum.slice(0, 12)}…`
    : "";
  if (receipt.stored === false) {
    return {
      ok: false,
      text: `Backup catalog ${id} recorded${checksum} — payload was not stored. Download encrypted backup to keep a copy; Load for restore needs the file.`,
    };
  }
  return {
    ok: true,
    text: `Server archive created: ${id}${checksum}`,
  };
}

export function publishBackupSuffix(
  receipt: BackupWriteReceipt | null | undefined,
): string {
  if (!receipt?.backupId || receipt.error) return "";
  if (receipt.stored === false) {
    return ` · backup catalog ${receipt.backupId.slice(0, 8)}… (payload not stored)`;
  }
  return ` · server backup ${receipt.backupId.slice(0, 8)}…`;
}

export function importUploadOfficerMessage(
  receipt: ImportUploadReceipt,
  rowCount: number,
): string {
  const id = (receipt.importId ?? "").slice(0, 8);
  const hash = receipt.fileHash?.slice(0, 12) ?? "n/a";
  if (receipt.stored === false) {
    return `Recorded upload ${id}… (file not archived) hash=${hash} · ${rowCount} rows`;
  }
  return `Archived upload ${id}… hash=${hash} · ${rowCount} rows`;
}

/** GET /api/backups catalog row (Worker + local). */
export type BackupCatalogRow = {
  backup_id: string;
  status?: string | null;
  r2_key?: string | null;
  checksum?: string | null;
  created_at?: string;
  created_by?: string | null;
  trigger_reason?: string | null;
};

/**
 * Worker still writes an r2_key for RECORDED_NO_R2 rows (the object was never
 * put). Load-for-restore must follow status, not the key string.
 */
export function backupCatalogRowHasStoredPayload(
  row: BackupCatalogRow | null | undefined,
): boolean {
  if (!row?.backup_id) return false;
  if (row.status === "RECORDED_NO_R2") return false;
  return Boolean(row.r2_key);
}

export function backupCatalogListNote(rows: BackupCatalogRow[]): string {
  if (rows.length === 0) {
    return "No catalog rows yet — download encrypted or archive from server";
  }
  const stored = rows.filter(backupCatalogRowHasStoredPayload).length;
  const unstored = rows.length - stored;
  if (unstored === 0) {
    return `${stored} stored archive(s)`;
  }
  if (stored === 0) {
    return `${unstored} catalog row(s) — payload not stored`;
  }
  return `${rows.length} catalog row(s) (${stored} stored, ${unstored} payload not stored)`;
}

/**
 * Refuse API error JSON, catalog receipts, and empty objects as a restore
 * snapshot (would 404-shape or empty-wipe). Canonical + offline contingency
 * both carry teachers, schools, and centres arrays — the same cores
 * transactionalRestore requires. A teachers array alone is not restorable.
 */
export function isLoadableBackupPayload(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (typeof rec.error === "string" && !Array.isArray(rec.teachers)) {
    return false;
  }
  return (
    Array.isArray(rec.teachers) &&
    Array.isArray(rec.schools) &&
    Array.isArray(rec.centres)
  );
}
