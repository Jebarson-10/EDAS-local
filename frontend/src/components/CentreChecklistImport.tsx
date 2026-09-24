import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { assertMutable, parseCentreChecklist, schoolNameKey, schoolReferenceKey, type ReviewedChecklistRow } from "@exam-duty/shared";
import { useApp } from "../state/AppContext";
import { Panel } from "./ui";
import { fetchMasterCentres, fetchMasterRelationships, fetchMasterSchools, saveCentreChecklistApi } from "../lib/api";

export function CentreChecklistImport() {
  const {dataset, setDataset, examCycle, role} = useApp();
  const [rows,setRows] = useState<ReviewedChecklistRow[]>([]);
  const [errors,setErrors] = useState<string[]>([]);
  const [progress,setProgress] = useState("");
  const [busy,setBusy] = useState(false);
  const [checked,setChecked] = useState(false);
  const [standard,setStandard] = useState("");
  const [year,setYear] = useState("");
  const [rawText,setRawText] = useState("");
  const [selected,setSelected] = useState("");
  const [message,setMessage] = useState("");
  const groups = useMemo(() => [...new Set(rows.map(r=>r.centreCode))], [rows]);
  if (!dataset) return null;
  const missing = rows.filter(r=>!r.blockId || !r.hostSchoolKey || r.studentCount == null).length;
  const mismatch = rows.length > 0 && (standard !== examCycle.standard || year !== examCycle.academicYear);
  const fieldClass = "border rounded px-2 py-1 w-full bg-white";

  function loadParsed(parsed: ReturnType<typeof parseCentreChecklist>) {
    if (!dataset) return;
    const prepared = parsed.rows.map(row => {
      const codeMatches = dataset.schools.filter(s => s.sourceSchoolCode && schoolReferenceKey(s.sourceSchoolCode) === schoolReferenceKey(row.sourceSchoolCode));
      const matches = codeMatches.length ? codeMatches : dataset.schools.filter(s => schoolNameKey(s.schoolName) === schoolNameKey(row.schoolName));
      const school = matches.length === 1 ? matches[0] : undefined;
      return {...row, schoolId:school?.schoolId, blockId:school?.blockId ?? "", hostSchoolKey:""};
    });
    for (const row of prepared) {
      const matches = prepared.filter(s => s.centreCode === row.centreCode && schoolNameKey(s.schoolName) === schoolNameKey(row.centreName));
      if (matches.length === 1) row.hostSchoolKey = matches[0]!.sourceSchoolCode;
    }
    setRows(prepared); setErrors(parsed.errors); setStandard(parsed.standard ?? ""); setYear(parsed.academicYear ?? "");
    setSelected(prepared[0]?.centreCode ?? ""); setChecked(false);
  }

  async function upload(file:File) {
    setBusy(true); setMessage(""); setRows([]); setErrors([]); setChecked(false);
    try {
      const {readCentrePdf} = await import("../lib/readCentrePdf");
      const parsed = await readCentrePdf(file,setProgress);
      setRawText(parsed.pages.join("\n\f\n")); loadParsed(parsed);
      setMessage(`Read ${parsed.rows.length} school rows from ${parsed.pages.length} pages. Check the schools, host and counts before saving.`);
    } catch(e) { setErrors([e instanceof Error ? e.message : "The PDF could not be read."]); }
    finally {setBusy(false);setProgress("");}
  }

  async function save() {
    if (!dataset) return;
    setBusy(true); setMessage("");
    try {
      const result = await saveCentreChecklistApi(role,{examCycleId:examCycle.examCycleId, standard, academicYear:year, reviewed:checked, rows});
      const [schools,centres,relationships] = await Promise.all([fetchMasterSchools(role),fetchMasterCentres(role,examCycle.examCycleId),fetchMasterRelationships(role,examCycle.examCycleId)]);
      if (!schools || !centres || !relationships) throw new Error("The list was saved. Reopen the app to load it before allotment.");
      setDataset({...dataset,
        schools:schools.schools.map(s=>({schoolId:s.school_id,schoolCode:s.school_code,sourceSchoolCode:s.source_school_code??undefined,schoolName:s.school_name,blockId:s.block_id,latitude:s.latitude??NaN,longitude:s.longitude??NaN,active:s.active!==0})),
        centres:centres.centres.map(c=>({centreId:c.centre_id,centreCode:c.centre_code,centreName:c.centre_name,blockId:c.block_id??"",latitude:c.latitude??NaN,longitude:c.longitude??NaN,capacity:c.capacity??undefined,active:c.active!==0})),
        relationships:relationships.relationships.map(r=>({centreId:r.centre_id!,schoolId:r.school_id!,relationshipType:r.relationship_type as "HOST"|"CLUBBED",effectiveFrom:r.effective_from!,effectiveTo:r.effective_to})),
      });
      setMessage(`Saved ${result.centres} centres, ${result.schools} school links and ${result.students} students for this examination. Add any missing school locations before allotment.`);
      setRows([]); setChecked(false);
    } catch(e) {setMessage(e instanceof Error ? e.message : "Could not save the list.");}
    finally {setBusy(false);}
  }

  return <Panel title="2. Centres and student numbers">
    <p className="text-sm mb-3">Upload the official centre and school checklist (13A PDF). Each centre’s student count is the total of its listed schools. Reading happens on this device and may take a few minutes.</p>
    <label className="inline-block border rounded px-3 py-2 cursor-pointer">Upload 13A PDF<input type="file" accept=".pdf" disabled={busy} className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);e.target.value="";}} /></label>
    {progress && <p role="status" className="mt-3">{progress}</p>}
    {message && <p role="status" className="mt-3">{message}</p>}
    {rows.length>0 && <div className="space-y-3 mt-3">
      <p>{groups.length} centres · {rows.length} school rows · {missing} rows need details</p>
      <p>Detected: Standard {standard || "unknown"}, {year || "year unknown"}. Selected examination: {examCycle.name}.</p>
      {mismatch && <p className="text-[var(--color-err)]">Select the matching standard and year in <Link className="underline" to="/cycles">Examination</Link> before saving. The file’s student counts belong to that examination.</p>}
      <label className="block">Centre to review<select className={fieldClass} value={selected} onChange={e=>setSelected(e.target.value)}>{groups.map(code=><option key={code} value={code}>{code} — {rows.find(r=>r.centreCode===code)?.centreName}</option>)}</select></label>
      <label className="block">Host school (where the exam takes place)<select className={fieldClass} value={rows.find(r=>r.centreCode===selected)?.hostSchoolKey??""} onChange={e=>{setChecked(false);setRows(prev=>prev.map(r=>r.centreCode===selected?{...r,hostSchoolKey:e.target.value}:r));}}>
        <option value="">Choose host school</option>
        <optgroup label="Schools listed at this centre">{rows.filter(r=>r.centreCode===selected).map(r=><option key={r.sourceSchoolCode} value={r.sourceSchoolCode}>{r.schoolName}</option>)}</optgroup>
        <optgroup label="Other saved schools">{dataset.schools.map(s=><option key={s.schoolId} value={s.schoolId}>{s.schoolName}</option>)}</optgroup>
      </select></label>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Page / school reference","School","Match saved school","Block","Students"].map(h=><th key={h} className="text-left p-2">{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=> row.centreCode===selected && <tr key={i} className="border-t align-top">
        <td className="p-2">Page {row.page}<input aria-label={`School reference row ${i+1}`} className={fieldClass} value={row.sourceSchoolCode} onChange={e=>{setChecked(false);setRows(prev=>prev.map((r,j)=>j===i?{...r,sourceSchoolCode:e.target.value}:r));}} /></td>
        <td className="p-2 min-w-48">{row.schoolName}<details className="text-xs mt-1"><summary>Text read from file</summary>{row.sourceLine}</details></td>
        <td className="p-2"><select aria-label={`Saved school row ${i+1}`} className={fieldClass} value={row.schoolId??""} onChange={e=>{const school=dataset.schools.find(s=>s.schoolId===e.target.value);setChecked(false);setRows(prev=>prev.map((r,j)=>j===i?{...r,schoolId:school?.schoolId,blockId:school?.blockId??""}:r));}}><option value="">Create school from this row</option>{dataset.schools.map(s=><option key={s.schoolId} value={s.schoolId}>{s.schoolName}</option>)}</select></td>
        <td className="p-2"><select aria-label={`Block row ${i+1}`} className={fieldClass} value={row.blockId} onChange={e=>{setChecked(false);setRows(prev=>prev.map((r,j)=>j===i?{...r,blockId:e.target.value}:r));}}><option value="">Choose block</option>{dataset.blocks.map(b=><option key={b.blockId} value={b.blockId}>{b.blockName}</option>)}</select></td>
        <td className="p-2"><input aria-label={`Students row ${i+1}`} type="number" min={0} step={1} className={fieldClass} value={row.studentCount??""} onChange={e=>{setChecked(false);setRows(prev=>prev.map((r,j)=>j===i?{...r,studentCount:e.target.value===""?null:Number(e.target.value)}:r));}} /></td>
      </tr>)}</tbody></table></div>
      <p>Centre total: {rows.filter(r=>r.centreCode===selected).reduce((n,r)=>n+(r.studentCount??0),0)} students.</p>
      <label className="flex gap-2"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} />I checked all centres, school matches and student counts against the PDF.</label>
      <button className="border rounded px-3 py-2 disabled:opacity-40" disabled={busy||!checked||missing>0||mismatch||errors.length>0||!assertMutable(examCycle.status,"save").ok} onClick={()=>void save()}>Save centre list</button>
    </div>}
    {errors.length>0 && <div className="mt-3 text-[var(--color-err)]"><p>These lines need correction before saving:</p><ul className="list-disc pl-5">{errors.map((e,i)=><li key={i}>{e}</li>)}</ul></div>}
    {rawText && <details className="mt-3"><summary>Correct text that the scan reader missed</summary><p className="text-sm">Correct an unreadable heading or school row here, then read it again. This replaces the review above.</p><textarea aria-label="Text read from PDF" className="w-full border rounded h-60 text-sm" value={rawText} onChange={e=>setRawText(e.target.value)} /><button className="border rounded p-2" onClick={()=>loadParsed(parseCentreChecklist(rawText.split("\f")))}>Read corrected text</button></details>}
  </Panel>;
}
