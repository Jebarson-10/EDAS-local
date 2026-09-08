/**
 * Parsers and report builders aligned to client manual sample *layouts*
 * (see docs/client-sample-formats.md). Synthetic data only — no client PII.
 */

export interface PracticalClubbingRow {
  serialNo: number | null;
  schoolCode: string;
  schoolName: string;
  subject: string;
  practicalCentreName: string;
}

export interface PracticalBatchDemandRow {
  serialNo: number | null;
  schoolCode: string;
  subject: string;
  batchCount: number;
  isSchoolTotal: boolean;
}

export interface DutyInAppointmentRow {
  fromDate: string;
  toDate: string;
  subject: string;
  batchCount: number;
  externalName: string;
  externalSchoolName: string;
  externalPlace?: string;
  internalName: string;
}

export interface DutyInLetter {
  academicYearLabel: string;
  districtLabel: string;
  schoolNumber: string;
  schoolName: string;
  city: string;
  appointments: DutyInAppointmentRow[];
  signatoryTitle: string;
  signatoryPlace: string;
}

export interface DutyOutAssignmentRow {
  subject: string;
  teacherName: string;
  dutySchoolName: string;
  dutyPlace?: string;
  batchCount: number;
  fromDate: string;
  toDate: string;
}

export interface DutyOutLetter {
  academicYearLabel: string;
  districtLabel: string;
  schoolNumber: string;
  schoolName: string;
  place: string;
  assignments: DutyOutAssignmentRow[];
  signatoryTitle: string;
  signatoryPlace: string;
}

function cell(row: unknown[], i: number): string {
  const v = row[i];
  return v == null ? "" : String(v).trim();
}

function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.]/g, "")
    .trim();
}

/** Parse clubbing sheet AOA (first sheet of CLUBBED HSC PRACTICAL CENTRE layout). */
export function parsePracticalClubbingAoa(aoa: unknown[][]): {
  rows: PracticalClubbingRow[];
  errors: string[];
} {
  const errors: string[] = [];
  const headerIdx = aoa.findIndex((r) =>
    (r ?? []).some((c) => /sch\s*code|school\s*name/i.test(String(c ?? ""))),
  );
  if (headerIdx < 0) {
    return { rows: [], errors: ["Clubbing header row not found"] };
  }
  const header = (aoa[headerIdx] ?? []).map((c) => normHeader(String(c ?? "")));
  const idx = {
    sno: header.findIndex((h) => h === "s.no" || h === "s no" || h === "sno"),
    code: header.findIndex((h) => h.includes("sch code") || h === "school no" || h.includes("school code")),
    name: header.findIndex((h) => h.includes("school name")),
    subject: header.findIndex((h) => h === "subject"),
    centre: header.findIndex((h) => h.includes("practical centre") || h.includes("centre")),
  };
  if (idx.code < 0 || idx.centre < 0) {
    errors.push("Required columns SCH CODE / PRACTICAL CENTRE missing");
  }
  const rows: PracticalClubbingRow[] = [];
  let last: PracticalClubbingRow | null = null;
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const code = idx.code >= 0 ? cell(r, idx.code) : "";
    const name = idx.name >= 0 ? cell(r, idx.name) : "";
    const subject = idx.subject >= 0 ? cell(r, idx.subject) : "ALL";
    const centre = idx.centre >= 0 ? cell(r, idx.centre) : "";
    const snoRaw = idx.sno >= 0 ? cell(r, idx.sno) : "";
    if (!code && !name && subject && centre && last) {
      // Continuation row: same school, additional subject → centre
      rows.push({
        serialNo: last.serialNo,
        schoolCode: last.schoolCode,
        schoolName: last.schoolName,
        subject: subject || "ALL",
        practicalCentreName: centre,
      });
      continue;
    }
    if (!code && !centre) continue;
    if (!code || !centre) {
      errors.push(`Row ${i + 1}: incomplete clubbing row`);
      continue;
    }
    const serialNo = snoRaw ? Number(snoRaw) : null;
    const row: PracticalClubbingRow = {
      serialNo: Number.isFinite(serialNo as number) ? (serialNo as number) : null,
      schoolCode: code,
      schoolName: name,
      subject: subject || "ALL",
      practicalCentreName: centre,
    };
    rows.push(row);
    last = row;
  }
  return { rows, errors };
}

