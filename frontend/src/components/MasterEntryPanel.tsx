import { useMemo, useState } from "react";
import type { DemoDataset } from "../data/demoStore";
import type { Role } from "@exam-duty/shared";
import {
  upsertManualMasterRecord,
  type ManualMasterRecord,
} from "../lib/api";

type EntryKind = ManualMasterRecord["kind"];

const designations = ["PRINCIPAL", "HM", "SENIOR_PG", "PG", "OTHER"];

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
  const [blockId, setBlockId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [designation, setDesignation] = useState("PG");
  const [subject, setSubject] = useState("");
  const [seniority, setSeniority] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [capacity, setCapacity] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const filteredSchools = useMemo(
    () => dataset.schools.filter((school) => !blockId || school.blockId === blockId),
    [blockId, dataset.schools],
  );
  const selectedSchool = dataset.schools.find((school) => school.schoolId === schoolId);
  const canWrite = role !== "VIEWER";
  const coords = () => ({ latitude: Number(latitude), longitude: Number(longitude) });

  function reset() {
    setCode(""); setName(""); setSchoolId(""); setDesignation("PG");
    setSubject(""); setSeniority(""); setJoiningDate(""); setLatitude("");
    setLongitude(""); setCapacity(""); setMessage(null);
  }

  function applyToSession(record: ManualMasterRecord, id: string) {
    {
      const previous = dataset;
      if (record.kind === "block") {
        const row = { blockId: id, blockCode: record.blockCode, blockName: record.blockName };
        return setDataset({ ...previous, blocks: [...previous.blocks.filter((x) => x.blockCode !== row.blockCode), row] });
      }
      if (record.kind === "school") {
        const row = {
          schoolId: id, schoolCode: record.schoolCode, schoolName: record.schoolName,
          blockId: record.blockId, latitude: record.latitude, longitude: record.longitude,
          active: record.active !== false,
        };
        return setDataset({ ...previous, schools: [...previous.schools.filter((x) => x.schoolCode !== row.schoolCode), row] });
      }
      if (record.kind === "centre") {
        const row = {
          centreId: id, centreCode: record.centreCode, centreName: record.centreName,
          blockId: record.blockId, latitude: record.latitude, longitude: record.longitude,
          capacity: record.capacity, active: record.active !== false,
        };
        return setDataset({ ...previous, centres: [...previous.centres.filter((x) => x.centreCode !== row.centreCode), row] });
      }
      const row = {
        teacherId: id, employeeCode: record.employeeCode, name: record.name,
        schoolId: record.schoolId, designation: record.designation, subject: record.subject,
        seniorityRank: record.seniorityRank, joiningDate: record.joiningDate ?? null,
        homeLatitude: record.homeLatitude, homeLongitude: record.homeLongitude,
        isActive: record.isActive !== false, dataQuality: "ManuallyCorrected" as const,
      };
      return setDataset({ ...previous, teachers: [...previous.teachers.filter((x) => x.employeeCode !== row.employeeCode), row] });
    }
  }

  async function save() {
    setMessage(null);
    if (kind !== "block" && !blockId) return setMessage("Select a block.");
    if (!code.trim() || !name.trim()) return setMessage("Code and name are required.");
    const location = coords();
    if (kind !== "block" && (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude))) {
      return setMessage("Coordinates are required: enter both latitude and longitude.");
    }
    let record: ManualMasterRecord;
    if (kind === "block") {
      record = { kind, blockCode: code.trim(), blockName: name.trim() };
    } else if (kind === "school") {
      record = { kind, schoolCode: code.trim(), schoolName: name.trim(), blockId, ...location };
    } else if (kind === "centre") {
      const numericCapacity = Number(capacity);
      if (!Number.isInteger(numericCapacity) || numericCapacity <= 0) {
        return setMessage("Student strength/capacity must be a positive whole number.");
      }
      record = { kind, centreCode: code.trim(), centreName: name.trim(), blockId, capacity: numericCapacity, ...location };
    } else {
      const numericRank = Number(seniority);
      if (!schoolId || !subject || !Number.isInteger(numericRank) || numericRank < 0) {
        return setMessage("Select a school and subject, and enter a whole-number seniority rank.");
      }
      record = {
        kind, employeeCode: code.trim(), name: name.trim(), schoolId, designation,
        subject, seniorityRank: numericRank, joiningDate: joiningDate || null,
        homeLatitude: location.latitude, homeLongitude: location.longitude,
      };
    }
    setSaving(true);
    const saved = await upsertManualMasterRecord(role, record);
    setSaving(false);
    if (!saved?.ok || !saved.id) return setMessage(saved?.error ?? "Could not save to the local database.");
    applyToSession(record, saved.id);
    logAudit(saved.created ? "CREATE" : "UPDATE", `Manual ${kind}: ${code.trim()}`);
    setMessage(`${saved.created ? "Created" : "Updated"} and saved. Autosave will retain this change.`);
    reset();
  }

  return (
    <div className="mb-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-sky-wash)] p-4" data-testid="manual-master-entry">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg">Add or update master data</h2>
          <p className="text-sm text-[var(--color-ink-muted)]">Required dropdowns keep block → school → teacher data linked. Existing codes update the current master record; duty history remains untouched.</p>
        </div>
        <select className="rounded border border-[var(--color-line)] bg-white px-2 py-1.5 text-sm" value={kind} onChange={(e) => { setKind(e.target.value as EntryKind); reset(); }} disabled={!canWrite}>
          <option value="teacher">Teacher</option><option value="school">School</option><option value="centre">Exam centre</option><option value="block">Block</option>
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kind !== "block" && <label className="text-sm">Block<select className={inputClass} value={blockId} onChange={(e) => { setBlockId(e.target.value); setSchoolId(""); }} required><option value="">Select block</option>{dataset.blocks.map((block) => <option key={block.blockId} value={block.blockId}>{block.blockCode} · {block.blockName}</option>)}</select></label>}
        <label className="text-sm">{kind === "block" ? "Block code" : kind === "school" ? "School code" : kind === "centre" ? "Centre code" : "Employee code"}<input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} required /></label>
        <label className="text-sm">{kind === "block" ? "Block name" : kind === "school" ? "School name" : kind === "centre" ? "Centre name" : "Teacher name"}<input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required /></label>
        {kind === "teacher" && <label className="text-sm">School<select className={inputClass} value={schoolId} onChange={(e) => { setSchoolId(e.target.value); const school = dataset.schools.find((x) => x.schoolId === e.target.value); if (school) setBlockId(school.blockId); }} required disabled={!blockId}><option value="">Select school</option>{filteredSchools.map((school) => <option key={school.schoolId} value={school.schoolId}>{school.schoolCode} · {school.schoolName}</option>)}</select>{selectedSchool ? <span className="text-xs text-[var(--color-ink-muted)]">{selectedSchool.schoolCode} is linked to the selected block.</span> : null}</label>}
        {kind === "teacher" && <label className="text-sm">Designation<select className={inputClass} value={designation} onChange={(e) => setDesignation(e.target.value)}>{designations.map((item) => <option key={item}>{item}</option>)}</select></label>}
        {kind === "teacher" && <label className="text-sm">Subject<select className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} required><option value="">Select subject</option>{(dataset.subjects ?? []).filter((item) => item.active).map((item) => <option key={item.subjectId} value={item.code}>{item.code} · {item.name}</option>)}</select></label>}
        {kind === "teacher" && <label className="text-sm">Seniority rank<input className={inputClass} type="number" min="0" value={seniority} onChange={(e) => setSeniority(e.target.value)} required /></label>}
        {kind === "teacher" && <label className="text-sm">Joining date<input className={inputClass} type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} /></label>}
        {kind === "centre" && <label className="text-sm">Student strength / capacity<input className={inputClass} type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} required /></label>}
        {kind !== "block" && <label className="text-sm">{kind === "teacher" ? "Home latitude" : "Latitude"}<input className={inputClass} type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} required /></label>}
        {kind !== "block" && <label className="text-sm">{kind === "teacher" ? "Home longitude" : "Longitude"}<input className={inputClass} type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} required /></label>}
      </div>
      <div className="mt-3 flex items-center gap-3"><button type="button" className="rounded bg-[var(--color-brand)] px-3 py-2 text-sm text-white disabled:opacity-40" disabled={!canWrite || saving} onClick={() => void save()}>{saving ? "Saving…" : `Save ${kind}`}</button>{message ? <span className={message.startsWith("Created") || message.startsWith("Updated") ? "text-sm text-[var(--color-ok)]" : "text-sm text-[var(--color-err)]"}>{message}</span> : null}</div>
    </div>
  );
}
