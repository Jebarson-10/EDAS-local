import type { Teacher } from "./types.js";
import type { ImportPreviewSummary } from "./importPreview.js";
import { createId } from "./ids.js";

/**
 * File-derived preview rows for `source_imports.row_count`.
 * MISSING sentinels use rowNumber < 0 and must not inflate the file count.
 * Never pass the full roster upsert count as row_count — that lies vs the file.
 */
export function importFileRowCount(
  rows?: Array<{ rowNumber: number }> | null,
): number | undefined {
  if (!rows?.length) return undefined;
  const n = rows.filter((r) => r.rowNumber > 0).length;
  return n > 0 ? n : undefined;
}

/** Drill-down outcomes vs file rows (MISSING sentinels use rowNumber < 0). */
export function importDrilldownCounts(
  rows?: Array<{ rowNumber?: number; row_number?: number }> | null,
): { fileRows: number; outcomes: number } {
  const list = rows ?? [];
  let fileRows = 0;
  for (const r of list) {
    const n = r.rowNumber ?? r.row_number ?? 0;
    if (n > 0) fileRows += 1;
  }
  return { fileRows, outcomes: list.length };
}

/** Optional `X-Row-Count` from a client that already parsed the workbook. */
export function parseImportRowCountHeader(
  value: string | null | undefined,
): number | undefined {
  if (value == null || String(value).trim() === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return undefined;
  return n;
}

export interface SchoolCodeRef {
  schoolId: string;
  schoolCode: string;
}

export interface TeacherSchoolHistoryRow {
  id: string;
  teacherId: string;
  schoolId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceImportId: string;
  createdAt: string;
}

export interface TeacherDesignationHistoryRow {
  id: string;
  teacherId: string;
  designation: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceImportId: string;
  createdAt: string;
}

/** Stored location windows — display/audit only (OQ-001 / OQ-004). */
export interface TeacherLocationHistoryRow {
  id: string;
  teacherId: string;
  locationType: "HOME" | "SCHOOL";
  latitude: number;
  longitude: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceImportId: string;
  createdAt: string;
}

/** Archived `source_imports` id, or empty when apply has no file provenance. */
export function historySourceImportId(archivedId?: string | null): string {
  const id = archivedId?.trim();
  return id ? id : "";
}

export interface ApplyTeacherImportInput {
  preview: ImportPreviewSummary;
  teachers: Teacher[];
  schools: SchoolCodeRef[];
  /** Real archive id only — never invent a local `imp_*`. Empty = no provenance. */
  importId?: string;
  asOfDate: string;
  /** Officer choices for MISSING rows (OQ-014) — default leave unchanged */
  missingAction?: "leave" | "deactivate";
}

export interface ApplyTeacherImportResult {
  teachers: Teacher[];
  schoolHistory: TeacherSchoolHistoryRow[];
  designationHistory: TeacherDesignationHistoryRow[];
  appliedNew: number;
  appliedUpdated: number;
  deactivated: number;
  skippedInvalid: number;
  skippedDuplicates: number;
  skippedMissing: number;
}

/**
 * Apply a confirmed import preview to current master + history.
 * Never deletes teachers; never erases history — closes prior history windows.
 */
export function applyTeacherImport(
  input: ApplyTeacherImportInput,
): ApplyTeacherImportResult {
  const importId = historySourceImportId(input.importId);
  const schoolByCode = new Map(
    input.schools.map((s) => [s.schoolCode, s.schoolId]),
  );
  const byCode = new Map(input.teachers.map((t) => [t.employeeCode, { ...t }]));
  const schoolHistory: TeacherSchoolHistoryRow[] = [];
  const designationHistory: TeacherDesignationHistoryRow[] = [];
  let appliedNew = 0;
  let appliedUpdated = 0;
  let deactivated = 0;
  let skippedInvalid = 0;
  let skippedDuplicates = 0;
  let skippedMissing = 0;
  const missingAction = input.missingAction ?? "leave";

  for (const row of input.preview.rows) {
    if (row.status === "INVALID") {
      skippedInvalid += 1;
      continue;
    }
    if (row.status === "DUPLICATE") {
      skippedDuplicates += 1;
      continue;
    }
    if (row.status === "UNCHANGED") continue;

    if (row.status === "MISSING") {
      skippedMissing += 1;
      if (missingAction === "deactivate" && row.employeeCode) {
        const t = byCode.get(row.employeeCode);
        if (t && t.isActive) {
          t.isActive = false;
          t.dataQuality = "ManuallyCorrected";
          deactivated += 1;
        }
      }
      continue;
    }

    if (!row.payload || !row.employeeCode) continue;
    const payload = row.payload;
    const schoolId = schoolByCode.get(payload.schoolCode);
    if (!schoolId) {
      skippedInvalid += 1;
      continue;
    }

    if (row.status === "NEW") {
      const teacherId = createId("tch");
      byCode.set(payload.employeeCode, {
        teacherId,
        employeeCode: payload.employeeCode,
        name: payload.name,
        schoolId,
        designation: payload.designation,
        subject: payload.subject ?? null,
        seniorityRank: payload.seniorityRank ?? null,
        joiningDate: payload.joiningDate ?? null,
        homeLatitude: payload.homeLatitude ?? null,
        homeLongitude: payload.homeLongitude ?? null,
        isActive: payload.isActive ?? true,
        dataQuality: "Imported",
      });
      schoolHistory.push({
        id: createId("tsh"),
        teacherId,
        schoolId,
        effectiveFrom: input.asOfDate,
        effectiveTo: null,
        sourceImportId: importId,
        createdAt: input.asOfDate,
      });
      designationHistory.push({
        id: createId("tdh"),
        teacherId,
        designation: payload.designation,
        effectiveFrom: input.asOfDate,
        effectiveTo: null,
        sourceImportId: importId,
        createdAt: input.asOfDate,
      });
      appliedNew += 1;
      continue;
    }

    if (row.status === "UPDATED") {
      const existing = byCode.get(payload.employeeCode);
      if (!existing) continue;
      if (existing.schoolId !== schoolId) {
        schoolHistory.push({
          id: createId("tsh"),
          teacherId: existing.teacherId,
          schoolId: existing.schoolId,
          effectiveFrom: "1900-01-01",
          effectiveTo: input.asOfDate,
          sourceImportId: importId,
          createdAt: input.asOfDate,
        });
        schoolHistory.push({
          id: createId("tsh"),
          teacherId: existing.teacherId,
          schoolId,
          effectiveFrom: input.asOfDate,
          effectiveTo: null,
          sourceImportId: importId,
          createdAt: input.asOfDate,
        });
      }
      if (existing.designation !== payload.designation) {
        designationHistory.push({
          id: createId("tdh"),
          teacherId: existing.teacherId,
          designation: existing.designation,
          effectiveFrom: "1900-01-01",
          effectiveTo: input.asOfDate,
          sourceImportId: importId,
          createdAt: input.asOfDate,
        });
        designationHistory.push({
          id: createId("tdh"),
          teacherId: existing.teacherId,
          designation: payload.designation,
          effectiveFrom: input.asOfDate,
          effectiveTo: null,
          sourceImportId: importId,
          createdAt: input.asOfDate,
        });
      }
      existing.name = payload.name;
      existing.schoolId = schoolId;
      existing.designation = payload.designation;
      existing.subject = payload.subject ?? existing.subject;
      existing.seniorityRank =
        payload.seniorityRank ?? existing.seniorityRank ?? null;
      existing.joiningDate = payload.joiningDate ?? existing.joiningDate ?? null;
      existing.homeLatitude =
        payload.homeLatitude ?? existing.homeLatitude ?? null;
      existing.homeLongitude =
        payload.homeLongitude ?? existing.homeLongitude ?? null;
      existing.isActive = payload.isActive ?? existing.isActive;
      existing.dataQuality = "Imported";
      byCode.set(payload.employeeCode, existing);
      appliedUpdated += 1;
    }
  }

  return {
    teachers: [...byCode.values()],
    schoolHistory,
    designationHistory,
    appliedNew,
    appliedUpdated,
    deactivated,
    skippedInvalid,
    skippedDuplicates,
    skippedMissing,
  };
}