/** Parse HSC-SECOND YEAR PRACTICAL batch demand layout. */
export function parsePracticalBatchDemandAoa(aoa: unknown[][]): {
  rows: PracticalBatchDemandRow[];
  errors: string[];
} {
  const errors: string[] = [];
  const headerIdx = aoa.findIndex((r) =>
    (r ?? []).some((c) => /school\s*no/i.test(String(c ?? ""))),
  );
  if (headerIdx < 0) {
    return { rows: [], errors: ["Batch demand header not found"] };
  }
  const header = (aoa[headerIdx] ?? []).map((c) => normHeader(String(c ?? "")));
  const idx = {
    sno: header.findIndex((h) => h.startsWith("sl") || h === "s.no" || h === "sno"),
    school: header.findIndex((h) => h.includes("school")),
    subject: header.findIndex((h) => h.includes("subject")),
    batches: header.findIndex((h) => h.includes("batch")),
  };
  if (idx.school < 0 || idx.batches < 0) {
    errors.push("Required columns School No. / No. of Batch missing");
  }
  const rows: PracticalBatchDemandRow[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const school = idx.school >= 0 ? cell(r, idx.school) : "";
    const subject = idx.subject >= 0 ? cell(r, idx.subject) : "";
    const batchRaw = idx.batches >= 0 ? cell(r, idx.batches) : "";
    const snoRaw = idx.sno >= 0 ? cell(r, idx.sno) : "";
    if (!school && !subject && !batchRaw) continue;
    const isSchoolTotal = /total/i.test(school) || /total/i.test(subject);
    const batchCount = Number(batchRaw);
    if (!isSchoolTotal && (!school || !subject || !Number.isFinite(batchCount))) {
      errors.push(`Row ${i + 1}: incomplete batch demand`);
      continue;
    }
    rows.push({
      serialNo: snoRaw ? Number(snoRaw) : null,
      schoolCode: school.replace(/\s*total$/i, "").trim(),
      subject,
      batchCount: Number.isFinite(batchCount) ? batchCount : 0,
      isSchoolTotal,
    });
  }
  return { rows, errors };
}

function pad(s: string, n: number): string {
  const t = s.length > n ? s.slice(0, n) : s;
  return t + " ".repeat(Math.max(0, n - t.length));
}

/** Build Duty-In letter text matching client sample layout (English interim — OQ-016). */
export function buildDutyInLetterText(letter: DutyInLetter): string {
  const lines: string[] = [];
  lines.push(letter.academicYearLabel);
  lines.push(letter.districtLabel);
  lines.push("");
  lines.push("APPOINTMENT  OF EXTERNAL EXAMINER");
  lines.push("");
  lines.push(`School Number : ${letter.schoolNumber}`);
  lines.push(`School Name   : ${letter.schoolName}`);
  lines.push(`City          : ${letter.city}`);
  lines.push("");
  lines.push("-------------------------------------------------------------------------------");
  lines.push("S.No.   From          To       Subject         No.of     External Name &");
  lines.push("Date         Date       Name          Batches    School Name");
  lines.push("-------------------------------------------------------------------------------");
  letter.appointments.forEach((a, i) => {
    lines.push(
      `${pad(String(i + 1), 3)}  ${pad(a.fromDate, 12)} ${pad(a.toDate, 12)} ${pad(a.subject, 18)} ${pad(String(a.batchCount), 6)} ${a.externalName}`,
    );
    lines.push(`${a.externalSchoolName}`);
    if (a.externalPlace) lines.push(a.externalPlace);
    lines.push("");
    lines.push(`Internal Name:${a.internalName}`);
    lines.push("");
  });
  lines.push("-------------------------------------------------------------------------------");
  lines.push("");
  lines.push(letter.signatoryTitle);
  lines.push(letter.signatoryPlace);
  lines.push("");
  return lines.join("\n");
}

