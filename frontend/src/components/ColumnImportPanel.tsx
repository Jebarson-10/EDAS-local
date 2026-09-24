import { useMemo, useRef, useState } from "react";
import { assertMutable, guessImportColumns, importFields, mapImportColumns, planColumnImport, previewTeacherImport, type ImportField } from "@exam-duty/shared";
import { useApp } from "../state/AppContext";
import { fetchMasterBlocks, fetchMasterSchools, fetchMasterCentres, fetchMasterRelationships, upsertManualMasterRecord } from "../lib/api";
import { Panel } from "./ui";

type Sheet = {name: string; lines: unknown[][]};
const style = "rounded border border-[var(--color-line)] bg-white px-2 py-1 text-sm";

export function ColumnImportPanel({onTeachers}: {onTeachers: (rows: Record<string,unknown>[]) => void}) {
  const {dataset, setDataset, role, examCycle, logAudit, applyImportPreview} = useApp();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<(ImportField | "")[]>([]);
  const [kind, setKind] = useState<"teacher" | "school" | "block">("teacher");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const sheet = sheets[sheetIndex];
  const mapped = useMemo(() => sheet ? mapImportColumns(sheet.lines.slice(1), mapping) : null, [sheet,mapping]);
  const plan = useMemo(() => mapped && dataset ? planColumnImport(mapped.rows,dataset) : null,[mapped,dataset]);
  const errors = [...(mapped?.errors ?? []), ...(plan?.errors ?? [])];
  const allowed = role !== "VIEWER" && assertMutable(examCycle.status,"apply import").ok;

  async function upload(file: File) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage(""); setSheets([]); onTeachers([]);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const next = wb.worksheets.map((s) => {
        const lines: unknown[][] = [];
        s.eachRow({includeEmpty:true}, (row) => lines.push((row.values as unknown[]).slice(1)));
        while (lines.length && !lines[0]!.some((v) => v != null && String(v).trim())) lines.shift();
        const width = Math.max(0,...lines.map((r) => r.length));
        if (lines[0]) lines[0] = Array.from({length:width},(_,i) => lines[0]![i] ?? "");
        return {name:s.name,lines};
      }).filter((s) => s.lines.length);
      if (!next.length) throw new Error("This file has no data.");
      setSheets(next); setSheetIndex(0); setMapping(guessImportColumns(next[0]!.lines[0]!,kind));
      setMessage(`Opened ${file.name}. Check the column choices below. Only the selected sheet will be imported.`);
    } catch (e) {setMessage(e instanceof Error ? e.message : "Cannot read this Excel file.");}
    finally {lock.current=false;setBusy(false);}
  }

  async function save() {
    if (!dataset || !plan || errors.length || lock.current || !allowed) return;
    lock.current=true; setBusy(true);setMessage("");
    let saved=0;
    let teachersPreparedForRetry=false;
    try {
      const blockIds = new Map<string,string>();
      // Every successful row is durable. If interrupted, report the saved count; retry matches existing names/codes.
      for (const original of plan.records) {
        const record = {...original};
        if (record.kind === "school") record.blockId = blockIds.get(record.blockId) ?? record.blockId;
        const result = await upsertManualMasterRecord(role,record);
        if (!result?.ok || !result.id) throw new Error(result?.error ?? "Could not save. Check the app connection.");
        saved++;
        if (record.kind === "block") blockIds.set(`import-block:${record.blockCode}`,result.id);
      }
      let refreshed = dataset;
      if (saved) {
        const [blocks,schools,centres,links] = await Promise.all([fetchMasterBlocks(role),fetchMasterSchools(role),fetchMasterCentres(role,examCycle.examCycleId),fetchMasterRelationships(role,examCycle.examCycleId)]);
        if (!blocks || !schools || !centres || !links) throw new Error("Saved lists could not refresh. Reopen the app before retrying.");
        refreshed = {...dataset,
          blocks:blocks.blocks.map((b) => ({blockId:b.block_id,blockCode:b.block_code,blockName:b.block_name})),
          schools:schools.schools.map((s) => ({schoolId:s.school_id,schoolCode:s.school_code,sourceSchoolCode:s.source_school_code ?? undefined,schoolName:s.school_name,blockId:s.block_id,latitude:s.latitude ?? NaN,longitude:s.longitude ?? NaN,active:s.active !== 0})),
          centres:centres.centres.map((c) => ({centreId:c.centre_id,centreCode:c.centre_code,centreName:c.centre_name,blockId:c.block_id ?? "",latitude:c.latitude ?? NaN,longitude:c.longitude ?? NaN,capacity:c.capacity ?? undefined,active:c.active !== 0})),
          relationships:links.relationships.map((r) => ({centreId:String(r.centre_id),schoolId:String(r.school_id),relationshipType:r.relationship_type === "CLUBBED" ? "CLUBBED" as const : "HOST" as const,effectiveFrom:String(r.effective_from),effectiveTo:r.effective_to})),
        };
        setDataset(refreshed);
      }
      let teacherMessage = "";
      if (plan.teachers.length) {
        const preview = previewTeacherImport(
          plan.teachers,
          refreshed.teachers.map((t) => ({
            ...t,
            teacherCode: t.teacherCode ?? null,
            schoolCode: t.schoolId,
          })),
          refreshed.schools,
        );
        const result = await applyImportPreview(preview, {
          missingAction: "leave",
          datasetOverride: refreshed,
          rows: preview.rows.map((row) => ({
            rowNumber: row.rowNumber,
            status: row.status,
            entityKey: row.employeeCode,
            message: row.message,
          })),
        });
        if (!result.ok) {
          onTeachers(plan.teachers);
          teachersPreparedForRetry=true;
          throw new Error(`${result.error} The teachers remain in Teacher review below; select Save changes to retry.`);
        }
        onTeachers([]);
        teacherMessage = ` ${result.teachers.length} total teachers are now saved.`;
      }
      logAudit("IMPORT",`Column import saved ${saved} school/block records and ${plan.teachers.length} teacher rows`);
      setMessage(`${saved} school/block records saved.${teacherMessage || " Import complete."}`);
      setSheets([]);
    } catch (e) {
      setMessage(`${saved} school/block records were saved; no teachers were saved. ${e instanceof Error ? e.message : "Saving stopped."} Reopen this page and upload again to continue.`);
      // Prevent retry with stale school IDs after a partial save.
      setSheets([]);
      if (!teachersPreparedForRetry) onTeachers([]);
    } finally {lock.current=false;setBusy(false);}
  }

  return <Panel title="Import Excel">
    <p className="text-sm mb-3">Put headings in the first row. Columns can be in any order. Each teacher stays linked to the school and other details on the same row.</p>
    <div className="flex gap-3 flex-wrap items-center">
      <a className={style} href="/templates/EDAS-import-template.xlsx" download="EDAS-import-template.xlsx">Download template (all sheets)</a>
      <label className={style}>Choose .xlsx<input aria-label="Choose Excel file for automatic column matching" type="file" accept=".xlsx" disabled={busy || !allowed} className="block" onChange={(e) => {const f=e.target.files?.[0];if(f) void upload(f);e.target.value="";}} /></label>
      <label>File contains <select className={style} value={kind} disabled={busy} onChange={(e) => {const k=e.target.value as typeof kind;setKind(k);if(sheet)setMapping(guessImportColumns(sheet.lines[0]!,k));onTeachers([]);}}><option value="teacher">Teachers (with school details)</option><option value="school">Schools / centres</option><option value="block">Blocks</option></select></label>
      {sheets.length>1 && <label>Sheet <select className={style} value={sheetIndex} disabled={busy} onChange={(e) => {const n=Number(e.target.value);setSheetIndex(n);setMapping(guessImportColumns(sheets[n]!.lines[0]!,kind));onTeachers([]);}}>{sheets.map((s,i) => <option key={i} value={i}>{s.name}</option>)}</select></label>}
    </div>
    {sheet && <>
      <p className="text-sm mt-3">Check what each column contains. Choose a field for an unfamiliar heading, or leave that column out. Blank cells keep saved details unchanged. New schools need a block and coordinates; a centre code makes the school an exam centre.</p>
      <div className="overflow-auto max-h-80 my-3"><table className="w-full text-sm"><thead><tr><th className="text-left">Your heading</th><th className="text-left">Save as</th><th className="text-left">First value</th></tr></thead><tbody>{mapping.map((field,i) => <tr key={i}><td>{String(sheet.lines[0]?.[i] ?? "") || `Column ${i+1} (no heading)`}</td><td><select aria-label={`Column ${i+1} field`} className={style} value={field} disabled={busy} onChange={(e) => {setMapping(mapping.map((f,j) => i===j ? e.target.value as ImportField : f));onTeachers([]);}}><option value="">Choose a field</option>{Object.entries(importFields).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></td><td>{String(sheet.lines[1]?.[i] ?? "").slice(0,100)}</td></tr>)}</tbody></table></div>
      {plan && <p className="text-sm">{mapped?.rows.length} rows · {plan.records.length} school/block changes · {plan.teachers.length} teachers to review</p>}
      {errors.length>0 && <div role="alert" className="text-sm text-[var(--color-err)] max-h-48 overflow-auto">{errors.map((e,i) => <p key={i}>{e}</p>)}</div>}
      <button className={`${style} mt-3 disabled:opacity-40`} disabled={!allowed || busy || errors.length>0 || !plan || (!plan.records.length && !plan.teachers.length)} onClick={() => void save()}>{busy ? "Saving…" : "Save imported data"}</button>
    </>}
    {message && <p role="status" className="text-sm mt-3">{message}</p>}
  </Panel>;
}
