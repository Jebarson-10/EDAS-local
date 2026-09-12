import { teacherImportRowSchema, type TeacherImportRow } from "./validation.js";
import { createId } from "./ids.js";

export type ImportRowStatus =
  | "NEW"
  | "UPDATED"
  | "UNCHANGED"
  | "INVALID"
  | "DUPLICATE"
  | "MISSING";

export interface ExistingTeacherRef {
  employeeCode: string;
  name: string;
  schoolCode: string;
  designation: string;
  isActive: boolean;
  subject?: string | null;
  seniorityRank?: number | null;
  joiningDate?: string | null;
  homeLatitude?: number | null;
  homeLongitude?: number | null;
}

export interface ImportPreviewRow {
  rowNumber: number;
  status: ImportRowStatus;
  message?: string;
  employeeCode?: string;
  payload?: TeacherImportRow;
}

export interface ImportPreviewSummary {
  newTeachers: number;
  updatedTeachers: number;
  inactiveCandidates: number;
  unchanged: number;
  invalidRows: number;
  duplicates: number;
  missingFromFile: number;
  rows: ImportPreviewRow[];
}

/**
 * Preview Excel-derived teacher rows against current master.
 * Never deletes; missing-from-file listed for officer decision (OQ-014).
 */
export function previewTeacherImport(
  rawRows: unknown[],
  existing: ExistingTeacherRef[],
  schools?: Array<{ schoolId: string; schoolCode: string; schoolName: string }>,
): ImportPreviewSummary {
  const rows: ImportPreviewRow[] = [];
  const seenCodes = new Map<string, number>();
  const existingByCode = new Map(existing.map((e) => [e.employeeCode, e]));
  const touched = new Set<string>();
  const seenNames = new Map<string, number>();
  const normal = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase();

  rawRows.forEach((raw, idx) => {
    const rowNumber = idx + 1;
    const input = raw && typeof raw === "object" ? { ...raw } as Record<string, unknown> : {};
    if (schools) {
      const code = normal(input.schoolCode);
      const name = normal(input.schoolName);
      const matches = schools.filter((s) =>
        (code ? normal(s.schoolCode) === code || s.schoolId === input.schoolCode : normal(s.schoolName) === name) &&
        (!name || normal(s.schoolName) === name));
      if (matches.length !== 1) {
        rows.push({ rowNumber, status: "INVALID", message: matches.length ? "More than one school matches. Select the school in Schools & teachers instead." : "School not found. Add it in Schools & teachers, then check the school name or centre code." });
        return;
      }
      input.schoolCode = matches[0]!.schoolId;
    }
    if (!normal(input.employeeCode)) {
      const key = `${normal(input.schoolCode)}|${normal(input.name)}`;
      const previous = seenNames.get(key);
      if (previous != null) {
        const first = rows.find((r) => r.rowNumber === previous);
        if (first) { first.status = "DUPLICATE"; first.message = "Same teacher name appears twice at this school. Add these teachers separately in Schools & teachers."; }
        rows.push({ rowNumber, status: "DUPLICATE", message: `Same teacher name as row ${previous}. Add these teachers separately in Schools & teachers.` });
        return;
      }
      seenNames.set(key, rowNumber);
      const matches = existing.filter((t) => normal(t.schoolCode) === normal(input.schoolCode) && normal(t.name) === normal(input.name));
      if (matches.length > 1) {
        rows.push({ rowNumber, status: "INVALID", message: "More than one teacher has this name at this school. Choose the teacher in Schools & teachers to update them." });
        return;
      }
      input.employeeCode = matches[0]?.employeeCode ?? createId("auto");
    }
    const parsed = teacherImportRowSchema.safeParse(input);
    if (!parsed.success) {
      rows.push({
        rowNumber,
        status: "INVALID",
        message: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }
    const row = parsed.data;
    const prev = seenCodes.get(row.employeeCode);
    if (prev != null) {
      rows.push({
        rowNumber,
        status: "DUPLICATE",
        employeeCode: row.employeeCode,
        message: `Same teacher also on row ${prev}`,
        payload: row,
      });
      return;
    }
    seenCodes.set(row.employeeCode, rowNumber);
    touched.add(row.employeeCode);

    const cur = existingByCode.get(row.employeeCode);
    if (!cur) {
      rows.push({ rowNumber, status: "NEW", employeeCode: row.employeeCode, payload: row });
      return;
    }
    const changed =
      cur.name !== row.name ||
      cur.schoolCode !== row.schoolCode ||
      cur.designation !== row.designation ||
      cur.isActive !== (row.isActive ?? true) ||
      (["subject", "seniorityRank", "joiningDate", "homeLatitude", "homeLongitude"] as const)
        .some((key) => row[key] !== undefined && (cur[key] ?? null) !== (row[key] ?? null));
    rows.push({
      rowNumber,
      status: changed ? "UPDATED" : "UNCHANGED",
      employeeCode: row.employeeCode,
      payload: row,
      message: changed ? "Fields differ from current master" : undefined,
    });
  });

  let missingFromFile = 0;
  for (const e of existing) {
    if (!touched.has(e.employeeCode) && e.isActive) {
      missingFromFile += 1;
      rows.push({
        rowNumber: -1,
        status: "MISSING",
        employeeCode: e.employeeCode,
        message: "Not in this file. Kept unless you choose to mark them inactive.",
      });
    }
  }

  return {
    newTeachers: rows.filter((r) => r.status === "NEW").length,
    updatedTeachers: rows.filter((r) => r.status === "UPDATED").length,
    inactiveCandidates: rows.filter((r) => r.status === "MISSING").length,
    unchanged: rows.filter((r) => r.status === "UNCHANGED").length,
    invalidRows: rows.filter((r) => r.status === "INVALID").length,
    duplicates: rows.filter((r) => r.status === "DUPLICATE").length,
    missingFromFile,
    rows,
  };
}
