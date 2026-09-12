import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { Badge, Bento, EmptyState, Tile, TileHeader } from "../components/ui";
import {
  backupArchiveOfficerMessage,
  backupCatalogListNote,
  backupCatalogRowHasStoredPayload,
  buildOfflineContingencyPayload,
  inlineCanonicalBackupPayload,
  isLoadableBackupPayload,
} from "@exam-duty/shared";
import { decryptJson, encryptJson } from "../lib/backupCrypto";
import {
  backupApi,
  fetchBackupPayload,
  listBackupsApi,
  restoreApi,
} from "../lib/api";

type ServerBackup = {
  backup_id: string;
  created_at: string;
  created_by?: string | null;
  trigger_reason?: string | null;
  checksum?: string | null;
  status?: string;
  r2_key?: string | null;
};

export function BackupPage() {
  const { dataset, role, logAudit, examCycle } = useApp();
  const canBackup = role === "ADMIN" || role === "OFFICER";
  const [passphrase, setPassphrase] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [pendingChecksum, setPendingChecksum] = useState<string | undefined>();
  const [includeHistory, setIncludeHistory] = useState(false);
  const [serverBackups, setServerBackups] = useState<ServerBackup[]>([]);
  const [listNote, setListNote] = useState<string>("Loading backup catalog…");
  const [busyKind, setBusyKind] = useState<
    null | "archive" | "restore" | "download"
  >(null);
  const busyRef = useRef(false);
  const busy = busyKind !== null;

  function startBusy(kind: NonNullable<typeof busyKind>) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusyKind(kind);
    return true;
  }
  function stopBusy() {
    busyRef.current = false;
    setBusyKind(null);
  }

  const refreshServerBackups = useCallback(async () => {
    if (!canBackup) {
      setListNote("OFFICER/ADMIN required to list the backup catalog");
      setServerBackups([]);
      return;
    }
    const listed = await listBackupsApi(role);
    if (!listed) {
      setListNote("Saved data is unavailable. Reopen the app to try again.");
      setServerBackups([]);
      return;
    }
    if ("error" in listed && listed.error && !listed.backups) {
      setListNote(listed.error);
      setServerBackups([]);
      return;
    }
    const rows = listed.backups ?? [];
    setServerBackups(rows);
    setListNote(backupCatalogListNote(rows));
  }, [canBackup, role]);

  useEffect(() => {
    void refreshServerBackups();
  }, [refreshServerBackups]);

  async function downloadEncrypted() {
    if (!startBusy("download")) return;
    try {
      const archived = await backupApi(
        role,
        null,
        "officer-encrypted-canonical",
        { fromServer: true },
      );
      const inline = inlineCanonicalBackupPayload(archived);
      let payload: Record<string, unknown> | null = inline;
      let usedCanonical = Boolean(inline);
      let usedInline = Boolean(inline);
      if (!payload && archived?.backupId && !archived.error) {
        const got = await fetchBackupPayload(role, archived.backupId);
        if (got?.payload && !got.error) {
          payload = got.payload as Record<string, unknown>;
          usedCanonical = true;
        }
      }
      if (!payload) {
        payload = dataset
          ? buildOfflineContingencyPayload({
              examCycleName: examCycle.name,
              examCycleStatus: examCycle.status,
              ruleVersionLabel: examCycle.ruleVersionLabel,
              teachers: dataset.teachers,
              schools: dataset.schools,
              centres: dataset.centres,
              relationships: dataset.relationships,
              history: dataset.history,
              blocks: dataset.blocks,
            })
          : null;
      }
      if (!payload) return;
      const blob = await encryptJson(payload, passphrase);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `exam-duty-backup-${Date.now()}.bin`;
      a.click();
      URL.revokeObjectURL(url);
      logAudit(
        "BACKUP",
        usedCanonical
          ? "Downloaded password-protected backup"
          : "Downloaded partial backup — full saved data unavailable",
      );
      void refreshServerBackups();
      setMsg(
        usedInline
          ? "Backup downloaded. No extra copy was saved in the app."
          : usedCanonical
            ? "Backup downloaded and a copy saved in the app."
            : "Only a partial backup could be downloaded. It cannot recover all your work. Reopen the app and create a full backup.",
      );
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Backup failed");
    } finally {
      stopBusy();
    }
  }

  async function archiveFromServer() {
    if (!canBackup) return;
    if (!startBusy("archive")) return;
    try {
      const r = await backupApi(role, null, "manual-server-archive", {
        fromServer: true,
      });
      if (!r) {
        setErr("Saved data is unavailable. Reopen the app to try again.");
        return;
      }
      if (r.error) {
        setErr(r.error);
        return;
      }
      if (!r.backupId) {
        setErr("API did not return a backup id");
        return;
      }
      const notice = backupArchiveOfficerMessage(r);
      logAudit(
        "BACKUP",
        notice.ok
          ? `Server-canonical archive ${r.backupId}`
          : `Backup catalog ${r.backupId} recorded without stored payload`,
      );
      if (notice.ok) {
        setMsg(notice.text);
        setErr(null);
      } else {
        setErr(notice.text);
        setMsg(null);
      }
      void refreshServerBackups();
    } finally {
      stopBusy();
    }
  }

  async function loadServerBackup(row: ServerBackup) {
    if (!backupCatalogRowHasStoredPayload(row)) {
      setErr(
        "This catalog row has no stored payload — Download encrypted backup to keep a copy. Load for restore needs the file.",
      );
      setMsg(null);
      return;
    }
    const got = await fetchBackupPayload(role, row.backup_id);
    if (!got) {
      setErr("Saved data is unavailable");
      return;
    }
    if (got.error || !isLoadableBackupPayload(got.payload)) {
      setErr(got.error ?? "Backup payload unavailable");
      return;
    }
    const payload = got.payload;
    setPendingPayload(payload);
    setPendingChecksum(got.checksum ?? row.checksum ?? undefined);
    const teachers = payload.teachers as unknown[] | undefined;
    setMsg(
      `Server backup ${row.backup_id} loaded — teachers=${teachers?.length ?? 0}. Confirm restore (ADMIN). Checksum gate ${got.checksum ? "armed" : "missing"}.`,
    );
    setErr(null);
    logAudit("RESTORE", `Loaded server backup ${row.backup_id} for preview`);
  }

  async function restorePreview(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const payload = (await decryptJson(buf, passphrase)) as Record<
        string,
        unknown
      >;
      if (!isLoadableBackupPayload(payload)) {
        setPendingPayload(null);
        setPendingChecksum(undefined);
        setErr(
          "Decrypted file is not a restore snapshot — needs teachers, schools, and centres arrays. Catalog receipts and error JSON cannot be restored.",
        );
        setMsg(null);
        return;
      }
      setPendingPayload(payload);
      setPendingChecksum(undefined);
      const teachers = payload.teachers as unknown[];
      setMsg(
        `Restore preview OK — teachers=${teachers.length}. Confirm transactional restore below (ADMIN only).`,
      );
      setErr(null);
      logAudit("RESTORE", "Validated encrypted backup decrypt preview");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Restore preview failed");
    }
  }

  async function confirmRestore() {
    if (!pendingPayload) return;
    if (!isLoadableBackupPayload(pendingPayload)) {
      setErr(
        "Pending payload is not a restore snapshot — needs teachers, schools, and centres arrays",
      );
      return;
    }
    if (role !== "ADMIN") {
      setErr("Only ADMIN may apply transactional restore");
      return;
    }
    if (!startBusy("restore")) return;
    try {
      const api = await restoreApi(role, pendingPayload, {
        includeHistory,
        expectedChecksum: pendingChecksum,
      });
      if (!api) {
        setErr("Saved data is unavailable. Reopen the app to try again.");
        return;
      }
      if (!api.ok) {
        setErr(api.error ?? "Restore failed");
        return;
      }
      setMsg(
        `Restore applied: ${JSON.stringify(api.counts)} — reloading saved data`,
      );
      setErr(null);
      window.location.reload();
    } finally {
      stopBusy();
    }
  }

  return (
    <Bento>
      <Tile span={3} rowSpan={2}>
        <TileHeader
          title="Backup & restore"
          hint="Keep a separate copy of your data. Restore a backup only when you want to replace current data with that copy."
          action={
            pendingPayload ? (
              <Badge tone={pendingChecksum ? "ok" : "warn"}>
                {pendingChecksum ? "checksum armed" : "no checksum"}
              </Badge>
            ) : null
          }
        />
        <label className="mb-2 block text-sm">
          Passphrase (encrypted .bin only)
          <input
            type="password"
            className="mt-1 w-full border border-[var(--color-line)] rounded px-2 py-1"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Backup password"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canBackup || !dataset || !passphrase.trim() || busy}
            onClick={() => void downloadEncrypted()}
            className="rounded bg-[var(--color-brand)] text-white px-4 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "download"
              ? "Downloading…"
              : "Download encrypted backup"}
          </button>
          <button
            type="button"
            data-testid="archive-server"
            disabled={!canBackup || busy}
            onClick={() => void archiveFromServer()}
            className="rounded border border-[var(--color-line)] bg-white px-4 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "archive" ? "Archiving…" : "Archive from server"}
          </button>
          <label className="rounded border border-[var(--color-line)] bg-white px-4 py-2 text-sm cursor-pointer">
            Preview encrypted restore…
            <input
              type="file"
              accept=".bin,application/octet-stream"
              className="hidden"
              disabled={!canBackup || !passphrase.trim() || busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void restorePreview(f);
              }}
            />
          </label>
          <button
            type="button"
            data-testid="confirm-restore"
            disabled={role !== "ADMIN" || !pendingPayload || busy}
            onClick={() => void confirmRestore()}
            className="rounded bg-[var(--color-brand-accent)] text-white px-4 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "restore" ? "Restoring…" : "Confirm transactional restore (ADMIN)"}
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeHistory}
            onChange={(e) => setIncludeHistory(e.target.checked)}
            disabled={role !== "ADMIN"}
          />
          Include published history wipe+reload (disaster recovery only)
        </label>
        {msg && <p className="mt-3 text-sm text-[var(--color-ok)]">{msg}</p>}
        {err && <p className="mt-3 text-sm text-[var(--color-err)]">{err}</p>}
      </Tile>

      <Tile span={3} rowSpan={2}>
        <TileHeader
          title="Backup catalog"
          hint="Newest first. Load for restore only when the payload was stored (status STORED). Catalog-only rows (RECORDED_NO_R2) have no file."
          action={
            <button
              type="button"
              onClick={() => void refreshServerBackups()}
              className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs"
            >
              Refresh
            </button>
          }
        />
        <p
          className="mb-2 text-xs text-[var(--color-ink-muted)]"
          data-testid="backup-list-note"
        >
          {listNote}
        </p>
        {serverBackups.length === 0 ? (
          <EmptyState
            title="No catalog rows yet"
            body="Archive from server records a catalog row and stores the file when object storage is bound. Download encrypted uses that file, or the inline snapshot when the worker returns stored=false. Load for restore is offered only for stored rows."
          />
        ) : (
          <ul className="max-h-[26rem] space-y-2 overflow-auto pr-1 text-sm">
            {serverBackups.map((b) => {
              const hasStored = backupCatalogRowHasStoredPayload(b);
              return (
                <li
                  key={b.backup_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] px-3 py-2"
                >
                  <div>
                    <div className="font-mono text-xs">{b.backup_id}</div>
                    <div
                      className="text-[var(--color-ink-muted)] text-xs"
                      data-testid="backup-row-status"
                    >
                      {hasStored ? (b.status ?? "STORED") : "payload not stored"}
                      {b.created_at ? ` · ${b.created_at}` : ""}
                      {b.trigger_reason ? ` · ${b.trigger_reason}` : ""}
                      {b.checksum ? ` · ${b.checksum.slice(0, 12)}…` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={
                      hasStored ? "load-for-restore" : "payload-not-stored"
                    }
                    className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs disabled:opacity-40"
                    disabled={!canBackup || busy || !hasStored}
                    onClick={() => void loadServerBackup(b)}
                  >
                    {hasStored ? "Load for restore" : "Payload not stored"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Tile>
    </Bento>
  );
}
