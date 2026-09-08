import { roleSwitchAppliedFromPersisted } from "./persistedFlags.js";
import type { PersistedAllocationResultRow } from "./persistedHall.js";
import type { SessionCode } from "./types.js";

export interface PracticalDecisionTraceIdentity {
  batchKey: string;
  schoolId: string;
  subjectId: string;
  externalExaminerId: string;
  decisionNotes: string[];
  roleSwitchApplied: boolean;
  batchIndex?: number;
  studentCount?: number;
}

export interface HydratedPracticalSchedule {
  batchKey: string;
  schoolId: string;
  subjectId: string;
  examDate: string;
  sessionCode: SessionCode;
  internalExaminerId: string;
  externalExaminerId: string;
  roleSwitchApplied: boolean;
  decisionNotes: string[];
}

export interface HydratedPracticalBatch {
  batchKey: string;
  schoolId: string;
  subjectId: string;
  batchIndex: number;
  studentCount: number;
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

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Leftover UNK is not a persisted identity field — treat it as missing. */
function asPersistedIdentityString(value: unknown): string | undefined {
  const trimmed = asNonEmptyString(value);
  return trimmed && trimmed !== "UNK" ? trimmed : undefined;
}

function asNonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function notesFromParsed(parsed: unknown): string[] {
  if (Array.isArray(parsed)) {
    return parsed.filter((n): n is string => typeof n === "string");
  }
  if (isRecord(parsed) && Array.isArray(parsed.decisionNotes)) {
    return parsed.decisionNotes.filter((n): n is string => typeof n === "string");
  }
  return [];
}

/**
 * Persist already writes practical results without school/subject/batch
 * columns. Fold identity into decision_trace_json so hydrate can read it
 * after restore/reload when practical_batches is missing (same pattern as
 * hall `{ slotIndex }`).
 */
export function practicalDecisionTraceFromSchedule(
  input: PracticalDecisionTraceIdentity,
): PracticalDecisionTraceIdentity {
  return {
    batchKey: input.batchKey,
    schoolId: input.schoolId,
    subjectId: input.subjectId,
    externalExaminerId: input.externalExaminerId,
    decisionNotes: input.decisionNotes,
    roleSwitchApplied: input.roleSwitchApplied,
    ...(input.batchIndex !== undefined ? { batchIndex: input.batchIndex } : {}),
    ...(input.studentCount !== undefined
      ? { studentCount: input.studentCount }
      : {}),
  };
}

/**
 * Fields already stored on the practical result trace. Empty string means
 * the field was not persisted — do not invent UNK or batch-date labels.
 */
export function practicalIdentityFromDecisionTrace(
  decisionTraceJson: string | null | undefined,
): {
  batchKey: string;
  schoolId: string;
  subjectId: string;
  externalExaminerId: string;
  decisionNotes: string[];
  batchIndex?: number;
  studentCount?: number;
} {
  const parsed = parseTrace(decisionTraceJson);
  const notes = notesFromParsed(parsed);
  if (!isRecord(parsed)) {
    return {
      batchKey: "",
      schoolId: "",
      subjectId: "",
      externalExaminerId: "",
      decisionNotes: notes,
    };
  }
  return {
    batchKey: asPersistedIdentityString(parsed.batchKey) ?? "",
    schoolId: asPersistedIdentityString(parsed.schoolId) ?? "",
    subjectId: asPersistedIdentityString(parsed.subjectId) ?? "",
    externalExaminerId: asPersistedIdentityString(parsed.externalExaminerId) ?? "",
    decisionNotes: notes,
    batchIndex: asNonNegativeInt(parsed.batchIndex),
    studentCount: asNonNegativeInt(parsed.studentCount),
  };
}

/**
 * Leftover practical_batches may carry UNK after an old/missing trace.
 * Prefer the persisted identity when the leftover batch invented UNK.
 */
export function practicalSubjectFromBatchOrTrace(
  batch: { subject_code?: string | null; subject_id?: string | null } | undefined,
  identitySubjectId: string,
): string {
  const fromBatch =
    asNonEmptyString(batch?.subject_code) ?? asNonEmptyString(batch?.subject_id);
  if (fromBatch && fromBatch !== "UNK") return fromBatch;
  return identitySubjectId === "UNK" ? "" : identitySubjectId;
}

/** External pair row is publish/history identity, not a second schedule. */
export function isPracticalExternalResultRow(row: {
  role_code?: string | null;
  duty_type_code?: string | null;
}): boolean {
  return (
    row.role_code === "PRACTICAL_EXTERNAL" ||
    row.duty_type_code === "PRACTICAL_EXTERNAL"
  );
}

export function findPersistedResultForPracticalSchedule(
  rows: PersistedAllocationResultRow[],
  schedule: {
    batchId?: string;
    examDate: string;
    internalExaminerId: string;
  },
): PersistedAllocationResultRow | undefined {
  const internals = rows.filter((r) => !isPracticalExternalResultRow(r));
  const batchId = schedule.batchId?.trim();
  if (batchId) {
    const byKey = internals.find(
      (r) =>
        practicalIdentityFromDecisionTrace(r.decision_trace_json).batchKey ===
        batchId,
    );
    if (byKey) return byKey;
  }
  return internals.find((r) => {
    const teacherId = r.final_teacher_id || r.teacher_id;
    return (
      r.exam_date === schedule.examDate &&
      teacherId === schedule.internalExaminerId
    );
  });
}

/**
 * Reconstruct practical schedules from persisted run results when
 * practical_batches / practical_schedules are missing. Does not invent UNK
 * subjects, centre-date batch keys, or a duplicate external examiner.
 */
export function practicalSchedulesFromPersistedResults(
  rows: PersistedAllocationResultRow[],
): HydratedPracticalSchedule[] {
  return rows.filter((row) => !isPracticalExternalResultRow(row)).map((row) => {
    const identity = practicalIdentityFromDecisionTrace(row.decision_trace_json);
    const session: SessionCode =
      row.session_code === "AFTERNOON" ? "AFTERNOON" : "MORNING";
    return {
      batchKey: identity.batchKey,
      schoolId: identity.schoolId || row.centre_id,
      subjectId: identity.subjectId,
      examDate: row.exam_date,
      sessionCode: session,
      internalExaminerId: row.final_teacher_id || row.teacher_id,
      externalExaminerId: identity.externalExaminerId,
      roleSwitchApplied: roleSwitchAppliedFromPersisted(row),
      decisionNotes: identity.decisionNotes,
    };
  });
}

/**
 * Reconstruct batch identity already stored on result traces.
 * Skips rows that lack persisted studentCount — do not invent demand.
 */
export function practicalBatchesFromPersistedResults(
  rows: PersistedAllocationResultRow[],
): HydratedPracticalBatch[] {
  const seen = new Set<string>();
  const out: HydratedPracticalBatch[] = [];
  for (const row of rows) {
    const identity = practicalIdentityFromDecisionTrace(row.decision_trace_json);
    const schoolId = identity.schoolId || row.centre_id;
    if (
      !identity.batchKey ||
      !schoolId ||
      !identity.subjectId ||
      identity.batchIndex === undefined ||
      identity.studentCount === undefined
    ) {
      continue;
    }
    if (seen.has(identity.batchKey)) continue;
    seen.add(identity.batchKey);
    out.push({
      batchKey: identity.batchKey,
      schoolId,
      subjectId: identity.subjectId,
      batchIndex: identity.batchIndex,
      studentCount: identity.studentCount,
    });
  }
  return out;
}
