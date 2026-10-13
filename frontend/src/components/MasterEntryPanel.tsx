import { inferSchoolLevel } from "@exam-duty/shared";
import { useMemo, useState } from "react";
import type { DemoDataset } from "../data/demoStore";
import type { Role } from "@exam-duty/shared";
import { useApp } from "../state/AppContext";
import {
  upsertManualMasterRecord,
  fetchMasterTeachers, fetchMasterSchools, fetchMasterCentres, fetchMasterRelationships,
  type ManualMasterRecord,
} from "../lib/api";

type EntryKind = ManualMasterRecord["kind"];

const designations = [
  "PRINCIPAL",
  "HM",
  "SENIOR_PG",
  "PG",
  "BT",
  "SGT",
  "SPECIAL_TEACHER",
  "OTHER",
];
type StaffCategory = "TEACHING" | "NON_TEACHING";

const inputClass = "mt-1 block w-full rounded border border-[var(--color-line)] bg-white px-2 py-1.5 text-sm";

export function MasterEntryPanel({
  dataset,
  setDataset,
  role,
  logAudit,
}: {
  dataset: DemoDataset;
  setDataset: (next: DemoDataset) => void;
  role: Role;
  logAudit: (action: string, detail: string, reason?: string) => void;
}) {
  const [kind, setKind] = useState<EntryKind>("teacher");
  const {examCycle} = useApp();
  const [editingId, setEditingId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [code, setCode] = useState("");
  const [teacherCode, setTeacherCode] = useState("");
  const [name, setName] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [staffCategory, setStaffCategory] = useState<StaffCategory>("TEACHING");
  const [designation, setDesignation] = useState("PG");
  const [subject, setSubject] = useState("");
  const [seniority, setSeniority] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [schoolLevel, setSchoolLevel] = useState<"HIGHER_SECONDARY" | "HIGH" | "OTHER" | "">("");
  const [capacity, setCapacity] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const filteredSchools = useMemo(
    () => dataset.schools.filter((school) => !blockId || school.blockId === blockId),
    [blockId, dataset.schools],
  );
  const selectedSchool = dataset.schools.find((school) => school.schoolId === schoolId);
  const canWrite = role !== "VIEWER";
  const isTeachingStaff = staffCategory === "TEACHING";

  function reset() {
    setEditingId("");
    setCode(""); setTeacherCode(""); setName(""); setSchoolId(""); setStaffCategory("TEACHING"); setDesignation("PG");
    setSubject(""); setSeniority(""); setJoiningDate("");
    setCapacity(""); setSchoolLevel("");
  }

  function edit(id: string) {
    reset(); setEditingId(id); setMessage(null);
    if (kind === "school") {
      const s = dataset.schools.find((s) => s.schoolId === id);
      if (s) { setName(s.schoolName); setCode(s.schoolCode); setBlockId(s.blockId); setSchoolLevel(s.schoolLevel ?? inferSchoolLevel(s.schoolName) ?? ""); setCapacity(String(dataset.centres.find((c) => c.centreCode === s.schoolCode)?.capacity ?? "")); }
    } else {
      const t = dataset.teachers.find((t) => t.teacherId === id);
      if (t) { setName(t.name); setSchoolId(t.schoolId); setBlockId(dataset.schools.find((s) => s.schoolId === t.schoolId)?.blockId ?? ""); setStaffCategory(t.staffCategory === "NON_TEACHING" ? "NON_TEACHING" : "TEACHING"); setDesignation(t.designation); setSubject(t.subject ?? ""); setSeniority(String(t.seniorityRank ?? "")); setJoiningDate(t.joiningDate ?? ""); setTeacherCode(t.teacherCode ?? ""); }
    }
  }

  async function applyToSession(record: ManualMasterRecord, id: string) {
    {
      const previous = dataset;
      if (record.kind === "block") {
        const row = { blockId: id, blockCode: record.blockCode, blockName: record.blockName };
        return setDataset({ ...previous, blocks: [...previous.blocks.filter((x) => x.blockCode !== row.blockCode), row] });
      }
      const [teachers, schools, centres, relationships] = await Promise.all([
        fetchMasterTeachers(role), fetchMasterSchools(role), fetchMasterCentres(role, examCycle.examCycleId), fetchMasterRelationships(role, examCycle.examCycleId),
      ]);
      if (!teachers || !schools || !centres || !relationships) throw new Error("Saved, but the list could not refresh. Reopen this page before making another change.");
      setDataset({ ...previous,
        teachers: teachers.teachers.map((t) => ({ teacherId:t.teacher_id, employeeCode:t.employee_code, teacherCode:t.teacher_code ?? null, name:t.name, schoolId:t.school_id, designation:t.designation, subject:t.subject ?? null, seniorityRank:t.seniority_rank ?? null, joiningDate:t.joining_date ?? null, homeLatitude:t.home_latitude ?? null, homeLongitude:t.home_longitude ?? null, isActive:t.is_active !== 0, dataQuality:"Imported" as const, officialDetails: t.official_details_json ? JSON.parse(t.official_details_json) : null, staffCategory:t.staff_category === "NON_TEACHING" ? "NON_TEACHING" as const : "TEACHING" as const })),
        schools: schools.schools.map((s) => ({ schoolId:s.school_id, schoolCode:s.school_code, sourceSchoolCode:s.source_school_code ?? undefined, schoolName:s.school_name,schoolLevel:s.school_level ?? null, blockId:s.block_id, latitude:s.latitude ?? NaN, longitude:s.longitude ?? NaN, active:s.active !== 0 })),
        centres: centres.centres.map((c) => ({ centreId:c.centre_id, centreCode:c.centre_code, centreName:c.centre_name, blockId:c.block_id ?? "", latitude:c.latitude ?? NaN, longitude:c.longitude ?? NaN, capacity:c.capacity ?? undefined, active:c.active !== 0 })),
        relationships: relationships.relationships.map((r) => ({ centreId:String(r.centre_id), schoolId:String(r.school_id), relationshipType:r.relationship_type === "CLUBBED" ? "CLUBBED" as const : "HOST" as const, effectiveFrom:String(r.effective_from), effectiveTo:r.effective_to })),
      });
    }
  }

  async function save() {
    setMessage(null);
    if (kind !== "block" && !blockId) return setMessage("Select a block.");
    if (!name.trim()) return setMessage("Enter a name.");
    if ((kind === "block" || kind === "centre") && !code.trim()) return setMessage("Enter the code.");
    let record: ManualMasterRecord;
    if (kind === "block") {
      record = { kind, blockCode: code.trim(), blockName: name.trim() };
    } else if (kind === "school") {
      if (code.trim() && capacity.trim() && (!Number.isInteger(Number(capacity)) || Number(capacity) <= 0)) return setMessage("Student count must be a positive whole number.");
      record = { kind, schoolId: editingId || undefined, schoolCode: code.trim(), schoolName: name.trim(), schoolLevel: schoolLevel || undefined, blockId, capacity: code.trim() && capacity.trim() ? Number(capacity) : undefined };
    } else if (kind === "centre") {
      const numericCapacity = Number(capacity);
      if (!Number.isInteger(numericCapacity) || numericCapacity <= 0) {
        return setMessage("Student strength/capacity must be a positive whole number.");
      }
      record = { kind, centreCode: code.trim(), centreName: name.trim(), blockId, capacity: numericCapacity };
    } else {
      const numericRank = Number(seniority);
      if (!schoolId) return setMessage("Select a school.");
      if (!designation.trim()) return setMessage("Enter the post or designation.");
      if (isTeachingStaff && (!subject || (seniority.trim() && (!Number.isInteger(numericRank) || numericRank < 0)))) {
        return setMessage("Select a subject. If you enter a seniority rank, use a whole number. PG officer seniority uses the PG appointment date.");
      }
      record = {
        kind, teacherId: editingId || undefined, name: name.trim(), schoolId, designation: designation.trim(),
        subject: isTeachingStaff ? subject : null, seniorityRank: isTeachingStaff && seniority.trim() ? numericRank : null, joiningDate: joiningDate || null,
        teacherCode: teacherCode.trim() || undefined,
        staffCategory,
      };
    }
    setSaving(true);
    try {
    const saved = await upsertManualMasterRecord(role, record);
    if (!saved?.ok || !saved.id) return setMessage(saved?.error ?? "Could not save to the local database.");
    await applyToSession(record, saved.id);
    logAudit(saved.created ? "CREATE" : "UPDATE", `${kind}: ${name.trim()}`);
    setMessage("Saved.");
    reset();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save. Please try again."); }
    finally { setSaving(false); }
  }

  return (
    <div className="mb-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-sky-wash)] p-4" data-testid="manual-master-entry">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg">Add or edit details</h2>
          <p className="text-sm text-[var(--color-ink-muted)]">Enter a centre code only if the school is an exam centre. Leave it blank for other schools.</p>
        </div>
        <select className="rounded border border-[var(--color-line)] bg-white px-2 py-1.5 text-sm" value={kind} aria-label="Record type" onChange={(e) => { setKind(e.target.value as EntryKind); reset(); setMessage(null); }} disabled={!canWrite}>
          <option value="teacher">Teacher</option><option value="school">School</option><option value="block">Block</option>
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(kind === "school" || kind === "teacher") && <label className="text-sm sm:col-span-2">Add new or choose to edit<select className={inputClass} value={editingId} onChange={(e) => edit(e.target.value)}><option value="">Add new {kind}</option>{kind === "school" ? dataset.schools.map((s) => <option key={s.schoolId} value={s.schoolId}>{s.schoolName} — {dataset.blocks.find((b) => b.blockId === s.blockId)?.blockName}</option>) : dataset.teachers.map((t) => <option key={t.teacherId} value={t.teacherId}>{t.name} — {dataset.schools.find((s) => s.schoolId === t.schoolId)?.schoolName} — {t.staffCategory === "NON_TEACHING" ? t.designation : t.subject ?? "No subject"} {t.joiningDate ?? ""}</option>)}</select></label>}
        {kind !== "block" && <label className="text-sm">Block<select aria-label="Block" className={inputClass} value={blockId} onChange={(e) => { setBlockId(e.target.value); setSchoolId(""); }} required><option value="">Select block</option>{dataset.blocks.map((block) => <option key={block.blockId} value={block.blockId}>{block.blockCode} · {block.blockName}</option>)}</select></label>}
        {kind !== "teacher" && <label className="text-sm">{kind === "block" ? "Block code" : "Centre code (optional)"}<input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} required={kind === "block"} /></label>}
        <label className="text-sm">{kind === "block" ? "Block name" : kind === "school" ? "School name" : kind === "centre" ? "Centre name" : "Teacher name"}<input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required /></label>
        {kind === "teacher" && <label className="text-sm">Teacher code<input className={inputClass} value={teacherCode} onChange={(e) => setTeacherCode(e.target.value)} placeholder="EMIS / govt. code (optional)" /></label>}
        {kind === "teacher" && <label className="text-sm">School<select aria-label="School" className={inputClass} value={schoolId} onChange={(e) => { setSchoolId(e.target.value); const school = dataset.schools.find((x) => x.schoolId === e.target.value); if (school) setBlockId(school.blockId); }} required disabled={!blockId}><option value="">Select school</option>{filteredSchools.map((school) => <option key={school.schoolId} value={school.schoolId}>{school.schoolName}{school.schoolCode ? ` · ${school.schoolCode}` : ""}</option>)}</select>{selectedSchool ? <span className="text-xs text-[var(--color-ink-muted)]">School in {dataset.blocks.find((b) => b.blockId === selectedSchool.blockId)?.blockName}.</span> : null}</label>}
        {kind === "teacher" && <label className="text-sm">Staff group<select className={inputClass} value={staffCategory} onChange={(e) => { const next = e.target.value as StaffCategory; setStaffCategory(next); setSubject(""); setSeniority(""); if (next === "NON_TEACHING" && designations.includes(designation)) setDesignation("OFFICE_STAFF"); if (next === "TEACHING" && !designations.includes(designation)) setDesignation("PG"); }}><option value="TEACHING">Teaching staff</option><option value="NON_TEACHING">Non-teaching staff</option></select></label>}
        {kind === "teacher" && isTeachingStaff && <label className="text-sm">Designation<select className={inputClass} value={designation} onChange={(e) => setDesignation(e.target.value)}>{designations.map((item) => <option key={item} value={item}>{{PRINCIPAL:"Principal",HM:"Headmaster",SENIOR_PG:"Senior PG teacher",PG:"PG teacher",BT:"BT teacher",SGT:"SGT teacher",SPECIAL_TEACHER:"Special teacher",OTHER:"Other"}[item]}</option>)}</select></label>}
        {kind === "teacher" && !isTeachingStaff && <label className="text-sm">Post or designation<input className={inputClass} value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="For example: Lab Assistant, Record Clerk or Sweeper" required /></label>}
        {kind === "teacher" && isTeachingStaff && <label className="text-sm">Subject<select className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} required><option value="">Select subject</option>{(dataset.subjects ?? []).filter((item) => item.active).map((item) => <option key={item.subjectId} value={item.code}>{item.code} · {item.name}</option>)}</select></label>}
        {kind === "teacher" && isTeachingStaff && <label className="text-sm">Seniority rank (optional)<input className={inputClass} type="number" min="0" value={seniority} onChange={(e) => setSeniority(e.target.value)} /></label>}
        {kind === "teacher" && <label className="text-sm">Appointment date (PG appointment for PG staff)<input className={inputClass} type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} /></label>}
        {kind === "school" && <label className="text-sm">School level<select aria-label="School level" className={inputClass} value={schoolLevel} onChange={e => setSchoolLevel(e.target.value as typeof schoolLevel)}><option value="">Choose school level</option><option value="HIGHER_SECONDARY">Higher secondary</option><option value="HIGH">High school</option><option value="OTHER">Other</option></select></label>}
        {kind === "school" && code.trim() && <label className="text-sm">Students at this centre<input className={inputClass} type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>}
      </div>
      <div className="mt-3 flex items-center gap-3"><button type="button" className="rounded bg-[var(--color-brand)] px-3 py-2 text-sm text-white disabled:opacity-40" disabled={!canWrite || saving} onClick={() => void save()}>{saving ? "Saving…" : `Save ${kind}`}</button>{message ? <span className={message.startsWith("Created") || message.startsWith("Updated") ? "text-sm text-[var(--color-ok)]" : "text-sm text-[var(--color-err)]"}>{message}</span> : null}</div>
    </div>
  );
}
