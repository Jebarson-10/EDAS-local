import type { SessionCode } from "./types.js";

/** Row shape from GET /api/allocation-runs/:id/reasons (D1/SQLite join). */
export interface PersistedDecisionReasonRow {
  rule_code: string;
  severity: string;
  message: string;
  teacher_id?: string | null;
  exam_date?: string | null;
  session_code?: string | null;
  details_json?: string | null;
  /** Generated pick — list JOIN also sends COALESCE as teacher_id. */
  generated_teacher_id?: string | null;
}

/**
 * Reconstruct conflict-engine findings already stored on a run.
 * Only surfaces rows whose rule_code starts with RULE-CONFLICT- — does not
 * invent new conflict rules or re-run the engine.
 */
export function conflictsFromPersistedReasons(
  reasons: PersistedDecisionReasonRow[],
): Array<{
  ruleCode: string;
  severity: "ERROR" | "WARNING";
  message: string;
  teacherId: string;
  date: string;
  session: SessionCode;
  duties: string[];
}> {
  const out: Array<{
    ruleCode: string;
    severity: "ERROR" | "WARNING";
    message: string;
    teacherId: string;
    date: string;
    session: SessionCode;
    duties: string[];
  }> = [];
  for (const r of reasons) {
    if (!r.rule_code.startsWith("RULE-CONFLICT-")) continue;
    const severity =
      r.severity === "ERROR" || r.severity === "WARNING" ? r.severity : null;
    if (!severity) continue;

    let details: Record<string, unknown> = {};
    if (r.details_json) {
      try {
        const parsed = JSON.parse(r.details_json) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          details = parsed as Record<string, unknown>;
        }
      } catch {
        // keep empty details
      }
    }

    const teacherId = stringOrEmpty(details.teacherId) || r.teacher_id || "";
    const date = stringOrEmpty(details.examDate) || r.exam_date || "";
    const sessionRaw =
      stringOrEmpty(details.sessionCode) || r.session_code || "";
    const session: SessionCode | null =
      sessionRaw === "MORNING" || sessionRaw === "AFTERNOON"
        ? sessionRaw
        : null;
    if (!teacherId || !date || !session) continue;

    const duties = Array.isArray(details.duties)
      ? details.duties.filter((d): d is string => typeof d === "string")
      : [];

    out.push({
      ruleCode: r.rule_code,
      severity,
      message: r.message,
      teacherId,
      date,
      session,
      duties,
    });
  }
  return out;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function detailsFromReason(
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

function isValidatorFindingWithoutTeacher(
  row: PersistedDecisionReasonRow,
  details: Record<string, unknown>,
  teacherFromDetails: string,
): boolean {
  if (teacherFromDetails) return false;
  const source = stringOrEmpty(details.source);
  return (
    source === "validator" ||
    row.rule_code === "RULE-SHORTAGE" ||
    row.rule_code === "RULE-HALL-SHORTAGE"
  );
}

/**
 * Prefer generate-mapped identity in details over the JOIN result.
 * Findings without a teacher (shortages, centre-only validator rows) must
 * not inherit an assignment slot's Teacher/When — including hall shortages
 * that only carry centreId and were JOINed to a filled slot at that centre.
 * After override, COALESCE(final, generated) is the replacement — generate
 * RULE / WARN / ERROR rows without details.teacherId must keep the generated actor.
 */
export function applyPersistedReasonIdentity<
  T extends PersistedDecisionReasonRow,
>(row: T): T {
  const details = detailsFromReason(row.details_json);
  const teacherFromDetails = stringOrEmpty(details.teacherId);
  const dateFromDetails = stringOrEmpty(details.examDate);
  const sessionFromDetails = stringOrEmpty(details.sessionCode);
  const unmatched =
    details.unmatched === true ||
    isValidatorFindingWithoutTeacher(row, details, teacherFromDetails);
  const generated = stringOrEmpty(row.generated_teacher_id);
  const inheritedJoin =
    row.rule_code === "MANUAL_OVERRIDE"
      ? stringOrEmpty(row.teacher_id)
      : generated || stringOrEmpty(row.teacher_id);
  return {
    ...row,
    teacher_id: teacherFromDetails || (unmatched ? "" : inheritedJoin) || "",
    exam_date: dateFromDetails || (unmatched ? "" : row.exam_date) || "",
    session_code:
      sessionFromDetails || (unmatched ? "" : row.session_code) || "",
  };
}
