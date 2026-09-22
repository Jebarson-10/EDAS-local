import {
  normalizeSubject,
  type RuleParameters,
  type Teacher,
  type ValidationStatus,
} from "@exam-duty/shared";
import type { PracticalResult } from "@exam-duty/allocation-engine";
import { detectSessionConflicts } from "../conflict/engine.js";
import type { ValidationIssue, ValidationResult } from "../theory/validate.js";

export interface PracticalValidationDataset {
  /** The saved roster makes staff-group validation possible. */
  teachers?: Teacher[];
}

function teachesScheduledSubject(
  teacher: Teacher,
  subjectId: string,
): boolean {
  if (!teacher.subject?.trim()) return false;
  return (
    normalizeSubject(teacher.subject).code === normalizeSubject(subjectId).code
  );
}

export function validatePracticalAllocation(
  result: PracticalResult,
  rules: RuleParameters,
  dataset: PracticalValidationDataset = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  let errors = 0;
  let warnings = 0;
  let valid = 0;
  const teacherById = new Map(
    (dataset.teachers ?? []).map((teacher) => [teacher.teacherId, teacher]),
  );
  const hasRoster = dataset.teachers !== undefined;

  if (!result.feasible) {
    errors += 1;
    issues.push({
      ruleCode: "RULE-PRACTICAL-INFEASIBLE",
      severity: "ERROR",
      message: result.message ?? "NO VALID SCHEDULE",
    });
  }

  // Completion window: all dates for a school within sorted unique date span
  const bySchool = new Map<string, string[]>();
  for (const s of result.schedules) {
    let scheduleValid = true;
    if (!s.internalExaminerId || !s.externalExaminerId) {
      errors += 1;
      scheduleValid = false;
      issues.push({
        ruleCode: "RULE-PRACTICAL-ROLES",
        severity: "ERROR",
        message: "Missing explicit internal/external examiner ids",
        duty: s.batchKey,
      });
      continue;
    }
    if (s.internalExaminerId === s.externalExaminerId) {
      errors += 1;
      scheduleValid = false;
      issues.push({
        ruleCode: "RULE-PRACTICAL-SAME",
        severity: "ERROR",
        message: "Internal and external examiner must be distinct",
        teacherId: s.internalExaminerId,
        duty: s.batchKey,
      });
    }

    if (hasRoster) {
      const staffSlots: Array<{
        teacherId: string;
        role: "Internal" | "External";
      }> = [
        { teacherId: s.internalExaminerId, role: "Internal" },
        { teacherId: s.externalExaminerId, role: "External" },
      ];
      for (const slot of staffSlots) {
        const teacher = teacherById.get(slot.teacherId);
        if (!teacher) {
          errors += 1;
          scheduleValid = false;
          issues.push({
            ruleCode: "RULE-PRACTICAL-STAFF",
            severity: "ERROR",
            message: `${slot.role} examiner is not in the saved staff list`,
            teacherId: slot.teacherId,
            duty: s.batchKey,
          });
        } else if ((teacher.staffCategory ?? "TEACHING") !== "TEACHING") {
          errors += 1;
          scheduleValid = false;
          issues.push({
            ruleCode: "RULE-PRACTICAL-STAFF-CATEGORY",
            severity: "ERROR",
            message: `${slot.role} examiner must be teaching staff`,
            teacherId: slot.teacherId,
            duty: s.batchKey,
          });
        } else if (!teachesScheduledSubject(teacher, s.subjectId)) {
          errors += 1;
          scheduleValid = false;
          issues.push({
            ruleCode: "RULE-PRACTICAL-SUBJECT",
            severity: "ERROR",
            message: `${slot.role} examiner must be recorded for the batch subject`,
            teacherId: slot.teacherId,
            duty: s.batchKey,
            details: { subjectId: s.subjectId, teacherSubject: teacher.subject ?? null },
          });
        }
      }
    }

    if (scheduleValid) {
      valid += 1;
    }
    const dates = bySchool.get(s.schoolId) ?? [];
    dates.push(s.examDate);
    bySchool.set(s.schoolId, dates);
  }

  for (const [schoolId, dates] of bySchool) {
    const uniq = [...new Set(dates)].sort();
    if (uniq.length === 0) continue;
    const start = Date.parse(uniq[0]!);
    const end = Date.parse(uniq[uniq.length - 1]!);
    const days =
      Number.isNaN(start) || Number.isNaN(end)
        ? uniq.length
        : Math.floor((end - start) / 86400000) + 1;
    if (days > rules.practical_completion_days) {
      errors += 1;
      issues.push({
        ruleCode: "RULE-PRACTICAL-WINDOW",
        severity: "ERROR",
        message: `School ${schoolId} practical spans ${days} days > ${rules.practical_completion_days}`,
      });
    }
  }

  const conflicts = detectSessionConflicts(
    result.schedules.flatMap((s) => [
      {
        teacherId: s.internalExaminerId,
        date: s.examDate,
        session: s.sessionCode,
        dutyType: "PRACTICAL_INTERNAL",
        locationId: s.schoolId,
      },
      {
        teacherId: s.externalExaminerId,
        date: s.examDate,
        session: s.sessionCode,
        dutyType: "PRACTICAL_EXTERNAL",
        locationId: s.schoolId,
      },
    ]),
  );
  for (const c of conflicts) {
    errors += 1;
    issues.push({
      ruleCode: c.ruleCode,
      severity: "ERROR",
      message: c.message,
      teacherId: c.teacherId,
      date: c.date,
    });
  }

  let status: ValidationStatus = "VALID";
  if (errors > 0) status = "INVALID";
  else if (warnings > 0) status = "VALID_WITH_WARNINGS";

  return {
    status,
    assignments: result.schedules.length,
    valid,
    warnings,
    errors,
    issues,
    conflicts,
  };
}
