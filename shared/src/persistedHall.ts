import type { SessionCode } from "./types.js";

/** Row shape from GET /api/allocation-runs/:id/results (D1/SQLite). */
export interface PersistedAllocationResultRow {
  teacher_id: string;
  final_teacher_id?: string | null;
  is_override?: number | boolean | null;
  centre_id: string;
  duty_type_code?: string | null;
  role_code: string;
  exam_date: string;
  session_code: string;
  score: number;
  decision_trace_json?: string | null;
}

export interface HydratedHallAssignment {
  centreId: string;
  examDate: string;
  sessionCode: SessionCode;
  roleCode: "HALL_INVIGILATOR" | "HALL_STANDBY";
  slotIndex: number;
  teacherId: string;
  employeeCode: string;
  score: number;
}

/**
 * Hall persist writes `{ slotIndex }` into decision_trace_json. Boot hydrate
 * must read that back — using the result-array index invents a global slot
 * that the Hall page and hall CSV then display after restore/reload.
 */
export function slotIndexFromDecisionTrace(
  decisionTraceJson: string | null | undefined,
  fallbackIndex: number,
): number {
  if (decisionTraceJson) {
    try {
      const parsed = JSON.parse(decisionTraceJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const slot = (parsed as { slotIndex?: unknown }).slotIndex;
        if (typeof slot === "number" && Number.isFinite(slot) && slot >= 0) {
          return Math.floor(slot);
        }
      }
    } catch {
      // keep fallback
    }
  }
  return fallbackIndex;
}

/** Map persisted teacher_id onto the master employee code when the list is available. */
export function employeeCodeFromMasters(
  teacherId: string,
  codesByTeacherId: ReadonlyMap<string, string>,
): string {
  return codesByTeacherId.get(teacherId) || teacherId;
}

export function hallRoleFromPersisted(
  roleCode: string,
): "HALL_INVIGILATOR" | "HALL_STANDBY" {
  return roleCode === "HALL_STANDBY" ? "HALL_STANDBY" : "HALL_INVIGILATOR";
}

/**
 * Reconstruct the Hall assignment table from persisted run results.
 * Does not re-run the allocator or invent halls/standby counts.
 */
export function hallAssignmentsFromPersistedResults(
  rows: PersistedAllocationResultRow[],
  codesByTeacherId: ReadonlyMap<string, string> = new Map(),
): HydratedHallAssignment[] {
  return rows.map((row, idx) => {
    const teacherId = row.final_teacher_id || row.teacher_id;
    const session: SessionCode =
      row.session_code === "AFTERNOON" ? "AFTERNOON" : "MORNING";
    return {
      centreId: row.centre_id,
      examDate: row.exam_date,
      sessionCode: session,
      roleCode: hallRoleFromPersisted(row.role_code),
      slotIndex: slotIndexFromDecisionTrace(row.decision_trace_json, idx),
      teacherId,
      employeeCode: employeeCodeFromMasters(teacherId, codesByTeacherId),
      score: row.score,
    };
  });
}
