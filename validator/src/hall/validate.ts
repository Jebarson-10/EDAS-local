import type { HallResult } from "@exam-duty/allocation-engine";
import type { RuleParameters, ValidationStatus } from "@exam-duty/shared";
import { calculateHallRequirements } from "@exam-duty/allocation-engine";
import { detectSessionConflicts } from "../conflict/engine.js";
import type { ValidationIssue, ValidationResult } from "../theory/validate.js";

export function validateHallAllocation(
  result: HallResult,
  demands: Array<{ centreId: string; totalStudents: number }>,
  rules: RuleParameters,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  let errors = 0;
  let warnings = 0;
  let valid = 0;

  for (const d of demands) {
    const expected = calculateHallRequirements(
      d.totalStudents,
      rules.students_per_hall,
      rules.standby_percentage,
    );
    const gotHalls = result.requiredHallsByCentre[d.centreId] ?? -1;
    const gotStandby = result.standbyByCentre[d.centreId] ?? -1;
    if (gotHalls !== expected.requiredHalls || gotStandby !== expected.standby) {
      errors += 1;
      issues.push({
        ruleCode: "RULE-HALL-CALC",
        severity: "ERROR",
        message: `Hall/standby calc mismatch for ${d.centreId}`,
      });
    }
  }

  const seen = new Set<string>();
  for (const a of result.assignments) {
    if (seen.has(a.teacherId)) {
      errors += 1;
      issues.push({
        ruleCode: "RULE-HALL-DUP",
        severity: "ERROR",
        message: "Teacher assigned twice in hall run",
        teacherId: a.teacherId,
      });
    } else {
      seen.add(a.teacherId);
      valid += 1;
    }
  }

  for (const s of result.shortages) {
    errors += 1;
    issues.push({
      ruleCode: "RULE-HALL-SHORTAGE",
      severity: "ERROR",
      message: s.message,
      centreId: s.centreId,
      details: {
        centreId: s.centreId,
        required: s.required,
        eligible: s.eligible,
        shortage: s.shortage,
      },
    });
  }

  const conflicts = detectSessionConflicts(
    result.assignments.map((a) => ({
      teacherId: a.teacherId,
      date: a.examDate,
      session: a.sessionCode,
      dutyType: a.roleCode,
      locationId: a.centreId,
    })),
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
    assignments: result.assignments.length,
    valid,
    warnings,
    errors,
    issues,
    conflicts,
  };
}
