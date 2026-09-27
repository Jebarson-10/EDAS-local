import { normalizeImportValue } from "./importValues.js";
import { schoolNameKey, schoolReferenceKey } from "./centreChecklist.js";
import type { HistoricalDuty, SessionCode } from "./types.js";

type SheetRow = unknown[];

export interface HistoricalDutyImportRow {
  rowNumber: number;
  teacherName: string;
  schoolReference?: string;
  schoolName?: string;
  examSchoolReference?: string;
  examSchoolName?: string;
  subjectId?: string;
  centreCode?: string;
  examDate: string;
  sessionCode: SessionCode;
  /** The broad duty group is deliberately explicit so theory exclusions stay reliable. */
  dutyTypeCode: "THEORY_HISTORICAL" | "PRACTICAL_HISTORICAL" | "OTHER_HISTORICAL";
  roleCode: string;
  academicYear: string;
}

export interface HistoricalDutyResolution {
  rows: HistoricalDuty[];
  errors: string[];
}

export interface HistoricalDutyLookup {
  teachers: Array<{ teacherId: string; name: string; schoolId: string }>;
  schools: Array<{ schoolId: string; schoolName: string; sourceSchoolCode?: string | null }>;
  centres: Array<{ centreId: string; centreCode: string }>;
}

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const v = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: unknown }> };
    if (typeof v.text === "string") return v.text.trim();
    if (typeof v.result === "string" || typeof v.result === "number") return String(v.result).trim();
    if (Array.isArray(v.richText)) return v.richText.map((part) => String(part.text ?? "")).join("").trim();
  }
  return String(value).trim();
}