/** Build Duty-Out letter text matching client sample layout (English interim — OQ-016). */
export function buildDutyOutLetterText(letter: DutyOutLetter): string {
  const lines: string[] = [];
  lines.push(letter.academicYearLabel);
  lines.push(letter.districtLabel);
  lines.push("");
  lines.push("EXTERNAL EXAMINER DUTY FOR TEACHERS");
  lines.push("");
  lines.push(`School Number : ${letter.schoolNumber}`);
  lines.push(`School Name   : ${letter.schoolName}`);
  lines.push(`Place         : ${letter.place}`);
  lines.push("");
  lines.push("-----------------------------------------------------------------------------------");
  lines.push("Subject         Teachers       External Duty         No.of            Date");
  lines.push("Name           School Name          batch     From         To");
  lines.push("-----------------------------------------------------------------------------------");
  for (const a of letter.assignments) {
    lines.push(
      `${pad(a.subject, 12)} ${pad(a.teacherName, 18)} ${pad(a.dutySchoolName, 22)} ${pad(String(a.batchCount), 4)} ${pad(a.fromDate, 12)} ${a.toDate}`,
    );
    if (a.dutyPlace) lines.push(a.dutyPlace);
    lines.push("");
  }
  lines.push("-----------------------------------------------------------------------------------");
  lines.push("");
  lines.push(letter.signatoryTitle);
  lines.push(letter.signatoryPlace);
  lines.push("");
  return lines.join("\n");
}

/** Group practical schedules into Duty-In letters keyed by host schoolId. */
export function groupDutyInLetters(input: {
  academicYearLabel: string;
  districtLabel: string;
  signatoryTitle: string;
  signatoryPlace: string;
  schedules: Array<{
    schoolId: string;
    subjectId: string;
    examDate: string;
    internalExaminerId: string;
    externalExaminerId: string;
  }>;
  schoolById: Map<string, { schoolCode: string; schoolName: string; place?: string }>;
  teacherById: Map<string, { name: string; schoolId: string }>;
}): DutyInLetter[] {
  const bySchool = new Map<string, typeof input.schedules>();
  for (const s of input.schedules) {
    const list = bySchool.get(s.schoolId) ?? [];
    list.push(s);
    bySchool.set(s.schoolId, list);
  }
  const letters: DutyInLetter[] = [];
  for (const [schoolId, schedules] of bySchool) {
    const school = input.schoolById.get(schoolId);
    const grouped = new Map<string, typeof schedules>();
    for (const s of schedules) {
      const key = `${s.subjectId}|${s.externalExaminerId}|${s.internalExaminerId}`;
      const list = grouped.get(key) ?? [];
      list.push(s);
      grouped.set(key, list);
    }
    const appointments: DutyInAppointmentRow[] = [];
    for (const [, group] of grouped) {
      const dates = group.map((g) => g.examDate).sort();
      const ext = input.teacherById.get(group[0]!.externalExaminerId);
      const intl = input.teacherById.get(group[0]!.internalExaminerId);
      const extSchool = ext ? input.schoolById.get(ext.schoolId) : undefined;
      appointments.push({
        fromDate: dates[0]!,
        toDate: dates[dates.length - 1]!,
        subject: group[0]!.subjectId,
        batchCount: group.length,
        externalName: ext?.name ?? group[0]!.externalExaminerId,
        externalSchoolName: extSchool?.schoolName ?? "",
        externalPlace: extSchool?.place,
        internalName: intl?.name ?? group[0]!.internalExaminerId,
      });
    }
    letters.push({
      academicYearLabel: input.academicYearLabel,
      districtLabel: input.districtLabel,
      schoolNumber: school?.schoolCode ?? schoolId,
      schoolName: school?.schoolName ?? schoolId,
      city: school?.place ?? "",
      appointments,
      signatoryTitle: input.signatoryTitle,
      signatoryPlace: input.signatoryPlace,
    });
  }
  return letters;
}

