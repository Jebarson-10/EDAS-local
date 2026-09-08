import type { RuleParameters, ValidationStatus } from "@exam-duty/shared";
import {
  evaluateTheoryCandidate,
  type TheoryAllocationResult,
  type TheoryDataset,
  type TheoryRequirement,
} from "@exam-duty/allocation-engine";
import { detectSessionConflicts, type ConflictFinding } from "../conflict/engine.js";

export interface ValidationIssue {
  ruleCode: string;
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
  teacherId?: string;
  centreId?: string;
  date?: string;
  duty?: string;
  details?: Record<string, unknown>;
}

export interface ValidationResult {
  status: ValidationStatus;
  assignments: number;
  /** Omitted on hydrate when summary_json did not persist the live count. */
  valid?: number;
  warnings: number;
  errors: number;
  issues: ValidationIssue[];
  conflicts: ConflictFinding[];
}

/**
 * Independent theory validator: re-evaluates hard constraints per assignment
 * rather than trusting the allocator's eligibility flag.
 */
export function validateTheoryAllocation(
  requirements: TheoryRequirement[],
  result: TheoryAllocationResult,
  dataset: TheoryDataset,
  rules: RuleParameters,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const schoolById = new Map(dataset.schools.map((s) => [s.schoolId, s]));
  const centreById = new Map(dataset.centres.map((c) => [c.centreId, c]));
  const reqByKey = new Map(requirements.map((r) => [r.requirementKey, r]));
  const occupied = new Set<string>();
  let valid = 0;
  let warnings = 0;
  let errors = 0;

  // Duplicate teacher assignments
  const seenTeachers = new Set<string>();

  for (const a of result.assignments) {
    const req = reqByKey.get(a.requirementKey);
    const centre = centreById.get(a.centreId);
    const teacher = dataset.teachers.find((t) => t.teacherId === a.teacherId);

    if (!req || !centre || !teacher) {
      errors += 1;
      issues.push({
        ruleCode: "RULE-VALIDATOR-REF",
        severity: "ERROR",
        message: "Assignment references unknown requirement/centre/teacher",
        teacherId: a.teacherId,
        centreId: a.centreId,
      });
      continue;
    }

    if (seenTeachers.has(a.teacherId)) {
      errors += 1;
      issues.push({
        ruleCode: "RULE-VALIDATOR-DUP",
        severity: "ERROR",
        message: "Teacher assigned more than once in this run",
        teacherId: a.teacherId,
      });
    }
    seenTeachers.add(a.teacherId);

    const band: "preferred" | "fallback" = a.usedFallbackBand
      ? "fallback"
      : "preferred";
    const ev = evaluateTheoryCandidate(
      teacher,
      centre,
      schoolById,
      dataset,
      rules,
      occupied,
      req,
      band,
    );

    // If fallback used, also accept preferred band failure as long as fallback passes
    let ok = ev.eligible;
    if (!ok && a.usedFallbackBand) {
      const ev2 = evaluateTheoryCandidate(
        teacher,
        centre,
        schoolById,
        dataset,
        rules,
        occupied,
        req,
        "fallback",
      );
      ok = ev2.eligible;
      for (const r of ev2.hardReasons) {
        if (!ok) {
          errors += 1;
          issues.push({
            ruleCode: r.ruleCode,
            severity: "ERROR",
            message: r.message,
            teacherId: a.teacherId,
            centreId: a.centreId,
            date: a.examDate,
            duty: a.roleCode,
          });
        }
      }
      for (const r of ev2.softNotes) {
        if (r.severity === "WARNING") {
          warnings += 1;
          issues.push({
            ruleCode: r.ruleCode,
            severity: "WARNING",
            message: r.message,
            teacherId: a.teacherId,
            centreId: a.centreId,
          });
        }
      }
    } else {
      for (const r of ev.hardReasons) {
        errors += 1;
        issues.push({
          ruleCode: r.ruleCode,
          severity: "ERROR",
          message: r.message,
          teacherId: a.teacherId,
          centreId: a.centreId,
          date: a.examDate,
          duty: a.roleCode,
        });
      }
      for (const r of ev.softNotes) {
        if (r.severity === "WARNING") {
          warnings += 1;
          issues.push({
            ruleCode: r.ruleCode,
            severity: "WARNING",
            message: r.message,
            teacherId: a.teacherId,
            centreId: a.centreId,
          });
        }
      }
    }

    if (ok) valid += 1;
    occupied.add(`${a.teacherId}|${a.examDate}|${a.sessionCode}`);
  }

  const conflicts = detectSessionConflicts(
    result.assignments.map((a) => ({
      teacherId: a.teacherId,
      date: a.examDate,
      session: a.sessionCode,
      dutyType: a.roleCode,
      locationId: a.centreId,
    })),
    dataset.calendar,
  );
  for (const c of conflicts) {
    errors += 1;
    issues.push({
      ruleCode: c.ruleCode,
      severity: "ERROR",
      message: c.message,
      teacherId: c.teacherId,
      date: c.date,
      duty: c.duties.join(","),
    });
  }

  // Shortages are not hard errors on published validation of partial? Spec: no result with hard errors may be published.
  // Shortages mean incomplete — treat as ERROR for publish gate.
  for (const s of result.shortages) {
    errors += 1;
    issues.push({
      ruleCode: "RULE-SHORTAGE",
      severity: "ERROR",
      message: s.message,
      duty: s.requirementKey,
      details: {
        requirementKey: s.requirementKey,
        required: s.required,
        eligible: s.eligible,
        shortage: s.shortage,
        exclusionTallies: s.exclusionTallies,
        ...(s.hmRequirementMeta
          ? { hmRequirementMeta: s.hmRequirementMeta }
          : {}),
      },
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
