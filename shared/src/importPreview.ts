import { teacherImportRowSchema, type TeacherImportRow } from "./validation.js";

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
): ImportPreviewSummary {
  const rows: ImportPreviewRow[] = [];
  const seenCodes = new Map<string, number>();
  const existingByCode = new Map(existing.map((e) => [e.employeeCode, e]));
  const touched = new Set<string>();

  rawRows.forEach((raw, idx) => {
    const rowNumber = idx + 1;
    const parsed = teacherImportRowSchema.safeParse(raw);
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
        message: `Duplicate employee code also on row ${prev}`,
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
      cur.isActive !== (row.isActive ?? true);
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
        message: "Present in database but absent from file — no silent deactivate (OQ-014)",
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