/** Group practical schedules into Duty-Out letters keyed by external examiner home school. */
export function groupDutyOutLetters(input: {
  academicYearLabel: string;
  districtLabel: string;
  signatoryTitle: string;
  signatoryPlace: string;
  schedules: Array<{
    schoolId: string;
    subjectId: string;
    examDate: string;
    externalExaminerId: string;
  }>;
  schoolById: Map<string, { schoolCode: string; schoolName: string; place?: string }>;
  teacherById: Map<string, { name: string; schoolId: string }>;
}): DutyOutLetter[] {
  const byHomeSchool = new Map<
    string,
    Array<{
      schoolId: string;
      subjectId: string;
      examDate: string;
      externalExaminerId: string;
    }>
  >();
  for (const s of input.schedules) {
    const t = input.teacherById.get(s.externalExaminerId);
    const home = t?.schoolId ?? "unknown";
    const list = byHomeSchool.get(home) ?? [];
    list.push(s);
    byHomeSchool.set(home, list);
  }
  const letters: DutyOutLetter[] = [];
  for (const [homeSchoolId, schedules] of byHomeSchool) {
    const school = input.schoolById.get(homeSchoolId);
    const grouped = new Map<string, typeof schedules>();
    for (const s of schedules) {
      const key = `${s.externalExaminerId}|${s.schoolId}|${s.subjectId}`;
      const list = grouped.get(key) ?? [];
      list.push(s);
      grouped.set(key, list);
    }
    const assignments: DutyOutAssignmentRow[] = [];
    for (const [, group] of grouped) {
      const dates = group.map((g) => g.examDate).sort();
      const teacher = input.teacherById.get(group[0]!.externalExaminerId);
      const dutySchool = input.schoolById.get(group[0]!.schoolId);
      assignments.push({
        subject: group[0]!.subjectId,
        teacherName: teacher?.name ?? group[0]!.externalExaminerId,
        dutySchoolName: dutySchool?.schoolName ?? group[0]!.schoolId,
        dutyPlace: dutySchool?.place,
        batchCount: group.length,
        fromDate: dates[0]!,
        toDate: dates[dates.length - 1]!,
      });
    }
    letters.push({
      academicYearLabel: input.academicYearLabel,
      districtLabel: input.districtLabel,
      schoolNumber: school?.schoolCode ?? homeSchoolId,
      schoolName: school?.schoolName ?? homeSchoolId,
      place: school?.place ?? "",
      assignments,
      signatoryTitle: input.signatoryTitle,
      signatoryPlace: input.signatoryPlace,
    });
  }
  return letters;
}

export interface Form01TeacherRow {
  designation: string;
  serialNo: number | null;
  schoolCode: string;
  schoolName: string;
  schoolType: string | null;
  name: string;
  sex: string | null;
  subject: string | null;
  /** Synthetic only — never use real employee numbers from client files in fixtures. */
  employeeCode: string;
  seniorityRank: number;
}

export interface CentreStrengthRow {
  serialNo: number | null;
  centreCode: string;
  centreName: string;
  strength12: number;
  strength11Arrear: number | null;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse one FORM-01 seniority sheet AOA (sheet name = designation). */
export function parseForm01SeniorityAoa(
  aoa: unknown[][],
  designation: string,
): { rows: Form01TeacherRow[]; errors: string[] } {
  const errors: string[] = [];
  const headerIdx = aoa.findIndex((r) =>
    (r ?? []).some((c) => /school\s*code/i.test(String(c ?? ""))),
  );
  if (headerIdx < 0) {
    return {
      rows: [],
      errors: [`FORM-01 header not found on sheet ${designation}`],
    };
  }
  const header = (aoa[headerIdx] ?? []).map((c) => normHeader(String(c ?? "")));
  const idx = {
    sno: header.findIndex((h) => h.startsWith("s.no") || h === "sno" || h === "s no"),
    code: header.findIndex((h) => h.includes("school code")),
    school: header.findIndex(
      (h) => h.includes("name of the school") || h === "school name",
    ),
    type: header.findIndex((h) => h.includes("type")),
    name: header.findIndex(
      (h) =>
        h.includes("headmaster name") ||
        h.includes("teacher name") ||
        (h.includes("name") && !h.includes("school")),
    ),
    sex: header.findIndex((h) => h === "sex" || h.startsWith("sex")),
    subject: header.findIndex(
      (h) => h.includes("major subject") || h === "subject",
    ),
  };
  if (idx.code < 0 || idx.name < 0) {
    errors.push(`Sheet ${designation}: SCHOOL CODE / NAME columns required`);
  }
  const rows: Form01TeacherRow[] = [];
  let rank = 0;
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const schoolCode = idx.code >= 0 ? cell(r, idx.code) : "";
    const name = idx.name >= 0 ? cell(r, idx.name) : "";
    if (!schoolCode && !name) continue;
    if (/^\d+$/.test(schoolCode) && !name) continue;
    if (!schoolCode || !name || name.length < 2) continue;
    rank += 1;
    const snoRaw = idx.sno >= 0 ? cell(r, idx.sno) : "";
    const desig =
      designation.trim().toUpperCase().replace(/\s+/g, "_") || "UNKNOWN";
    const codeNorm = normalizeCode(schoolCode).slice(0, 24);
    rows.push({
      designation: desig,
      serialNo: snoRaw ? Number(snoRaw) : rank,
      schoolCode: schoolCode.trim(),
      schoolName: idx.school >= 0 ? cell(r, idx.school) : "",
      schoolType: idx.type >= 0 ? cell(r, idx.type) || null : null,
      name,
      sex: idx.sex >= 0 ? cell(r, idx.sex) || null : null,
      subject: idx.subject >= 0 ? cell(r, idx.subject) || null : null,
      employeeCode: `SYN-${desig}-${codeNorm}-${String(rank).padStart(4, "0")}`,
      seniorityRank: rank,
    });
  }
  return { rows, errors };
}

