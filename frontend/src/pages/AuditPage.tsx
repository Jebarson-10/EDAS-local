import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { Badge, Bento, EmptyState, Tile, TileHeader } from "../components/ui";
import { importDrilldownCounts } from "@exam-duty/shared";
import {
  fetchAudit,
  fetchExportRecords,
  fetchImportRows,
  fetchManualOverrides,
  fetchSourceImports,
} from "../lib/api";

type ApiAuditRow = {
  audit_id: string;
  user_id: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  timestamp: string;
  reason: string | null;
  new_value: string | null;
};

type OverrideRow = NonNullable<
  Awaited<ReturnType<typeof fetchManualOverrides>>
>["overrides"][number];
type ExportRow = NonNullable<
  Awaited<ReturnType<typeof fetchExportRecords>>
>["exports"][number];
type ImportRow = NonNullable<
  Awaited<ReturnType<typeof fetchSourceImports>>
>["imports"][number];
type ImportRowDetail = NonNullable<
  Awaited<ReturnType<typeof fetchImportRows>>
>["rows"][number];

/** Override values are stored as JSON blobs; show the teacher, fall back to raw. */
function teacherOf(value: string): string {
  try {
    const parsed = JSON.parse(value) as { teacherId?: string };
    return parsed?.teacherId ?? value;
  } catch {
    return value;
  }
}

