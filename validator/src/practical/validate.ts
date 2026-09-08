import type { RuleParameters, ValidationStatus } from "@exam-duty/shared";
import type { PracticalResult } from "@exam-duty/allocation-engine";
import { detectSessionConflicts } from "../conflict/engine.js";
import type { ValidationIssue, ValidationResult } from "../theory/validate.js";

export function validatePracticalAllocation(
  result: PracticalResult,
  rules: RuleParameters,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  let errors = 0;
  let warnings = 0;
  let valid = 0;

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
    if (!s.internalExaminerId || !s.externalExaminerId) {
      errors += 1;
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
      issues.push({
        ruleCode: "RULE-PRACTICAL-SAME",
        severity: "ERROR",
        message: "Internal and external examiner must be distinct",
        teacherId: s.internalExaminerId,
        duty: s.batchKey,
      });
    } else {
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