/** Parse HSE booklet CENTRE WISE STRENGTH layout. */
export function parseCentreStrengthAoa(aoa: unknown[][]): {
  rows: CentreStrengthRow[];
  errors: string[];
} {
  const errors: string[] = [];
  const headerIdx = aoa.findIndex((r) =>
    (r ?? []).some((c) => /center\s*no|centre\s*no/i.test(String(c ?? ""))),
  );
  if (headerIdx < 0) {
    return { rows: [], errors: ["Centre strength header not found"] };
  }
  const header = (aoa[headerIdx] ?? []).map((c) => normHeader(String(c ?? "")));
  const idx = {
    sno: header.findIndex((h) => h.startsWith("s.no") || h === "sno" || h === "s no"),
    code: header.findIndex(
      (h) => h.includes("center no") || h.includes("centre no"),
    ),
    name: header.findIndex(
      (h) =>
        h.includes("name of the centre") ||
        h.includes("centre name") ||
        h.includes("center name"),
    ),
    s12: header.findIndex(
      (h) => h.includes("12") || h.includes("strength of students 12"),
    ),
    s11: header.findIndex((h) => h.includes("11") || h.includes("arrear")),
  };
  if (idx.code < 0) errors.push("CENTER NO. column missing");
  const rows: CentreStrengthRow[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const code = idx.code >= 0 ? cell(r, idx.code) : "";
    const name = idx.name >= 0 ? cell(r, idx.name) : "";
    if (!code) continue;
    const s12 = idx.s12 >= 0 ? Number(cell(r, idx.s12)) : Number.NaN;
    const s11 = idx.s11 >= 0 ? Number(cell(r, idx.s11)) : null;
    rows.push({
      serialNo: idx.sno >= 0 && cell(r, idx.sno) ? Number(cell(r, idx.sno)) : null,
      centreCode: code,
      centreName: name,
      strength12: Number.isFinite(s12) ? s12 : 0,
      strength11Arrear: s11 != null && Number.isFinite(s11) ? s11 : null,
    });
  }
  return { rows, errors };
}

export interface ClubbingApplyResult {
  relationships: Array<{
    centreId: string;
    schoolId: string;
    relationshipType: "HOST" | "CLUBBED";
    effectiveFrom: string;
    effectiveTo?: string | null;
    subjectScope?: string;
  }>;
  applied: number;
  unmatchedSchools: string[];
  unmatchedCentres: string[];
}

/**
 * Map clubbing rows onto existing schools/centres by code/name.
 * Closes prior open CLUBBED rows for matched schools (effectiveTo = asOfDate).
 */
