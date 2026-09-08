import { useMemo, useRef, useState } from "react";
import {
  assertMutable,
  importUploadOfficerMessage,
  previewTeacherImport,
  shouldApplySessionAfterApi,
} from "@exam-duty/shared";
import { useApp } from "../state/AppContext";
import { Panel } from "../components/ui";

export function ImportPage() {
  const {
    dataset,
    logAudit,
    role,
    applyImportPreview,
    schoolHistory,
    locationHistory,
    examCycle,
  } = useApp();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [lastImportId, setLastImportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [missingAction, setMissingAction] = useState<"leave" | "deactivate">(
    "leave",
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const uploadGenRef = useRef(0);
  const uploadPromiseRef = useRef<Promise<string | null>>(
    Promise.resolve(null),
  );

  function clearArchivedImport() {
    uploadGenRef.current += 1;
    uploadPromiseRef.current = Promise.resolve(null);
    setUploadBusy(false);
    setLastImportId(null);
    setFileName(null);
  }

  const canImport =
    role === "ADMIN" || role === "OFFICER" || role === "DATA_OPERATOR";
  const cycleMutable = assertMutable(examCycle.status, "apply import").ok;

  const preview = useMemo(() => {
    if (!dataset || !text.trim()) return null;
    try {
      const rows = JSON.parse(text) as unknown[];
      if (!Array.isArray(rows))
        throw new Error("Expected a JSON array of teacher rows");
      const existing = dataset.teachers.map((t) => {
        const school = dataset.schools.find((s) => s.schoolId === t.schoolId);
        return {
          employeeCode: t.employeeCode,
          name: t.name,
          schoolCode: school?.schoolCode ?? t.schoolId,
          designation: t.designation,
          isActive: t.isActive,
        };
      });
      return previewTeacherImport(rows, existing);
    } catch (e) {
      return { parseError: e instanceof Error ? e.message : "Parse error" };
    }
  }, [text, dataset]);

  if (!dataset) return <Panel title="Imports">Loading…</Panel>;

  async function onExcelFile(file: File) {
    const gen = ++uploadGenRef.current;
    setError(null);
    setMessage(null);
    setUploadBusy(true);
    const run = (async (): Promise<string | null> => {
      try {
        const { parseTeachersWorkbook } = await import("@exam-duty/shared");
        const buf = await file.arrayBuffer();
        const parsed = await parseTeachersWorkbook(buf);
        if (parsed.headerErrors.length) {
          if (gen === uploadGenRef.current) {
            setError(parsed.headerErrors.join("; "));
            setLastImportId(null);
          }
          return null;
        }
        if (gen !== uploadGenRef.current) return null;
        setFileName(file.name);
        setText(JSON.stringify(parsed.rows, null, 2));
        logAudit(
          "IMPORT",
          `Parsed Excel ${file.name} rows=${parsed.rows.length}`,
        );
        const { uploadImportApi } = await import("../lib/api");
        const up = await uploadImportApi(role, file, {
          rowCount: parsed.rows.length,
        });
        if (gen !== uploadGenRef.current) return null;
        if (up?.importId) {
          setLastImportId(up.importId);
          setMessage(
            importUploadOfficerMessage(
              {
                importId: up.importId,
                fileHash: up.fileHash,
                stored: up.stored,
              },
              parsed.rows.length,
            ),
          );
          return up.importId;
        }
        setLastImportId(null);
        setError(
          up?.error ??
            "Upload archive failed — apply will not attach file provenance",
        );
        return null;
      } catch (e) {
        if (gen === uploadGenRef.current) {
          setError(e instanceof Error ? e.message : "Failed to parse Excel");
          setLastImportId(null);
        }
        return null;
      } finally {
        if (gen === uploadGenRef.current) setUploadBusy(false);
      }
    })();
    uploadPromiseRef.current = run;
    await run;
  }

  return (
    <div className="space-y-4">
      <Panel title="Excel import preview">
        <p className="text-sm text-[var(--color-ink-muted)] mb-3">
          Uploads record provenance when the API accepts them. The file is
          archived only when object storage is bound (R2) or on the local filesystem in api:local;
          a stored:false receipt means the file was not archived. Parse .xlsx locally, preview
          deltas, then apply — history rows are written; nothing is silently
          deleted. Teacher school-history entries (session + API hydrate):{" "}
          {schoolHistory.length}. Location-history rows (display only, not
          scored — OQ-001 / OQ-004): {locationHistory.length}.
        </p>
        {!canImport && (
          <p className="text-sm text-[var(--color-err)] mb-3">
            Role {role} cannot apply imports (backend would also reject).
          </p>
        )}
        {canImport && !cycleMutable && (
          <p className="text-sm text-[var(--color-err)] mb-3">
            Cycle {examCycle.status} — apply is frozen. Create an amendment to
            change the teacher roster used by this published allocation.
          </p>
        )}

        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <label className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm cursor-pointer">
            Upload .xlsx
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              data-testid="upload-xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onExcelFile(f);
              }}
            />
          </label>
          <button
            type="button"
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
            onClick={() => {
              void (async () => {
                const { buildTeachersTemplateWorkbook } =
                  await import("@exam-duty/shared");
                const sample = dataset.teachers.slice(0, 8).map((t) => {
                  const school = dataset.schools.find(
                    (s) => s.schoolId === t.schoolId,
                  );
                  return {
                    employeeCode: t.employeeCode,
                    name: t.name,
                    schoolCode: school?.schoolCode ?? "S1",
                    designation: t.designation,
                    subject: t.subject,
                    seniorityRank: t.seniorityRank,
                    isActive: true,
                  };
                });
                const buf = await buildTeachersTemplateWorkbook(sample);
                const blob = new Blob([buf], {
                  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "teachers-template-synthetic.xlsx";
                a.click();
                URL.revokeObjectURL(url);
              })();
            }}
          >
            Download template .xlsx
          </button>
          {fileName && (
            <span className="text-xs text-[var(--color-ink-muted)]">
              Loaded: {fileName}
            </span>
          )}
        </div>

        <textarea
          className="w-full h-40 border border-[var(--color-line)] rounded p-2 font-mono text-xs"
          placeholder='[{"employeeCode":"SYN0001","name":"Synthetic Teacher 1","schoolCode":"S1","designation":"HM"}]'
          value={text}
          onChange={(e) => {
            clearArchivedImport();
            setText(e.target.value);
            setError(null);
            setMessage(null);
          }}
        />
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <button
            type="button"
            className="rounded bg-[var(--color-brand)] text-white px-3 py-2 text-sm"
            data-testid="load-sample-diff"
            onClick={() => {
              clearArchivedImport();
              const sample = dataset.teachers.slice(0, 5).map((t) => {
                const school = dataset.schools.find(
                  (s) => s.schoolId === t.schoolId,
                );
                return {
                  employeeCode: t.employeeCode,
                  name:
                    t.name + (t.employeeCode.endsWith("1") ? " Updated" : ""),
                  schoolCode: school?.schoolCode ?? "S1",
                  designation: t.designation,
                  isActive: true,
                };
              });
              sample.push({
                employeeCode: "SYN9999",
                name: "Brand New Synthetic",
                schoolCode: dataset.schools[0]!.schoolCode,
                designation: "PG",
                isActive: true,
              });
              setText(JSON.stringify(sample, null, 2));
            }}
          >
            Load sample diff
          </button>
          <label className="text-sm flex items-center gap-2">
            Missing-from-file
            <select
              className="border border-[var(--color-line)] rounded px-2 py-1"
              value={missingAction}
              onChange={(e) =>
                setMissingAction(e.target.value as "leave" | "deactivate")
              }
            >
              <option value="leave">Leave unchanged (OQ-014 default)</option>
              <option value="deactivate">Deactivate explicitly</option>
            </select>
          </label>
          <button
            type="button"
            data-testid="apply-import"
            disabled={
              !canImport ||
              !cycleMutable ||
              !preview ||
              "parseError" in (preview ?? {}) ||
              busy ||
              uploadBusy
            }
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-40"
            onClick={() => {
              if (
                !preview ||
                "parseError" in preview ||
                busyRef.current ||
                uploadBusy
              )
                return;
              const gate = assertMutable(examCycle.status, "apply import");
              if (!gate.ok) {
                setError(gate.error);
                return;
              }
              busyRef.current = true;
              setBusy(true);
              void (async () => {
                try {
                  const archivedId = await uploadPromiseRef.current;
                  const result = await applyImportPreview(preview, {
                    missingAction,
                    importId: archivedId ?? lastImportId ?? undefined,
                    rows: preview.rows.map((r) => ({
                      rowNumber: r.rowNumber,
                      status: r.status,
                      entityKey: r.employeeCode,
                      message: r.message,
                    })),
                  });
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setMessage(result.message);
                  setError(null);
                } finally {
                  busyRef.current = false;
                  setBusy(false);
                }
              })();
            }}
          >
            {uploadBusy ? "Uploading…" : busy ? "Applying…" : "Apply import (preserve history)"}
          </button>
        </div>
        {error && (
          <p className="text-[var(--color-err)] text-sm mt-2">{error}</p>
        )}
        {message && (
          <p className="text-[var(--color-ok)] text-sm mt-2">{message}</p>
        )}
        {preview && "parseError" in preview && (
          <p className="text-[var(--color-err)] text-sm mt-2">
            {preview.parseError}
          </p>
        )}
        {preview && !("parseError" in preview) && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
              <Stat label="New teachers" value={preview.newTeachers} />
              <Stat label="Updated teachers" value={preview.updatedTeachers} />
              <Stat label="Missing from file" value={preview.missingFromFile} />
              <Stat label="Unchanged" value={preview.unchanged} />
              <Stat label="Invalid rows" value={preview.invalidRows} />
              <Stat label="Duplicates" value={preview.duplicates} />
            </div>
            <div className="overflow-auto max-h-64 border border-[var(--color-line)] rounded text-sm">
              <table className="min-w-full">
                <thead className="bg-[var(--color-sky-wash)]">
                  <tr>
                    <th className="text-left px-2 py-1">Row</th>
                    <th className="text-left px-2 py-1">Status</th>
                    <th className="text-left px-2 py-1">Code</th>
                    <th className="text-left px-2 py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 100).map((r, i) => (
                    <tr key={i} className="border-t border-[var(--color-line)]">
                      <td className="px-2 py-1">{r.rowNumber}</td>
                      <td className="px-2 py-1">{r.status}</td>
                      <td className="px-2 py-1">{r.employeeCode}</td>
                      <td className="px-2 py-1">{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      <PracticalFormatImportPanel
        canImport={canImport}
        logAudit={logAudit}
        onForm01Rows={(rows) => {
          clearArchivedImport();
          setText(JSON.stringify(rows, null, 2));
          setMessage(
            `Loaded ${rows.length} FORM-01 rows into teacher import preview`,
          );
          setError(null);
        }}
      />
    </div>
  );
}

function PracticalFormatImportPanel({
  canImport,
  logAudit,
  onForm01Rows,
}: {
  canImport: boolean;
  logAudit: (action: string, detail: string) => void;
  onForm01Rows: (rows: Array<Record<string, unknown>>) => void;
}) {
  const { dataset, setDataset, setPracticalBatchDemand, role, examCycle } =
    useApp();
  const [clubbingMsg, setClubbingMsg] = useState<string | null>(null);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const [strengthMsg, setStrengthMsg] = useState<string | null>(null);
  const [form01Msg, setForm01Msg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<null | "clubbing" | "capacity">(
    null,
  );
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

  async function sheetToAoa(file: File, sheetIndex = 0) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const sheet = wb.worksheets[sheetIndex];
    if (!sheet) throw new Error("No sheets");
    const aoa: unknown[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[];
      aoa.push((values ?? []).slice(1));
    });
    return { wb, aoa, sheetName: sheet.name };
  }

  async function onClubbing(file: File) {
    if (!dataset) return;
    if (!startBusy("clubbing")) return;
    setErr(null);
    const gate = assertMutable(examCycle.status, "apply clubbing");
    if (!gate.ok) {
      setErr(gate.error);
      stopBusy();
      return;
    }
    try {
      const { aoa } = await sheetToAoa(file);
      const mod = await import("@exam-duty/shared");
      const { rows, errors } = mod.parsePracticalClubbingAoa(aoa);
      if (errors.length) setErr(errors.join("; "));
      const applied = mod.applyPracticalClubbing({
        rows,
        schools: dataset.schools,
        centres: dataset.centres,
        existing: dataset.relationships,
        asOfDate: new Date().toISOString().slice(0, 10),
      });
      const { applyClubbingApi } = await import("../lib/api");
      const api = await applyClubbingApi(role, {
        asOfDate: new Date().toISOString().slice(0, 10),
        examCycleId: examCycle.examCycleId,
        relationships: applied.relationships
          .filter((r) => r.relationshipType === "CLUBBED" && !r.effectiveTo)
          .map((r) => ({
            centreId: r.centreId,
            schoolId: r.schoolId,
            relationshipType: "CLUBBED" as const,
            effectiveFrom: r.effectiveFrom,
            effectiveTo: r.effectiveTo ?? null,
          })),
      });
      const decision = shouldApplySessionAfterApi(api);
      if (!decision.apply) {
        setErr(decision.error);
        return;
      }
      setDataset({
        ...dataset,
        relationships: applied.relationships.map(
          ({ subjectScope: _s, ...r }) => r,
        ),
        meta: {
          ...dataset.meta,
          counts: {
            ...dataset.meta.counts,
            relationships: applied.relationships.length,
          },
        },
      });
      setClubbingMsg(
        `Applied ${applied.applied} clubbing link(s). Unmatched schools=${applied.unmatchedSchools.length} centres=${applied.unmatchedCentres.length}` +
          (api?.ok
            ? ` · API inserted ${api.inserted} (closed ${api.closed})`
            : ""),
      );
      logAudit(
        "IMPORT",
        `Applied practical clubbing applied=${applied.applied} unmatchedSchools=${applied.unmatchedSchools.length}`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Clubbing apply failed");
    } finally {
      stopBusy();
    }
  }

  async function onBatch(file: File) {
    setErr(null);
    try {
      const { aoa } = await sheetToAoa(file);
      const mod = await import("@exam-duty/shared");
      const { rows, errors } = mod.parsePracticalBatchDemandAoa(aoa);
      if (errors.length) setErr(errors.join("; "));
      const demand = rows
        .filter((r) => !r.isSchoolTotal)
        .map((r) => ({
          schoolCode: r.schoolCode,
          subject: r.subject,
          batchCount: r.batchCount,
        }));
      setPracticalBatchDemand(demand);
      setBatchMsg(
        `Stored ${demand.length} school×subject batch row(s) for Practical generate (matched by school code)`,
      );
      logAudit("IMPORT", `Practical batch demand rows=${demand.length}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Batch parse failed");
    }
  }

  async function onStrength(file: File) {
    if (!dataset) return;
    if (!startBusy("capacity")) return;
    setErr(null);
    const gate = assertMutable(examCycle.status, "update centre capacity");
    if (!gate.ok) {
      setErr(gate.error);
      stopBusy();
      return;
    }
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const preferred =
        wb.worksheets.find((s) => /strength|centre/i.test(s.name)) ??
        wb.worksheets[0];
      if (!preferred) throw new Error("No sheets");
      const aoa: unknown[][] = [];
      preferred.eachRow({ includeEmpty: true }, (row) => {
        const values = row.values as unknown[];
        aoa.push((values ?? []).slice(1));
      });
      const mod = await import("@exam-duty/shared");
      const { rows, errors } = mod.parseCentreStrengthAoa(aoa);
      if (errors.length) setErr(errors.join("; "));
      const applied = mod.applyCentreStrengths({
        rows,
        centres: dataset.centres,
      });
      const { updateCentreCapacityApi } = await import("../lib/api");
      const api = await updateCentreCapacityApi(
        role,
        applied.centres
          .filter((c) => typeof c.capacity === "number")
          .map((c) => ({
            centreId: String(c.centreId),
            capacity: Number(c.capacity),
          })),
        examCycle.examCycleId,
      );
      const decision = shouldApplySessionAfterApi(api);
      if (!decision.apply) {
        setErr(decision.error);
        return;
      }
      setDataset({
        ...dataset,
        centres: applied.centres as typeof dataset.centres,
      });
      setStrengthMsg(
        `Updated capacity on ${applied.applied} centre(s) from ${preferred.name}. Unmatched=${applied.unmatched.length}` +
          (api?.ok ? ` · API updated ${api.updated} centres` : ""),
      );
      logAudit("IMPORT", `Centre strength applied=${applied.applied}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Strength import failed");
    } finally {
      stopBusy();
    }
  }

  async function onForm01(file: File) {
    setErr(null);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const mod = await import("@exam-duty/shared");
      const allRows: Array<Record<string, unknown>> = [];
      const errors: string[] = [];
      for (const sheet of wb.worksheets) {
        const aoa: unknown[][] = [];
        sheet.eachRow({ includeEmpty: true }, (row) => {
          const values = row.values as unknown[];
          aoa.push((values ?? []).slice(1));
        });
        const parsed = mod.parseForm01SeniorityAoa(aoa, sheet.name);
        errors.push(...parsed.errors);
        for (const r of parsed.rows) {
          allRows.push({
            employeeCode: r.employeeCode,
            name: r.name,
            schoolCode: r.schoolCode,
            designation: r.designation,
            subject: r.subject,
            seniorityRank: r.seniorityRank,
            isActive: true,
          });
        }
      }
      if (errors.length) setErr(errors.slice(0, 5).join("; "));
      onForm01Rows(allRows);
      setForm01Msg(
        `Parsed ${allRows.length} FORM-01 row(s) across ${wb.worksheets.length} sheet(s) with synthetic employee codes (SYN-…). Loaded into teacher import preview above.`,
      );
      logAudit("IMPORT", `FORM-01 parsed rows=${allRows.length}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "FORM-01 parse failed");
    }
  }

  return (
    <Panel title="Client practical / centre / seniority layouts">
      <p className="text-sm text-[var(--color-ink-muted)] mb-3">
        Apply clubbing and centre strength into the in-memory master; store
        batch demand for Practical; parse FORM-01 with{" "}
        <strong>synthetic</strong> employee codes only. Do not commit real
        client PII. QP labels remain OQ-019.
      </p>
      <div className="flex flex-wrap gap-2">
        <label
          className={`rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm ${
            !canImport || busy
              ? "pointer-events-none opacity-40"
              : "cursor-pointer"
          }`}
        >
          {busyKind === "clubbing" ? "Applying…" : "Apply clubbing .xlsx"}
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            data-testid="upload-clubbing-xlsx"
            disabled={!canImport || busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onClubbing(f);
            }}
          />
        </label>
        <label
          className={`rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm ${
            !canImport || busy
              ? "pointer-events-none opacity-40"
              : "cursor-pointer"
          }`}
        >
          Load batch-demand .xlsx
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            data-testid="upload-batch-demand-xlsx"
            disabled={!canImport || busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onBatch(f);
            }}
          />
        </label>
        <label
          className={`rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm ${
            !canImport || busy
              ? "pointer-events-none opacity-40"
              : "cursor-pointer"
          }`}
        >
          {busyKind === "capacity" ? "Applying…" : "Apply centre strength .xlsx"}
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            data-testid="upload-centre-strength-xlsx"
            disabled={!canImport || busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onStrength(f);
            }}
          />
        </label>
        <label
          className={`rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm ${
            !canImport || busy
              ? "pointer-events-none opacity-40"
              : "cursor-pointer"
          }`}
        >
          Parse FORM-01 seniority .xlsx
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            data-testid="upload-form01-xlsx"
            disabled={!canImport || busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onForm01(f);
            }}
          />
        </label>
      </div>
      {clubbingMsg && (
        <p className="text-sm mt-2 text-[var(--color-ok)]">{clubbingMsg}</p>
      )}
      {batchMsg && (
        <p className="text-sm mt-2 text-[var(--color-ok)]">{batchMsg}</p>
      )}
      {strengthMsg && (
        <p className="text-sm mt-2 text-[var(--color-ok)]">{strengthMsg}</p>
      )}
      {form01Msg && (
        <p className="text-sm mt-2 text-[var(--color-ok)]">{form01Msg}</p>
      )}
      {err && <p className="text-sm mt-2 text-[var(--color-err)]">{err}</p>}
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-[var(--color-line)] bg-white px-3 py-2">
      <p className="text-xs text-[var(--color-ink-muted)]">{label}</p>
      <p className="font-display text-xl">{value}</p>
    </div>
  );
}