function heading(value: unknown): string {
  return asText(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function headingIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((item) => aliases.includes(item));
}

function dutyGroup(value: string): HistoricalDutyImportRow["dutyTypeCode"] | null {
  const compact = value.toUpperCase().replace(/[^A-Z]+/g, "");
  if (/PRACTICAL|EXAMINER/.test(compact)) return "PRACTICAL_HISTORICAL";
  if (/THEORY|HALL|CHIEF|DEPARTMENT|CUSTODIAN|OFFICE/.test(compact)) return "THEORY_HISTORICAL";
  if (/OTHER|GENERAL/.test(compact)) return "OTHER_HISTORICAL";
  return null;
}

function session(value: string): SessionCode | null {
  const compact = value.toUpperCase().replace(/[^A-Z]+/g, "");
  if (["MORNING", "AM"].includes(compact)) return "MORNING";
  if (["AFTERNOON", "PM", "EVENING"].includes(compact)) return "AFTERNOON";
  return null;
}

function year(value: string): string | null {
  return value.match(/20\d{2}/)?.[0] ?? null;
}

function role(group: HistoricalDutyImportRow["dutyTypeCode"], value: string): string | null {
  const compact = value.toUpperCase().replace(/[^A-Z]+/g, "");
  if (group !== "PRACTICAL_HISTORICAL") return value.trim();
  if (/INTERNAL/.test(compact)) return "PRACTICAL_INTERNAL";
  if (/EXTERNAL/.test(compact)) return "PRACTICAL_EXTERNAL";
  return null;
}

/**
 * Reads the simple, downloadable historical-duty worksheet. Values can be
 * Excel text, numbers, formulas, rich text, or dates; each row remains
 * reviewable before it is saved.
 */
export function parseHistoricalDutyRows(sheetRows: SheetRow[]): {
  rows: HistoricalDutyImportRow[];
  errors: string[];
} {
  const errors: string[] = [];
  if (!sheetRows.length) return { rows: [], errors: ["The workbook has no rows."] };
  const headers = (sheetRows[0] ?? []).map(heading);
  const teacherAt = headingIndex(headers, ["TEACHERNAME", "STAFFNAME", "NAME"]);
  const schoolReferenceAt = headingIndex(headers, ["SCHOOLREFERENCE", "SCHOOLREF", "SCHOOLCODE"]);
  const schoolNameAt = headingIndex(headers, ["SCHOOLNAME", "SCHOOL"]);
  const examSchoolReferenceAt = headingIndex(headers, ["EXAMSCHOOLREFERENCE", "EXAMSCHOOLREF", "DUTYSCHOOLREFERENCE"]);
  const examSchoolNameAt = headingIndex(headers, ["EXAMSCHOOLNAME", "DUTYSCHOOLNAME"]);
  const subjectAt = headingIndex(headers, ["SUBJECT", "PRACTICALSUBJECT"]);
  const centreAt = headingIndex(headers, ["CENTRECODE", "CENTERCODE", "CENTRENO", "CENTERNO"]);
  const dateAt = headingIndex(headers, ["EXAMDATE", "DUTYDATE", "DATE"]);
  const sessionAt = headingIndex(headers, ["SESSION", "SLOT"]);
  const groupAt = headingIndex(headers, ["DUTYGROUP", "DUTYTYPE", "DUTY"]);
  const roleAt = headingIndex(headers, ["ROLE", "DUTYROLE", "POST"]);
  const yearAt = headingIndex(headers, ["ACADEMICYEAR", "EXAMYEAR", "YEAR"]);
  const missing = [
    [teacherAt, "Teacher name"], [dateAt, "Exam date"],
    [sessionAt, "Session"], [groupAt, "Duty group"], [roleAt, "Role"], [yearAt, "Academic year"],
  ].filter(([index]) => Number(index) < 0).map(([, label]) => label);
  if (missing.length) {
    return { rows: [], errors: [`Use the downloadable template. Missing heading: ${missing.join(", ")}.`] };
  }

  const rows: HistoricalDutyImportRow[] = [];
  for (let index = 1; index < sheetRows.length; index += 1) {
    const raw = sheetRows[index] ?? [];
    const values = raw.map(asText);
    if (!values.some(Boolean)) continue;
    const rowNumber = index + 1;
    const teacherName = values[teacherAt] ?? "";
    const centreCode = values[centreAt] ?? "";
    const rawDate = raw[dateAt];
    const rawSession = values[sessionAt] ?? "";
    const rawGroup = values[groupAt] ?? "";
    const dutyTypeCode = dutyGroup(rawGroup);
    const roleCode = role(dutyTypeCode ?? "OTHER_HISTORICAL", values[roleAt] ?? "");
    const academicYear = year(values[yearAt] ?? "");
    let examDate = "";
    try { examDate = String(normalizeImportValue("joiningDate", rawDate)); } catch { /* add a clear row error below */ }
    const sessionCode = session(rawSession);
    const examSchoolReference = examSchoolReferenceAt >= 0 ? values[examSchoolReferenceAt] || undefined : undefined;
    const examSchoolName = examSchoolNameAt >= 0 ? values[examSchoolNameAt] || undefined : undefined;
    const subjectId = subjectAt >= 0 ? values[subjectAt] || undefined : undefined;
    if (!teacherName || (!centreCode && dutyTypeCode !== "PRACTICAL_HISTORICAL") || !examDate || !sessionCode || !dutyTypeCode || !roleCode || !academicYear) {
      errors.push(`Row ${rowNumber}: enter teacher name, centre code, valid exam date, Morning/Afternoon, duty group, role and academic year.`);
      continue;
    }
    if (dutyTypeCode === "PRACTICAL_HISTORICAL" && (!subjectId || (!examSchoolReference && !examSchoolName))) {
      errors.push(`Row ${rowNumber}: a practical duty also needs its exam school reference or name and subject.`);
      continue;
    }
    rows.push({
      rowNumber,
      teacherName,
      schoolReference: schoolReferenceAt >= 0 ? values[schoolReferenceAt] || undefined : undefined,
      schoolName: schoolNameAt >= 0 ? values[schoolNameAt] || undefined : undefined,
      examSchoolReference,
      examSchoolName,
      subjectId,
      centreCode,
      examDate,
      sessionCode,
      dutyTypeCode,
      roleCode,
      academicYear,
    });
  }
  if (!rows.length && !errors.length) errors.push("Add at least one historical duty row below the headings.");
  return { rows, errors };
}

/** Match uploaded names to the current saved staff and centre lists without guessing. */
export function resolveHistoricalDutyRows(
  parsed: HistoricalDutyImportRow[],
  lookup: HistoricalDutyLookup,
): HistoricalDutyResolution {
  const rows: HistoricalDuty[] = [];
  const errors: string[] = [];
  const centres = new Map(lookup.centres.map((centre) => [heading(centre.centreCode), centre]));
  const seen = new Set<string>();
  for (const entry of parsed) {
    const centre = entry.centreCode ? centres.get(heading(entry.centreCode)) : undefined;
    if (entry.centreCode && !centre) {
      errors.push(`Row ${entry.rowNumber}: centre code ${entry.centreCode} is not in the saved 13A centre list.`);
      continue;
    }
    const matchingSchoolIds = (reference?: string, name?: string) => {
      if (reference) return new Set(lookup.schools
        .filter((school) => school.sourceSchoolCode && schoolReferenceKey(school.sourceSchoolCode) === schoolReferenceKey(reference))
        .map((school) => school.schoolId));
      if (name) return new Set(lookup.schools
        .filter((school) => schoolNameKey(school.schoolName) === schoolNameKey(name))
        .map((school) => school.schoolId));
      return new Set<string>();
    };
    let candidates = lookup.teachers.filter((teacher) => schoolNameKey(teacher.name) === schoolNameKey(entry.teacherName));
    if (entry.schoolReference) {
      const matchingSchools = matchingSchoolIds(entry.schoolReference);
      candidates = candidates.filter((teacher) => matchingSchools.has(teacher.schoolId));
    } else if (entry.schoolName) {
      const matchingSchools = matchingSchoolIds(undefined, entry.schoolName);
      candidates = candidates.filter((teacher) => matchingSchools.has(teacher.schoolId));
    }
    if (candidates.length !== 1) {
      errors.push(`Row ${entry.rowNumber}: ${entry.teacherName} ${candidates.length ? "matches more than one saved teacher; add the school reference" : "does not match a saved teacher"}.`);
      continue;
    }
    const teacher = candidates[0]!;
    if (!centre && entry.dutyTypeCode !== "PRACTICAL_HISTORICAL") {
      errors.push(`Row ${entry.rowNumber}: centre code is required for this duty.`);
      continue;
    }
    const key = [teacher.teacherId, centre?.centreId ?? "", entry.examDate, entry.sessionCode, entry.dutyTypeCode, entry.roleCode, entry.academicYear].join("|");
    if (seen.has(key)) {
      errors.push(`Row ${entry.rowNumber}: this duty is repeated in the uploaded file.`);
      continue;
    }
    seen.add(key);
    const practicalSchoolIds = entry.dutyTypeCode === "PRACTICAL_HISTORICAL"
      ? matchingSchoolIds(entry.examSchoolReference, entry.examSchoolName)
      : new Set<string>();
    if (entry.dutyTypeCode === "PRACTICAL_HISTORICAL" && practicalSchoolIds.size !== 1) {
      errors.push(`Row ${entry.rowNumber}: practical exam school does not match exactly one saved school.`);
      continue;
    }
    rows.push({
      teacherId: teacher.teacherId,
      ...(centre ? { centreId: centre.centreId } : {}),
      ...(practicalSchoolIds.size === 1 ? { schoolId: [...practicalSchoolIds][0] } : {}),
      dutyTypeCode: entry.dutyTypeCode,
      roleCode: entry.roleCode,
      examDate: entry.examDate,
      sessionCode: entry.sessionCode,
      academicYear: entry.academicYear,
      ...(entry.subjectId ? { subjectId: entry.subjectId } : {}),
      dataQuality: "Confirmed",
    });
  }
  const incompletePracticalPairs = new Set<string>();
  const practicalGroups = new Map<string, HistoricalDuty[]>();
  for (const row of rows.filter((row) => row.dutyTypeCode === "PRACTICAL_HISTORICAL")) {
    const key = [row.schoolId, row.subjectId, row.examDate, row.sessionCode, row.academicYear].join("|");
    const group = practicalGroups.get(key) ?? [];
    group.push(row);
    practicalGroups.set(key, group);
  }
  for (const [key, group] of practicalGroups) {
    const internals = group.filter((row) => row.roleCode === "PRACTICAL_INTERNAL");
    const externals = group.filter((row) => row.roleCode === "PRACTICAL_EXTERNAL");
    if (internals.length !== 1 || externals.length !== 1 || internals[0]?.teacherId === externals[0]?.teacherId) {
      incompletePracticalPairs.add(key);
      errors.push(`Practical history ${group[0]?.examDate ?? ""}: each school, subject and session needs one different internal and external examiner.`);
    }
  }
  return {
    rows: rows.filter((row) => row.dutyTypeCode !== "PRACTICAL_HISTORICAL" || !incompletePracticalPairs.has([row.schoolId, row.subjectId, row.examDate, row.sessionCode, row.academicYear].join("|"))),
    errors,
  };
}