export function AuditPage() {
  const { audit, role } = useApp();
  const [remote, setRemote] = useState<ApiAuditRow[]>([]);
  const [remoteNote, setRemoteNote] = useState("Checking API…");
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [exports, setExports] = useState<ExportRow[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [offline, setOffline] = useState(false);
  const [openImportId, setOpenImportId] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportRowDetail[] | null>(null);

  async function toggleRows(importId: string) {
    if (openImportId === importId) {
      setOpenImportId(null);
      return;
    }
    setOpenImportId(importId);
    setImportRows(null);
    const res = await fetchImportRows(role, importId);
    setImportRows(res?.rows ?? []);
  }

  const openDrill =
    importRows && openImportId
      ? importDrilldownCounts(importRows)
      : null;

  useEffect(() => {
    void (async () => {
      const [data, ov, ex, im] = await Promise.all([
        fetchAudit(role),
        fetchManualOverrides(role),
        fetchExportRecords(role),
        fetchSourceImports(role),
      ]);
      if (!data) {
        setOffline(true);
        setRemoteNote("API offline — showing in-session audit only");
        return;
      }
      setOffline(false);
      setRemote(data.entries ?? []);
      setRemoteNote(`${(data.entries ?? []).length} persisted row(s)`);
      setOverrides(ov?.overrides ?? []);
      setExports(ex?.exports ?? []);
      setImports(im?.imports ?? []);
    })();
  }, [role, audit.length]);

  return (
    <Bento>
      <Tile span={3}>
        <TileHeader
          title="This session"
          hint="Browser trail for the current officer session"
          action={<Badge>{audit.length} entries</Badge>}
        />
        <div className="max-h-[38vh] overflow-auto rounded-xl border border-[var(--color-line)] text-sm">
          <table className="min-w-full">
            <thead className="sticky top-0 bg-[var(--color-sky-wash)]">
              <tr>
                <th className="px-2 py-1 text-left">Time</th>
                <th className="px-2 py-1 text-left">Action</th>
                <th className="px-2 py-1 text-left">Detail</th>
                <th className="px-2 py-1 text-left">Reason</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-[var(--color-line)]">
                  <td className="whitespace-nowrap px-2 py-1">{a.timestamp}</td>
                  <td className="px-2 py-1 font-medium">{a.action}</td>
                  <td className="px-2 py-1">{a.detail}</td>
                  <td className="px-2 py-1">{a.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>

      <Tile span={3}>
        <TileHeader
          title="Persisted audit (D1/SQLite)"
          hint={remoteNote}
          action={
            <Badge tone={offline ? "warn" : "ok"}>
              {offline ? "offline" : "live"}
            </Badge>
          }
        />
        {remote.length === 0 ? (
          <EmptyState
            title={offline ? "API offline" : "No persisted audit rows"}
            body={
              offline
                ? "Start the API to read the durable audit_logs table. In-session entries above are not persistence."
                : "Publishing, overrides, imports and restores write here as soon as they run against the API."
            }
          />
        ) : (
          <div className="max-h-[38vh] overflow-auto rounded-xl border border-[var(--color-line)] text-sm">
            <table className="min-w-full">
              <thead className="sticky top-0 bg-[var(--color-sky-wash)]">
                <tr>
                  <th className="px-2 py-1 text-left">Time</th>
                  <th className="px-2 py-1 text-left">Action</th>
                  <th className="px-2 py-1 text-left">Entity</th>
                  <th className="px-2 py-1 text-left">Reason</th>
                </tr>
              </thead>
              <tbody>
                {remote.map((a) => (
                  <tr
                    key={a.audit_id}
                    className="border-t border-[var(--color-line)]"
                  >
                    <td className="whitespace-nowrap px-2 py-1">
                      {a.timestamp}
                    </td>
                    <td className="px-2 py-1 font-medium">{a.action}</td>
                    <td className="px-2 py-1">
                      {a.entity ?? "—"} {a.entity_id ? `(${a.entity_id})` : ""}
                    </td>
                    <td className="px-2 py-1">
                      {a.reason ?? a.new_value ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tile>

      <Tile span={6}>
        <TileHeader
          title="Manual overrides"
          hint="Every officer substitution is stored with a mandatory reason and the value it replaced"
          action={<Badge testId="override-count">{overrides.length}</Badge>}
        />
        {overrides.length === 0 ? (
          <EmptyState
            title="No manual overrides recorded"
            body="Overrides applied on the theory page persist here with the run, result, officer and reason."
          />
        ) : (
          <div className="max-h-[34vh] overflow-auto rounded-xl border border-[var(--color-line)] text-sm">
            <table className="min-w-full" data-testid="overrides-table">
              <thead className="sticky top-0 bg-[var(--color-sky-wash)]">
                <tr>
                  <th className="px-2 py-1 text-left">When</th>
                  <th className="px-2 py-1 text-left">By</th>
                  <th className="px-2 py-1 text-left">Module</th>
                  <th className="px-2 py-1 text-left">Slot</th>
                  <th className="px-2 py-1 text-left">From → To</th>
                  <th className="px-2 py-1 text-left">Reason</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr
                    key={o.override_id}
                    className="border-t border-[var(--color-line)]"
                  >
                    <td className="whitespace-nowrap px-2 py-1">
                      {o.changed_at}
                    </td>
                    <td className="px-2 py-1">{o.changed_by}</td>
                    <td className="px-2 py-1">{o.module ?? "—"}</td>
                    <td className="px-2 py-1 font-mono text-xs">
                      {[o.centre_id, o.role_code, o.exam_date, o.session_code]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-2 py-1 font-mono text-xs">
                      {teacherOf(o.old_value)} → {teacherOf(o.new_value)}
                    </td>
                    <td className="px-2 py-1">{o.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tile>

      <Tile span={3}>
        <TileHeader
          title="Import provenance"
          hint="Uploaded workbooks with SHA-256 and apply status"
          action={<Badge>{imports.length}</Badge>}
        />
        {imports.length === 0 ? (
          <EmptyState
            title="No uploads recorded"
            body="Uploading a workbook on the Imports page records its filename, hash and row count before anything is applied."
          />
        ) : (
          <ul
            className="max-h-80 space-y-2 overflow-auto pr-1 text-sm"
            data-testid="imports-list"
          >
            {imports.map((i) => (
              <li
                key={i.import_id}
                className="rounded-xl border border-[var(--color-line)] px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{i.filename}</span>
                  <Badge tone={i.status === "APPLIED" ? "ok" : "neutral"}>
                    {i.status ?? "UPLOADED"}
                  </Badge>
                </div>
                <p className="mt-0.5 font-mono text-[0.68rem] text-[var(--color-ink-muted)]">
                  {i.uploaded_at}
                  {i.row_count != null ? ` · ${i.row_count} file rows` : ""}
                  {i.file_hash ? ` · ${i.file_hash.slice(0, 12)}…` : ""}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    data-testid={`import-rows-${i.import_id}`}
                    className="text-xs text-[var(--color-brand)] underline"
                    onClick={() => void toggleRows(i.import_id)}
                  >
                    {openImportId === i.import_id
                      ? "Hide row outcomes"
                      : "Row outcomes"}
                  </button>
                  {openImportId === i.import_id &&
                  importRows &&
                  importRows.length > 0 ? (
                    <span
                      className="text-[0.68rem] text-[var(--color-ink-muted)]"
                      data-testid="import-rows-count"
                    >
                      {openDrill?.fileRows ?? 0} file rows ·{" "}
                      {openDrill?.outcomes ?? 0} outcomes
                    </span>
                  ) : null}
                </div>
                {openImportId === i.import_id ? (
                  importRows === null ? (
                    <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                      Loading…
                    </p>
                  ) : importRows.length === 0 ? (
                    <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                      No per-row provenance stored for this upload (applied
                      before row outcomes were recorded).
                    </p>
                  ) : (
                    <div
                      className="mt-2 max-h-40 overflow-auto rounded-lg border border-[var(--color-line)]"
                      data-testid="import-rows-table"
                    >
                      <table className="min-w-full text-xs">
                        <tbody>
                          {importRows.map((r) => (
                            <tr
                              key={r.id}
                              className="border-b border-[var(--color-line)] last:border-0"
                            >
                              <td className="px-2 py-1 tabular">
                                {r.row_number >= 0 ? r.row_number : "—"}
                              </td>
                              <td className="px-2 py-1">{r.status}</td>
                              <td className="px-2 py-1 font-mono">
                                {r.entity_key ?? "—"}
                              </td>
                              <td className="px-2 py-1 text-[var(--color-ink-muted)]">
                                {r.message ?? ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Tile>

      <Tile span={3}>
        <TileHeader
          title="Export receipts"
          hint="Who exported which report type and run. The file stays on the officer's machine — only the receipt is stored."
          action={<Badge>{exports.length}</Badge>}
        />
        {exports.length === 0 ? (
          <EmptyState
            title="No export receipts"
            body="Downloading a report from Reports records type, cycle and run here. The workbook, PDF or CSV is not uploaded or archived."
          />
        ) : (
          <ul
            className="max-h-56 space-y-2 overflow-auto pr-1 text-sm"
            data-testid="exports-list"
          >
            {exports.map((e) => (
              <li
                key={e.export_id}
                className="rounded-xl border border-[var(--color-line)] px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{e.export_type}</span>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    {e.created_by ?? "—"}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[0.68rem] text-[var(--color-ink-muted)]">
                  {e.created_at}
                  {e.run_id ? ` · run ${e.run_id.slice(0, 12)}…` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Tile>
    </Bento>
  );
}