export function applyPracticalClubbing(input: {
  rows: PracticalClubbingRow[];
  schools: Array<{ schoolId: string; schoolCode: string; schoolName: string }>;
  centres: Array<{ centreId: string; centreCode: string; centreName: string }>;
  existing: Array<{
    centreId: string;
    schoolId: string;
    relationshipType: "HOST" | "CLUBBED";
    effectiveFrom: string;
    effectiveTo?: string | null;
  }>;
  asOfDate: string;
}): ClubbingApplyResult {
  const schoolByCode = new Map(
    input.schools.map((s) => [normalizeCode(s.schoolCode), s]),
  );
  const centreByCode = new Map(
    input.centres.map((c) => [normalizeCode(c.centreCode), c]),
  );
  const centresByName = input.centres.map((c) => ({
    c,
    n: normalizeName(c.centreName),
  }));

  const findCentre = (name: string) => {
    const codeTry = centreByCode.get(normalizeCode(name));
    if (codeTry) return codeTry;
    const n = normalizeName(name);
    const exact = centresByName.find((x) => x.n === n);
    if (exact) return exact.c;
    const soft = centresByName.find((x) => x.n.includes(n) || n.includes(x.n));
    return soft?.c;
  };

  const unmatchedSchools: string[] = [];
  const unmatchedCentres: string[] = [];
  const touchedSchools = new Set<string>();
  const additions: ClubbingApplyResult["relationships"] = [];

  for (const row of input.rows) {
    const school = schoolByCode.get(normalizeCode(row.schoolCode));
    if (!school) {
      unmatchedSchools.push(row.schoolCode);
      continue;
    }
    const centre = findCentre(row.practicalCentreName);
    if (!centre) {
      unmatchedCentres.push(row.practicalCentreName);
      continue;
    }
    touchedSchools.add(school.schoolId);
    additions.push({
      centreId: centre.centreId,
      schoolId: school.schoolId,
      relationshipType: "CLUBBED",
      effectiveFrom: input.asOfDate,
      effectiveTo: null,
      subjectScope: row.subject || "ALL",
    });
  }

  const closed = input.existing.map((r) => {
    if (
      r.relationshipType === "CLUBBED" &&
      !r.effectiveTo &&
      touchedSchools.has(r.schoolId)
    ) {
      return { ...r, effectiveTo: input.asOfDate };
    }
    return r;
  });

  const seen = new Set<string>();
  const uniqueAdds = additions.filter((a) => {
    const k = `${a.centreId}|${a.schoolId}|${a.subjectScope ?? "ALL"}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    relationships: [...closed, ...uniqueAdds],
    applied: uniqueAdds.length,
    unmatchedSchools: [...new Set(unmatchedSchools)],
    unmatchedCentres: [...new Set(unmatchedCentres)],
  };
}

/** Apply centre strength rows onto centres (capacity = 12th strength when matched). */
export function applyCentreStrengths(input: {
  rows: CentreStrengthRow[];
  centres: Array<{
    centreId: string;
    centreCode: string;
    centreName: string;
    capacity?: number | null;
    [k: string]: unknown;
  }>;
}): {
  centres: typeof input.centres;
  applied: number;
  unmatched: string[];
} {
  const byCode = new Map(
    input.centres.map((c) => [normalizeCode(c.centreCode), c]),
  );
  const unmatched: string[] = [];
  let applied = 0;
  const next = input.centres.map((c) => ({ ...c }));
  const nextById = new Map(next.map((c) => [c.centreId, c]));

  for (const row of input.rows) {
    const hit = byCode.get(normalizeCode(row.centreCode));
    if (!hit) {
      unmatched.push(row.centreCode);
      continue;
    }
    const target = nextById.get(hit.centreId)!;
    target.capacity = row.strength12;
    applied += 1;
  }
  return { centres: next, applied, unmatched: [...new Set(unmatched)] };
}

/** Map batch-demand rows to practical engine demands via school code. */
export function mapBatchDemandToPractical(input: {
  rows: PracticalBatchDemandRow[];
  schools: Array<{ schoolId: string; schoolCode: string }>;
  batchSize: number;
}): {
  demands: Array<{ schoolId: string; subjectId: string; studentCount: number }>;
  unmatched: string[];
} {
  const byCode = new Map(
    input.schools.map((s) => [normalizeCode(s.schoolCode), s]),
  );
  const unmatched: string[] = [];
  const demands: Array<{
    schoolId: string;
    subjectId: string;
    studentCount: number;
  }> = [];
  for (const row of input.rows) {
    if (row.isSchoolTotal) continue;
    const school = byCode.get(normalizeCode(row.schoolCode));
    if (!school) {
      unmatched.push(row.schoolCode);
      continue;
    }
    demands.push({
      schoolId: school.schoolId,
      subjectId: (row.subject || "PHYSICS").toUpperCase().replace(/\s+/g, "_"),
      studentCount: Math.max(1, row.batchCount) * input.batchSize,
    });
  }
  return { demands, unmatched: [...new Set(unmatched)] };
}
