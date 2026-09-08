import {
  employeeCodeFromMasters,
  type PersistedAllocationResultRow,
} from "./persistedHall.js";
import type {
  DecisionReason,
  DecisionTrace,
  SessionCode,
  Severity,
} from "./types.js";

const FALLBACK_RULE_CODES = new Set(["INFO-HM-FALLBACK", "MANUAL_OVERRIDE"]);

/** Generate result-scoped INFO-* (distance / fairness / fallback / selected). */
export function isGeneratedInfoRuleCode(code: string): boolean {
  return code.startsWith("INFO-");
}

function detailsRecordFromJson(
  detailsJson: string | null | undefined,
): Record<string, unknown> {
  if (!detailsJson) return {};
  try {
    const parsed = JSON.parse(detailsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // keep empty
  }
  return {};
}

function resultRowWasOverridden(row: {
  is_override?: number | boolean | null;
  final_teacher_id?: string | null;
  generated_teacher_id?: string | null;
}): boolean {
  if (row.is_override === 1 || row.is_override === true) return true;
  const generated = String(row.generated_teacher_id ?? "").trim();
  const finalId = String(row.final_teacher_id ?? "").trim();
  return Boolean(finalId && generated && finalId !== generated);
}

function isCentreLevelGenerateFinding(
  code: string,
  details: Record<string, unknown>,
  teacherFromDetails: string,
): boolean {
  if (teacherFromDetails) return false;
  const source = typeof details.source === "string" ? details.source : "";
  return (
    details.unmatched === true ||
    source === "validator" ||
    code === "RULE-SHORTAGE" ||
    code === "RULE-HALL-SHORTAGE"
  );
}

/**
 * Generate persisted INFO-* / RULE-* / WARN as the chosen teacher. After an
 * override those rows still name the old pick (or COALESCE-attribute them to
 * the replacement). Why already drops INFO-*; list/Validation must not show
 * generate conflict/fallback/distance as the override teacher's.
 * MANUAL_OVERRIDE and centre-level shortages stay.
 */
export function isOverriddenGeneratedSelectionReason(row: {
  rule_code?: string | null;
  ruleCode?: string | null;
  is_override?: number | boolean | null;
  final_teacher_id?: string | null;
  generated_teacher_id?: string | null;
  details_json?: string | null;
}): boolean {
  const code = String(row.rule_code ?? row.ruleCode ?? "");
  if (!resultRowWasOverridden(row)) return false;
  if (isGeneratedInfoRuleCode(code)) return true;
  if (code === "MANUAL_OVERRIDE" || !code) return false;

  const details = detailsRecordFromJson(row.details_json);
  const teacherFromDetails =
    typeof details.teacherId === "string" ? details.teacherId.trim() : "";
  if (isCentreLevelGenerateFinding(code, details, teacherFromDetails)) {
    return false;
  }
  const generated = String(row.generated_teacher_id ?? "").trim();
  return !teacherFromDetails || teacherFromDetails === generated;
}

export interface HydratedTheoryAssignment {
  requirementKey: string;
  teacherId: string;
  employeeCode: string;
  centreId: string;
  roleCode: string;
  examDate: string;
  sessionCode: SessionCode;
  score: number;
  usedFallbackBand: boolean;
  decisionTrace: DecisionTrace & { score: number; selectedBecause: string };
}

function parseTrace(decisionTraceJson: string | null | undefined): unknown {
  if (!decisionTraceJson) return null;
  try {
    return JSON.parse(decisionTraceJson) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function notesHaveRoleSwitch(notes: unknown): boolean {
  if (!Array.isArray(notes)) return false;
  return notes.some((n) => typeof n === "string" && /role switch/i.test(n));
}

function reasonsHaveFallback(reasons: unknown): boolean {
  if (!Array.isArray(reasons)) return false;
  return reasons.some((r) => {
    if (!r || typeof r !== "object") return false;
    return FALLBACK_RULE_CODES.has(
      String((r as { ruleCode?: unknown }).ruleCode ?? ""),
    );
  });
}

/**
 * Fold the officer override onto the persisted generate trace so Why / hydrate
 * name the replacement teacher instead of the generated pick.
 */
export function mergeOverrideIntoDecisionTrace(
  decisionTraceJson: string | null | undefined,
  input: {
    newTeacherId: string;
    oldTeacherId: string;
    requirementKey: string;
    reason: string;
  },
): string {
  const parsed = parseTrace(decisionTraceJson);
  const base: Record<string, unknown> = isRecord(parsed)
    ? { ...parsed }
    : Array.isArray(parsed)
      ? { decisionNotes: parsed }
      : {};
  const existingReasons = Array.isArray(base.reasons) ? base.reasons : [];
  const kept = existingReasons.filter((r) => {
    if (!r || typeof r !== "object") return true;
    const code = String((r as { ruleCode?: unknown }).ruleCode ?? "");
    return code !== "MANUAL_OVERRIDE" && !isGeneratedInfoRuleCode(code);
  });
  kept.push({
    ruleCode: "MANUAL_OVERRIDE",
    severity: "WARNING",
    message: input.reason.trim(),
    details: {
      oldTeacherId: input.oldTeacherId,
      newTeacherId: input.newTeacherId,
      requirementKey: input.requirementKey,
    },
  });
  const requirementKey =
    typeof base.requirementKey === "string" && base.requirementKey.trim()
      ? base.requirementKey
      : input.requirementKey;
  return JSON.stringify({
    ...base,
    teacherId: input.newTeacherId,
    selectedBecause: "manual override",
    usedFallbackBand: true,
    requirementKey,
    reasons: kept,
  });
}

/**
 * Persist already accepts `usedFallback` on the run POST, but the column is
 * not stored. Fold the flag into decision_trace_json so hydrate can read it
 * after restore/reload (same pattern as hall `{ slotIndex }`).
 */
export function mergeFallbackIntoDecisionTrace(
  decisionTraceJson: string,
  usedFallback: boolean,
): string {
  const parsed = parseTrace(decisionTraceJson);
  if (Array.isArray(parsed)) {
    return JSON.stringify({
      decisionNotes: parsed,
      roleSwitchApplied: usedFallback,
      usedFallbackBand: usedFallback,
    });
  }
  if (isRecord(parsed)) {
    return JSON.stringify({
      ...parsed,
      usedFallbackBand: usedFallback,
    });
  }
  return decisionTraceJson;
}

/**
 * Theory Fallback column + exception report. Prefer the explicit persisted
 * boolean; otherwise recover from is_override or INFO-HM-FALLBACK /
 * MANUAL_OVERRIDE already stored on the trace (old rows).
 */
export function usedFallbackBandFromPersisted(
  row: PersistedAllocationResultRow,
): boolean {
  const parsed = parseTrace(row.decision_trace_json);
  if (isRecord(parsed)) {
    if (typeof parsed.usedFallbackBand === "boolean") {
      return parsed.usedFallbackBand;
    }
    if (typeof parsed.usedFallback === "boolean") {
      return parsed.usedFallback;
    }
  }
  if (row.is_override === 1 || row.is_override === true) return true;
  if (isRecord(parsed) && reasonsHaveFallback(parsed.reasons)) return true;
  return false;
}

/**
 * Practical Role-switch column + CSV. Prefer the explicit persisted boolean;
 * old rows stored a notes array and can be recovered from that text.
 */
export function roleSwitchAppliedFromPersisted(
  row: PersistedAllocationResultRow | undefined,
): boolean {
  if (!row) return false;
  const parsed = parseTrace(row.decision_trace_json);
  if (isRecord(parsed)) {
    if (typeof parsed.roleSwitchApplied === "boolean") {
      return parsed.roleSwitchApplied;
    }
    if (typeof parsed.usedFallbackBand === "boolean") {
      return parsed.usedFallbackBand;
    }
    if (notesHaveRoleSwitch(parsed.decisionNotes)) return true;
  }
  if (Array.isArray(parsed) && notesHaveRoleSwitch(parsed)) return true;
  return false;
}

export function roleSwitchAppliedForSchedule(
  rows: PersistedAllocationResultRow[],
  schedule: {
    schoolId: string;
    examDate: string;
    internalExaminerId: string;
  },
): boolean {
  const row = rows.find((r) => {
    const teacherId = r.final_teacher_id || r.teacher_id;
    return (
      r.centre_id === schedule.schoolId &&
      r.exam_date === schedule.examDate &&
      teacherId === schedule.internalExaminerId
    );
  });
  return roleSwitchAppliedFromPersisted(row);
}

export function feasibleFromPersistedSummary(
  summaryJson: string | null | undefined,
  rowCount: number,
): boolean {
  if (summaryJson) {
    const parsed = parseTrace(summaryJson);
    if (isRecord(parsed) && typeof parsed.feasible === "boolean") {
      return parsed.feasible;
    }
  }
  return rowCount > 0;
}

function asSeverity(value: unknown): Severity {
  return value === "ERROR" || value === "WARNING" || value === "INFO"
    ? value
    : "INFO";
}

function requirementKeyFromPersisted(
  row: PersistedAllocationResultRow,
  parsed: unknown,
): string {
  if (isRecord(parsed) && typeof parsed.requirementKey === "string") {
    const key = parsed.requirementKey.trim();
    if (key) return key;
  }
  return `${row.centre_id}-${row.role_code}`;
}

function rowWasOverridden(row: PersistedAllocationResultRow): boolean {
  if (row.is_override === 1 || row.is_override === true) return true;
  return Boolean(row.final_teacher_id && row.final_teacher_id !== row.teacher_id);
}

function overlayOverrideOnTheoryTrace(
  row: PersistedAllocationResultRow,
  teacherId: string,
  trace: DecisionTrace & { score: number; selectedBecause: string },
): DecisionTrace & { score: number; selectedBecause: string } {
  if (!rowWasOverridden(row)) return { ...trace, teacherId };
  const kept = trace.reasons.filter((r) => !isGeneratedInfoRuleCode(r.ruleCode));
  const hasOverride = kept.some((r) => r.ruleCode === "MANUAL_OVERRIDE");
  const reasons = hasOverride
    ? kept
    : [
        ...kept,
        {
          ruleCode: "MANUAL_OVERRIDE",
          severity: "WARNING" as const,
          message: "Manual override recorded",
        },
      ];
  const selectedBecause =
    hasOverride && /manual override/i.test(trace.selectedBecause)
      ? trace.selectedBecause
      : "manual override";
  return {
    ...trace,
    teacherId,
    selectedBecause,
    reasons,
  };
}

function theoryTraceFromRow(
  row: PersistedAllocationResultRow,
  teacherId: string,
): DecisionTrace & { score: number; selectedBecause: string } {
  const fallback: DecisionTrace & { score: number; selectedBecause: string } = {
    teacherId,
    targetId: row.centre_id,
    eligibility: "PASS",
    reasons: [],
    score: row.score,
    selectedBecause: "Hydrated from persisted allocation run",
  };
  const parsed = parseTrace(row.decision_trace_json);
  if (!isRecord(parsed) || !("teacherId" in parsed)) {
    return overlayOverrideOnTheoryTrace(row, teacherId, fallback);
  }
  const reasons: DecisionReason[] = Array.isArray(parsed.reasons)
    ? parsed.reasons.flatMap((r) => {
        if (!r || typeof r !== "object") return [];
        const rec = r as Record<string, unknown>;
        if (typeof rec.ruleCode !== "string" || typeof rec.message !== "string") {
          return [];
        }
        return [
          {
            ruleCode: rec.ruleCode,
            severity: asSeverity(rec.severity),
            message: rec.message,
            details:
              rec.details && typeof rec.details === "object"
                ? (rec.details as Record<string, unknown>)
                : undefined,
          },
        ];
      })
    : [];
  return overlayOverrideOnTheoryTrace(row, teacherId, {
    teacherId,
    targetId:
      typeof parsed.targetId === "string" ? parsed.targetId : row.centre_id,
    eligibility: parsed.eligibility === "FAIL" ? "FAIL" : "PASS",
    reasons,
    score: typeof parsed.score === "number" ? parsed.score : row.score,
    selectedBecause:
      typeof parsed.selectedBecause === "string"
        ? parsed.selectedBecause
        : fallback.selectedBecause,
  });
}

/**
 * Reconstruct the Theory assignment table from persisted run results.
 * Does not re-run the allocator or invent fallback flags from row order.
 */
export function theoryAssignmentsFromPersistedResults(
  rows: PersistedAllocationResultRow[],
  codesByTeacherId: ReadonlyMap<string, string> = new Map(),
): HydratedTheoryAssignment[] {
  return rows.map((row) => {
    const teacherId = row.final_teacher_id || row.teacher_id;
    const session: SessionCode =
      row.session_code === "AFTERNOON" ? "AFTERNOON" : "MORNING";
    const parsed = parseTrace(row.decision_trace_json);
    return {
      requirementKey: requirementKeyFromPersisted(row, parsed),
      teacherId,
      employeeCode: employeeCodeFromMasters(teacherId, codesByTeacherId),
      centreId: row.centre_id,
      roleCode: row.role_code,
      examDate: row.exam_date,
      sessionCode: session,
      score: row.score,
      usedFallbackBand: usedFallbackBandFromPersisted(row),
      decisionTrace: theoryTraceFromRow(row, teacherId),
    };
  });
}
