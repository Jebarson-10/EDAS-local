import { useMemo, useRef, useState } from "react";
import {
  assertMutable,
  previewTeacherImport,
  prepareTeacherUpload,
  shouldApplySessionAfterApi,
} from "@exam-duty/shared";
import { useApp } from "../state/AppContext";
import { Panel } from "../components/ui";
import { ColumnImportPanel } from "../components/ColumnImportPanel";
import { CentreChecklistImport } from "../components/CentreChecklistImport";
import { PracticalStudentsImport } from "../components/PracticalStudentsImport";
import { StaffReturnReview } from "../components/StaffReturnReview";
import type { DemoDataset } from "../data/demoStore";

export function ImportPage() {
  const {
    dataset,
    logAudit,
    role,
    applyImportPreview,
    examCycle,
    setDataset,
  } = useApp();
  const [text, setText] = useState("");
  const [reviewProblemsOnly, setReviewProblemsOnly] = useState(false);
  const [reviewPage, setReviewPage] = useState(0);
  const uploadDetails = useMemo(() => {
    try { const rows = JSON.parse(text); return Array.isArray(rows) ? prepareTeacherUpload(rows) : null; }
    catch { return null; }
  }, [text]);
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
      const rows = uploadDetails?.rows ?? JSON.parse(text) as unknown[];
      if (!Array.isArray(rows))
        throw new Error("Expected a JSON array of teacher rows");
      const existing = dataset.teachers.map((t) => {
        return {
          ...t,
          employeeCode: t.employeeCode,
          teacherCode: t.teacherCode ?? null,
          name: t.name,
          schoolCode: t.schoolId,
          designation: t.designation,
          isActive: t.isActive,
        };
      });
      return previewTeacherImport(rows, existing, dataset.schools);
    } catch (e) {
      return { parseError: e instanceof Error ? e.message : "Parse error" };
    }
  }, [text, dataset, uploadDetails]);

  if (!dataset) return <Panel title="Imports">Loading…</Panel>;
  const currentDataset: DemoDataset = dataset;

  async function onExcelFile(file: File) {
    const gen = ++uploadGenRef.current;
    setError(null);
    setMessage(null);
    setText("");
    setReviewPage(0);
    setLastImportId(null);
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
        let officialMasterMessage = "";
        if (parsed.format === "official-staff-workbook") {
          const bySchool = new Map<string, { schoolName: string; sourceSchoolCode?: string | null; blockCode?: string | null }>();
          for (const row of parsed.rows) {
            const record = row as { schoolName?: unknown; sourceSchoolCode?: unknown; officialDetails?: Record<string, unknown> };
            const schoolName = String(record.schoolName ?? "").trim();
            if (!schoolName) continue;
            const key = schoolName.replace(/\s+/g, " ").toLocaleUpperCase();
            if (!bySchool.has(key)) bySchool.set(key, {
              schoolName,
              sourceSchoolCode: record.sourceSchoolCode == null ? null : String(record.sourceSchoolCode),
              blockCode: record.officialDetails?.["Reporting block"] == null ? null : String(record.officialDetails["Reporting block"]),
            });
          }
          const { importOfficialSchoolMasterData, fetchMasterBlocks, fetchMasterSchools } = await import("../lib/api");
          const master = await importOfficialSchoolMasterData(role, [...bySchool.values()]);
          if (!master?.ok) throw new Error(master?.error ?? "Could not create the schools from this official workbook.");
          const [blocks, schools] = await Promise.all([fetchMasterBlocks(role), fetchMasterSchools(role)]);
          if (!blocks || !schools) throw new Error("Schools were saved but the list could not refresh. Reopen the app, then upload the workbook again.");
          setDataset({
            ...currentDataset,
            blocks: blocks.blocks.map((block) => ({ blockId: block.block_id, blockCode: block.block_code, blockName: block.block_name })),
            schools: schools.schools.map((school) => ({ schoolId: school.school_id, schoolCode: school.school_code, sourceSchoolCode:school.source_school_code??undefined, schoolName: school.school_name, blockId: school.block_id, latitude: school.latitude ?? Number.NaN, longitude: school.longitude ?? Number.NaN, active: school.active !== 0 })),
          });
          officialMasterMessage = ` Created ${master.createdBlocks ?? 0} blocks and ${master.createdSchools ?? 0} schools; matched ${master.matchedSchools ?? 0} existing schools.${master.missingLocations?.length ? ` ${master.missingLocations.length} school locations still need to be added.` : ""}${master.skippedNoBlock?.length ? ` ${master.skippedNoBlock.length} schools had no block and were not created.` : ""}`;
        }
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
          const baseMessage = `Read ${parsed.rows.length} staff rows. ${up.stored === false ? "The original file was not stored; keep your own copy." : "A copy of the original file was saved."}`;
          setMessage(
            `${baseMessage}${parsed.format === "official-staff-workbook" ? " Official staff workbook recognised; all supported staff tabs were read together." : ""}${officialMasterMessage}${parsed.notes?.length ? ` ${parsed.notes[0]}` : ""}`,
          );
          return up.importId;
        }
        setLastImportId(null);
        setError(
          up?.error ??
            "The file could not be saved. Please upload it again.",
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

  async function downloadOfficialTemplate() {
    const { buildOfficialStaffTemplateWorkbook } = await import("@exam-duty/shared");
    const buffer = await buildOfficialStaffTemplateWorkbook();
    const url = URL.createObjectURL(new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "EDAS-official-staff-return-template.xlsx";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Panel title="Import your examination data"><p>1. Upload OVER ALL to save staff and schools. 2. Upload 13A to review centres and student numbers. 3. Add the timetable and practical subject counts. Then generate duties and download school-wise Duty-In and Duty-Out lists.</p></Panel>
      <details><summary className="cursor-pointer p-2">Other spreadsheets and column matching</summary><ColumnImportPanel onTeachers={(rows) => {
        clearArchivedImport();
        setText(rows.length ? JSON.stringify(rows) : "");
        setError(null); setMessage(null);
      }} /></details>
      <Panel title="1. Staff and schools (OVER ALL)">
        <p className="text-sm text-[var(--color-ink-muted)] mb-3">
          Upload the school staff return with its original sheet names. Check the preview, then save the staff. Schools and blocks are created from the file. Existing duty history is kept.
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
            Upload OVER ALL.xlsx
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
            onClick={() => void downloadOfficialTemplate()}
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
          >
            Download official staff template
          </button>
          {fileName && (
            <span className="text-xs text-[var(--color-ink-muted)]">
              Loaded: {fileName}
            </span>
          )}
        </div>

        {uploadDetails && <div className="mb-3 space-y-2 text-sm">
          <p>All staff sheets are read together. Schools are matched by their reference number, then by name. A school reference is not an exam centre code. Original post, subject, dates, contact and remarks are kept. Past-duty remarks must be checked before adding them to duty history.</p>
          {uploadDetails.notes.length > 0 && <details><summary className="cursor-pointer">Missing details to check before allotment</summary><ul className="mt-2 list-disc pl-5">{uploadDetails.notes.map((note) => <li key={note}>{note}</li>)}</ul></details>}
        </div>}
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <label className="text-sm flex items-center gap-2">
            Teachers not in this file
            <select
              className="border border-[var(--color-line)] rounded px-2 py-1"
              value={missingAction}
              onChange={(e) =>
                setMissingAction(e.target.value as "leave" | "deactivate")
              }
            >
              <option value="leave">Keep unchanged</option>
              <option value="deactivate">Mark inactive</option>
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
            {uploadBusy ? "Uploading…" : busy ? "Applying…" : "Save changes"}
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
                    <th className="text-left px-2 py-1">Teacher</th>
                    <th className="text-left px-2 py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.filter(r => !reviewProblemsOnly || r.status === "INVALID" || r.status === "DUPLICATE").slice(reviewPage * 100, (reviewPage + 1) * 100).map((r, i) => (
                    <tr key={i} className="border-t border-[var(--color-line)]">
                      <td className="px-2 py-1">{r.rowNumber}</td>
                      <td className="px-2 py-1">{r.status}</td>
                      <td className="px-2 py-1">{r.teacherName ?? r.payload?.name ?? dataset.teachers.find((t) => t.employeeCode === r.employeeCode)?.name ?? "—"}</td>
                      <td className="px-2 py-1">{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-3 items-center text-sm">
              <label><input type="checkbox" checked={reviewProblemsOnly} onChange={e=>{setReviewProblemsOnly(e.target.checked);setReviewPage(0);}}/> Show only rows needing attention</label>
              <button type="button" className="underline" disabled={reviewPage===0} onClick={()=>setReviewPage(n=>n-1)}>Previous 100</button>
              <span>Page {reviewPage+1}</span>
              <button type="button" className="underline" disabled={(reviewPage+1)*100 >= preview.rows.filter(r=>!reviewProblemsOnly||r.status==="INVALID"||r.status==="DUPLICATE").length} onClick={()=>setReviewPage(n=>n+1)}>Next 100</button>
            </div>
          </div>
        )}
      </Panel>

      <CentreChecklistImport />
      <StaffReturnReview />
      <PracticalStudentsImport />
      <details><summary className="cursor-pointer p-2">Additional import formats</summary><PracticalFormatImportPanel
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
      /></details>
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
        centres: dataset.centres.filter((c) => c.active),
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
            name: r.name,
            schoolCode: r.schoolCode,
            designation: r.designation,
            schoolName: r.schoolName,
            subject: r.subject,
            seniorityRank: r.seniorityRank,
            isActive: true,
          });
        }
      }
      if (errors.length) setErr(errors.slice(0, 5).join("; "));
      onForm01Rows(allRows);
      setForm01Msg(
        `${allRows.length} teachers loaded. Check the preview above before saving.`,
      );
      logAudit("IMPORT", `FORM-01 parsed rows=${allRows.length}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "FORM-01 parse failed");
    }
  }

  return (
    <Panel title="Other Excel files">
      <p className="text-sm text-[var(--color-ink-muted)] mb-3">
        Import combined schools, student numbers, practical groups or the teacher seniority list.
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
          Import practical batches .xlsx
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
