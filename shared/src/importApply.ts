import type {
  Teacher,
  TeacherSchoolHistory,
  TeacherDesignationHistory,
  School,
} from "./types.js";
import { makeId } from "./ids.js";
import { previewTeacherImport, type TeacherImportPreview } from "./importPreview.js";
import { parseTeacherRowsFromAoa } from "./importParse.js";

export function historySourceImportId(importId?: string): string {
  return importId?.trim() ?? "";
}

export function applyTeacherImport(opts: {
  preview: TeacherImportPreview;
  teachers: Teacher[];
  schools: School[];
  importId?: string;
  asOfDate: string;
}): {
  teachers: Teacher[];
  schoolHistory: TeacherSchoolHistory[];
  designationHistory: TeacherDesignationHistory[];
  appliedNew: number;
  appliedUpdated: number;
} {
  const schoolHistory: TeacherSchoolHistory[] = [];
  const designationHistory: TeacherDesignationHistory[] = [];
  const teachers = [...opts.teachers];
  const byCode = new Map(teachers.map((t) => [t.employeeCode, t]));
  const schoolByCode = new Map(opts.schools.map((s) => [s.schoolCode, s]));
  const importId = historySourceImportId(opts.importId);

  let appliedNew = 0;
  let appliedUpdated = 0;

  for (const row of opts.preview.toCreate) {
    const school = schoolByCode.get(row.schoolCode);
    if (!school) continue;
    const teacher: Teacher = {
      teacherId: makeId("t"),
      employeeCode: row.employeeCode,
      name: row.name,
      schoolId: school.schoolId,
      designation: row.designation,
      isActive: row.isActive ?? true,
      dataQuality: "Confirmed",
    };
    teachers.push(teacher);
    byCode.set(teacher.employeeCode, teacher);
    schoolHistory.push({
      teacherId: teacher.teacherId,
      schoolId: school.schoolId,
      effectiveFrom: opts.asOfDate,
      sourceImportId: importId,
    });
    designationHistory.push({
      teacherId: teacher.teacherId,
      designation: row.designation,
      effectiveFrom: opts.asOfDate,
      sourceImportId: importId,
    });
    appliedNew += 1;
  }

  for (const row of opts.preview.toUpdate) {
    const existing = byCode.get(row.employeeCode);
    const school = schoolByCode.get(row.schoolCode);
    if (!existing || !school) continue;
    if (existing.schoolId !== school.schoolId) {
      schoolHistory.push({
        teacherId: existing.teacherId,
        schoolId: existing.schoolId,
        effectiveFrom: "1970-01-01",
        effectiveTo: opts.asOfDate,
        sourceImportId: importId,
      });
      schoolHistory.push({
        teacherId: existing.teacherId,
        schoolId: school.schoolId,
        effectiveFrom: opts.asOfDate,
        sourceImportId: importId,
      });
    }
    if (existing.designation !== row.designation) {
      designationHistory.push({
        teacherId: existing.teacherId,
        designation: existing.designation,
        effectiveFrom: "1970-01-01",
        effectiveTo: opts.asOfDate,
        sourceImportId: importId,
      });
      designationHistory.push({
        teacherId: existing.teacherId,
        designation: row.designation,
        effectiveFrom: opts.asOfDate,
        sourceImportId: importId,
      });
    }
    existing.schoolId = school.schoolId;
    existing.designation = row.designation;
    existing.name = row.name;
    if (row.isActive !== undefined) existing.isActive = row.isActive;
    appliedUpdated += 1;
  }

  return { teachers, schoolHistory, designationHistory, appliedNew, appliedUpdated };
}

export {
  previewTeacherImport,
  parseTeacherRowsFromAoa,
};
export type { TeacherImportPreview };
