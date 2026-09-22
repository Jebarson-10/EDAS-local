import type { RuleParameters, ValidationStatus } from "@exam-duty/shared";
import type {
  TheoryAllocationResult,
  TheoryDataset,
  TheoryRequirement,
} from "@exam-duty/allocation-engine";
import { detectSessionConflicts, type ConflictFinding } from "../conflict/engine.js";
import { validateTheoryCandidateEligibility } from "./eligibility.js";

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
  const seenTeacherSessions = new Set<string>();
  const assignmentsByRequirement = new Map<string, number>();
  for (const assignment of result.assignments) {
    assignmentsByRequirement.set(
      assignment.requirementKey,
      (assignmentsByRequirement.get(assignment.requirementKey) ?? 0) + 1,
    );
  }

  const shortageKeys = new Set(result.shortages.map((s) => s.requirementKey));
  for (const requirement of requirements) {
    const count = assignmentsByRequirement.get(requirement.requirementKey) ?? 0;
    if (count === 0 && !shortageKeys.has(requirement.requirementKey)) {
      errors += 1;
      issues.push({
        ruleCode: "RULE-VALIDATOR-MISSING",
        severity: "ERROR",
        message: "Required duty has neither an assignment nor a recorded shortage",
        centreId: requirement.centreId,
        date: requirement.examDate,
        duty: requirement.roleCode,
        details: { requirementKey: requirement.requirementKey },
      });
    } else if (count > 1) {
      errors += 1;
      issues.push({
        ruleCode: "RULE-VALIDATOR-REQUIREMENT-DUP",
        severity: "ERROR",
        message: "More than one teacher is assigned to the same required duty",
        centreId: requirement.centreId,
        date: requirement.examDate,
        duty: requirement.roleCode,
        details: { requirementKey: requirement.requirementKey, assignments: count },
      });
    }
  }

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

    const identityMatches =
      a.centreId === req.centreId &&
      a.roleCode === req.roleCode &&
      a.examDate === req.examDate &&
      a.sessionCode === req.sessionCode;
    if (!identityMatches) {
      errors += 1;
      issues.push({
        ruleCode: "RULE-VALIDATOR-IDENTITY",
        severity: "ERROR",
        message: "Assignment does not match its required centre, role, date, or session",
        teacherId: a.teacherId,
        centreId: a.centreId,
        date: a.examDate,
        duty: a.roleCode,
        details: {
          requirementKey: req.requirementKey,
          expectedCentreId: req.centreId,
          expectedRoleCode: req.roleCode,
          expectedExamDate: req.examDate,
          expectedSessionCode: req.sessionCode,
        },
      });
    }

    const teacherSessionKey = `${a.teacherId}|${a.examDate}|${a.sessionCode}`;
    if (seenTeacherSessions.has(teacherSessionKey)) {
      errors += 1;
      issues.push({
        ruleCode: "RULE-VALIDATOR-DUP",
        severity: "ERROR",
        message: "Teacher assigned more than once in the same date/session",
        teacherId: a.teacherId,
      });
    }
    seenTeacherSessions.add(teacherSessionKey);

    const band: "preferred" | "fallback" = a.usedFallbackBand
      ? "fallback"
      : "preferred";
    const evaluation = validateTheoryCandidateEligibility(
      teacher,
      centre,
      schoolById,
      dataset,
      rules,
      occupied,
      req,
      band,
    );

    for (const reason of evaluation.hardReasons) {
      errors += 1;
      issues.push({
        ruleCode: reason.ruleCode,
        severity: "ERROR",
        message: reason.message,
        teacherId: a.teacherId,
        centreId: a.centreId,
        date: a.examDate,
        duty: a.roleCode,
      });
    }
    for (const warning of evaluation.warnings) {
      warnings += 1;
      issues.push({
        ruleCode: warning.ruleCode,
        severity: "WARNING",
        message: warning.message,
        teacherId: a.teacherId,
        centreId: a.centreId,
        date: a.examDate,
        duty: a.roleCode,
      });
    }

    if (evaluation.eligible && identityMatches) valid += 1;
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
