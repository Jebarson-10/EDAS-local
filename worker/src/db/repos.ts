import { runAtomic, type DbClient, type DbStatement } from "./client.js";
import {
  applyPersistedReasonIdentity,
  assertMutable,
  canTransition,
  isOverriddenGeneratedSelectionReason,
  mergeFallbackIntoDecisionTrace,
  mergeOverrideIntoDecisionTrace,
  normalizeSubject,
  foldUnstoredFindingsIntoSummaryJson,
  isLoadableBackupPayload,
  mergeAllocationRunsWithLatestPerModule,
  mergeValidationFindings,
  normalizeValidationFinding,
  sha256Hex,
  type ExamCycleStatus,
} from "@exam-duty/shared";

export async function insertAudit(
  db: DbClient,
  entry: {
    auditId: string;
    userId: string;
    action: string;
    entity?: string;
    entityId?: string;
    oldValue?: string | null;
    newValue?: string | null;
    reason?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs
        (audit_id, user_id, action, entity, entity_id, timestamp, old_value, new_value, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.auditId,
      entry.userId,
      entry.action,
      entry.entity ?? null,
      entry.entityId ?? null,
      new Date().toISOString(),
      entry.oldValue ?? null,
      entry.newValue ?? null,
      entry.reason ?? null,
    )
    .run();
}

export async function listExamCycles(db: DbClient) {
  const rs = await db
    .prepare(
      `SELECT exam_cycle_id, name, academic_year, standard, start_date, end_date, status, rule_version_id, created_at, created_by, amended_from_id, amendment_reason
       FROM exam_cycles ORDER BY created_at DESC`,
    )
    .all();
  return rs.results;
}

export async function upsertExamCycle(
  db: DbClient,
  cycle: {
    examCycleId: string;
    name: string;
    academicYear: string;
    status: string;
    ruleVersionId: string;
    createdBy: string;
    startDate?: string | null;
    endDate?: string | null;
    amendedFromId?: string | null;
    amendmentReason?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO exam_cycles
        (exam_cycle_id, name, academic_year, status, rule_version_id, created_at, created_by, start_date, end_date, amended_from_id, amendment_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(exam_cycle_id) DO UPDATE SET
         name=excluded.name,
         status=excluded.status,
         rule_version_id=excluded.rule_version_id,
         start_date=COALESCE(excluded.start_date, exam_cycles.start_date),
         end_date=COALESCE(excluded.end_date, exam_cycles.end_date),
         amended_from_id=COALESCE(excluded.amended_from_id, exam_cycles.amended_from_id),
         amendment_reason=COALESCE(excluded.amendment_reason, exam_cycles.amendment_reason)`,
    )
    .bind(
      cycle.examCycleId,
      cycle.name,
      cycle.academicYear,
      cycle.status,
      cycle.ruleVersionId,
      new Date().toISOString(),
      cycle.createdBy,
      cycle.startDate ?? null,
      cycle.endDate ?? null,
      cycle.amendedFromId ?? null,
      cycle.amendmentReason ?? null,
    )
    .run();
}

export type BootstrapExamCycle = {
  examCycleId: string;
  name: string;
  academicYear: string;
  status: string;
  ruleVersionId: string;
  createdBy: string;
  startDate?: string | null;
  endDate?: string | null;
  amendedFromId?: string | null;
  amendmentReason?: string | null;
};

/**
 * Local-API / first-boot helper: insert the synthetic cycle only when missing.
 * Never UPDATE an existing row — a restart must not reset PUBLISHED (or any
 * officer-written name / rule_version_id / window) back to seed defaults.
 */
export async function ensureExamCycleIfMissing(
  db: DbClient,
  cycle: BootstrapExamCycle,
): Promise<{ created: boolean }> {
  const existing = await getExamCycleStatus(db, cycle.examCycleId);
  if (existing) return { created: false };
  await upsertExamCycle(db, cycle);
  return { created: true };
}

/**
 * Set (or clear) the examination window an officer configured for a cycle.
 * Only the window: how days inside it map to subjects/sessions is unspecified
 * (see OQ-020), so nothing is derived here.
 */
export async function setExamCycleWindow(
  db: DbClient,
  examCycleId: string,
  window: { startDate: string | null; endDate: string | null },
): Promise<{ ok: true } | { ok: false; error: string; conflict?: true }> {
  const { startDate, endDate } = window;
  if (startDate && endDate && endDate < startDate) {
    return { ok: false, error: "End date must not precede the start date" };
  }
  const mutable = await assertExamCycleMutable(
    db,
    examCycleId,
    "set exam window",
  );
  if (!mutable.ok) return mutable;
  await db
    .prepare(
      `UPDATE exam_cycles SET start_date = ?, end_date = ? WHERE exam_cycle_id = ?`,
    )
    .bind(startDate, endDate, examCycleId)
    .run();
  return { ok: true };
}

/**
 * Update exam cycle status.
 * When enforceTransition is true (officer UI), validates against workflow graph.
 * System paths (publish / allocation persist) may set force=true to skip the graph.
 */
export async function updateExamCycleStatus(
  db: DbClient,
  examCycleId: string,
  status: string,
  opts?: { force?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db
    .prepare(`SELECT status FROM exam_cycles WHERE exam_cycle_id = ?`)
    .bind(examCycleId)
    .first<{ status: string }>();
  if (!row) {
    return { ok: false, error: `Exam cycle ${examCycleId} not found` };
  }
  if (!opts?.force) {
    if (
      !canTransition(row.status as ExamCycleStatus, status as ExamCycleStatus)
    ) {
      return {
        ok: false,
        error: `Illegal transition ${row.status} → ${status}`,
      };
    }
  }
  await db
    .prepare(`UPDATE exam_cycles SET status = ? WHERE exam_cycle_id = ?`)
    .bind(status, examCycleId)
    .run();
  return { ok: true };
}

/** Load exam cycle status or null if missing. */
export async function getExamCycleStatus(
  db: DbClient,
  examCycleId: string,
): Promise<ExamCycleStatus | null> {
  const row = await db
    .prepare(`SELECT status FROM exam_cycles WHERE exam_cycle_id = ?`)
    .bind(examCycleId)
    .first<{ status: string }>();
  return (row?.status as ExamCycleStatus) ?? null;
}

/**
 * Server-side immutability gate for published / locked / archived cycles.
 * Call before generate, override, import apply, clubbing, capacity, practical batches.
 */
export async function assertExamCycleMutable(
  db: DbClient,
  examCycleId: string,
  action: string,
): Promise<{ ok: true } | { ok: false; error: string; conflict?: true }> {
  const status = await getExamCycleStatus(db, examCycleId);
  if (!status) {
    return { ok: false, error: `Exam cycle ${examCycleId} not found` };
  }
  return assertMutable(status, action);
}

export type PersistDecisionReason = {
  ruleCode: string;
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
  details?: unknown;
  teacherId?: string;
  centreId?: string;
  examDate?: string;
  sessionCode?: string;
  /** Generate aliases — persist maps these onto examDate / details.duty. */
  date?: string;
  session?: string;
  duty?: string;
};

function extractTraceReasons(
  decisionTraceJson: string,
): PersistDecisionReason[] {
  try {
    const trace = JSON.parse(decisionTraceJson) as {
      reasons?: Array<{
        ruleCode?: string;
        severity?: string;
        message?: string;
        details?: unknown;
      }>;
    };
    if (!Array.isArray(trace.reasons)) return [];
    const out: PersistDecisionReason[] = [];
    for (const r of trace.reasons) {
      if (!r?.ruleCode || !r?.message) continue;
      const sev = String(r.severity ?? "INFO").toUpperCase();
      const severity =
        sev === "ERROR" || sev === "WARNING" || sev === "INFO"
          ? (sev as PersistDecisionReason["severity"])
          : "INFO";
      out.push({
        ruleCode: String(r.ruleCode),
        severity,
        message: String(r.message),
        details: r.details,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function insertDecisionReason(
  db: DbClient,
  resultId: string,
  reason: PersistDecisionReason,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO allocation_decision_reasons
        (id, result_id, rule_code, severity, message, details_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      resultId,
      reason.ruleCode,
      reason.severity,
      reason.message,
      reason.details != null ? JSON.stringify(reason.details) : null,
    )
    .run();
}

function matchResultIds(
  results: Array<{
    resultId: string;
    teacherId: string;
    centreId: string;
    examDate: string;
    sessionCode: string;
  }>,
  find: {
    teacherId?: string;
    centreId?: string;
    examDate?: string;
    sessionCode?: string;
  },
): string[] {
  // Centre-only findings (hall shortages) are not assignment identity —
  // matching them attaches the shortage to filled slots at that centre.
  if (!find.teacherId) return [];
  return results
    .filter((r) => {
      if (r.teacherId !== find.teacherId) return false;
      if (find.centreId && r.centreId !== find.centreId) return false;
      if (find.examDate && r.examDate !== find.examDate) return false;
      if (find.sessionCode && r.sessionCode !== find.sessionCode) return false;
      return true;
    })
    .map((r) => r.resultId);
}

export async function persistAllocationRun(
  db: DbClient,
  input: {
    runId: string;
    examCycleId: string;
    ruleVersionId: string;
    algorithmVersion: string;
    module: string;
    validationStatus: string;
    createdBy: string;
    summaryJson: string;
    snapshotJson?: string;
    results: Array<{
      resultId: string;
      teacherId: string;
      centreId: string;
      dutyTypeCode: string;
      roleCode: string;
      examDate: string;
      sessionCode: string;
      score: number;
      decisionTraceJson: string;
      usedFallback: boolean;
    }>;
    /** Validator issues + conflict findings attached to matching results */
    validationFindings?: PersistDecisionReason[];
  },
): Promise<{ reasonCount: number }> {
  const validationFindings = mergeValidationFindings(
    (input.validationFindings ?? []).map((raw) =>
      normalizeValidationFinding({
        ruleCode: raw.ruleCode,
        severity: raw.severity,
        message: raw.message,
        details: raw.details,
        teacherId: raw.teacherId,
        centreId: raw.centreId,
        examDate: raw.examDate,
        sessionCode: raw.sessionCode,
        date: raw.date,
        session: raw.session,
        duty: raw.duty,
      }),
    ),
  );
  const unstoredFindings = validationFindings.filter((finding) => {
    const ids = matchResultIds(input.results, finding);
    return ids.length === 0 && input.results.length === 0;
  });
  const summaryJson = foldUnstoredFindingsIntoSummaryJson(
    input.summaryJson,
    unstoredFindings,
  );

  let snapshotId: string | null = null;
  if (input.snapshotJson) {
    const { sha256Hex } = await import("@exam-duty/shared");
    snapshotId = crypto.randomUUID();
    const payloadHash = await sha256Hex(input.snapshotJson);
    await db
      .prepare(
        `INSERT INTO input_snapshots (snapshot_id, payload_hash, inline_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(
        snapshotId,
        payloadHash,
        input.snapshotJson,
        new Date().toISOString(),
      )
      .run();
  }
  await db
    .prepare(
      `INSERT INTO allocation_runs
        (run_id, exam_cycle_id, rule_version_id, algorithm_version, module, input_snapshot_id, created_by, created_at, status, validation_status, summary_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GENERATED', ?, ?)`,
    )
    .bind(
      input.runId,
      input.examCycleId,
      input.ruleVersionId,
      input.algorithmVersion,
      input.module,
      snapshotId,
      input.createdBy,
      new Date().toISOString(),
      input.validationStatus,
      summaryJson,
    )
    .run();

  let reasonCount = 0;
  for (const r of input.results) {
    await db
      .prepare(
        `INSERT INTO allocation_run_results
          (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override, final_teacher_id, generated_teacher_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      )
      .bind(
        r.resultId,
        input.runId,
        r.teacherId,
        r.centreId,
        r.dutyTypeCode,
        r.roleCode,
        r.examDate,
        r.sessionCode,
        r.score,
        mergeFallbackIntoDecisionTrace(r.decisionTraceJson, r.usedFallback),
        r.teacherId,
        r.teacherId,
      )
      .run();

    for (const reason of extractTraceReasons(r.decisionTraceJson)) {
      await insertDecisionReason(db, r.resultId, reason);
      reasonCount += 1;
    }
  }

  for (const finding of validationFindings) {
    const ids = matchResultIds(input.results, finding);
    const unmatched = ids.length === 0;
    const targets =
      ids.length > 0
        ? ids
        : input.results.length > 0
          ? [input.results[0]!.resultId]
          : [];
    for (const resultId of targets) {
      const details =
        typeof finding.details === "object" && finding.details
          ? { ...(finding.details as Record<string, unknown>) }
          : {};
      await insertDecisionReason(db, resultId, {
        ...finding,
        details: {
          ...details,
          teacherId: finding.teacherId,
          centreId: finding.centreId,
          examDate: finding.examDate,
          sessionCode: finding.sessionCode,
          source:
            typeof details.source === "string" ? details.source : "validator",
          unmatched,
        },
      });
      reasonCount += 1;
    }
  }

  return { reasonCount };
}

export type PublishRunResult =
  | { ok: true; published: number; alreadyPublished?: boolean }
  | { ok: false; error: string };

/**
 * Publish run results into immutable duty history.
 * Uses COALESCE(final_teacher_id, teacher_id) so audited overrides are preserved.
 * Idempotent: a second publish of the same run returns published=0.
 * Refuses INVALID validation_status; requires examCycleId to match the run.
 * Inserts + status update run in one atomic batch.
 * When an input snapshot exists, re-verifies SHA-256 before publish.
 */
export async function publishRunToHistory(
  db: DbClient,
  runId: string,
  examCycleId: string,
  academicYear: string,
): Promise<PublishRunResult> {
  const run = await db
    .prepare(
      `SELECT run_id, exam_cycle_id, status, validation_status, input_snapshot_id, module
       FROM allocation_runs WHERE run_id = ?`,
    )
    .bind(runId)
    .first<{
      run_id: string;
      exam_cycle_id: string;
      status: string;
      validation_status: string | null;
      input_snapshot_id: string | null;
      module: string;
    }>();
  if (!run) {
    return { ok: false, error: `Allocation run ${runId} not found` };
  }
  if (run.status === "PUBLISHED" || run.status === "LOCKED") {
    return { ok: true, published: 0, alreadyPublished: true };
  }
  if (run.validation_status === "INVALID") {
    return {
      ok: false,
      error:
        "Cannot publish INVALID allocation run — fix shortages/overrides first",
    };
  }
  if (run.exam_cycle_id !== examCycleId) {
    return {
      ok: false,
      error: `Publish examCycleId ${examCycleId} does not match run cycle ${run.exam_cycle_id}`,
    };
  }

  const existingHist = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM duty_assignment_history WHERE run_id = ?`,
    )
    .bind(runId)
    .first<{ n: number }>();
  if ((existingHist?.n ?? 0) > 0) {
    await db
      .prepare(
        `UPDATE allocation_runs SET status = 'PUBLISHED' WHERE run_id = ?`,
      )
      .bind(runId)
      .run();
    return { ok: true, published: 0, alreadyPublished: true };
  }

  if (run.input_snapshot_id) {
    const snap = await db
      .prepare(
        `SELECT payload_hash, inline_json FROM input_snapshots WHERE snapshot_id = ?`,
      )
      .bind(run.input_snapshot_id)
      .first<{ payload_hash: string; inline_json: string | null }>();
    if (snap?.inline_json) {
      const recomputed = await sha256Hex(snap.inline_json);
      if (recomputed !== snap.payload_hash) {
        return {
          ok: false,
          error: "Input snapshot hash mismatch — refuse publish (integrity)",
        };
      }
    }
  }

  const results = await db
    .prepare(
      `SELECT result_id,
              COALESCE(final_teacher_id, teacher_id) AS teacher_id,
              centre_id, duty_type_code, role_code, exam_date, session_code
       FROM allocation_run_results WHERE run_id = ?`,
    )
    .bind(runId)
    .all<{
      result_id: string;
      teacher_id: string;
      centre_id: string;
      duty_type_code: string;
      role_code: string;
      exam_date: string;
      session_code: string;
    }>();

  const fromSchedules =
    run.module === "PRACTICAL"
      ? await practicalSchedulePublishSlots(db, runId, results.results ?? [])
      : [];
  const publishSlots = [...(results.results ?? []), ...fromSchedules];

  const publishedAt = new Date().toISOString();
  const stmts: DbStatement[] = [];
  for (const r of publishSlots) {
    const assignmentId = crypto.randomUUID();
    stmts.push(
      db
        .prepare(
          `INSERT INTO duty_assignments
            (assignment_id, exam_cycle_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, academic_year, is_published, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .bind(
          assignmentId,
          examCycleId,
          runId,
          r.teacher_id,
          r.centre_id,
          r.duty_type_code,
          r.role_code,
          r.exam_date,
          r.session_code,
          academicYear,
          publishedAt,
        ),
    );
    stmts.push(
      db
        .prepare(
          `INSERT INTO duty_assignment_history
            (history_id, assignment_id, exam_cycle_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, academic_year, published_at, run_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          assignmentId,
          examCycleId,
          r.teacher_id,
          r.centre_id,
          r.duty_type_code,
          r.role_code,
          r.exam_date,
          r.session_code,
          academicYear,
          publishedAt,
          runId,
        ),
    );
  }
  stmts.push(
    db
      .prepare(
        `UPDATE allocation_runs SET status = 'PUBLISHED'
         WHERE run_id = ? AND status NOT IN ('PUBLISHED', 'LOCKED')`,
      )
      .bind(runId),
  );

  try {
    await runAtomic(db, stmts);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Publish transaction failed",
    };
  }
  return { ok: true, published: publishSlots.length };
}

/**
 * Practical persist historically stored only the internal examiner on
 * allocation_run_results. The pair's external lives on practical_schedules.
 * Publish must write both into duty history — the UI already claims both.
 */
async function practicalSchedulePublishSlots(
  db: DbClient,
  runId: string,
  existing: Array<{
    teacher_id: string;
    centre_id: string;
    duty_type_code: string;
    exam_date: string;
    session_code: string;
  }>,
): Promise<
  Array<{
    teacher_id: string;
    centre_id: string;
    duty_type_code: string;
    role_code: string;
    exam_date: string;
    session_code: string;
  }>
> {
  const rs = await db
    .prepare(
      `SELECT sch.internal_examiner_id, sch.external_examiner_id,
              sch.exam_date, sch.session_code, pb.school_id
       FROM practical_schedules sch
       INNER JOIN practical_batches pb
         ON pb.batch_id = sch.batch_id
        AND pb.exam_cycle_id = sch.exam_cycle_id
       WHERE sch.run_id = ?`,
    )
    .bind(runId)
    .all<{
      internal_examiner_id: string;
      external_examiner_id: string;
      exam_date: string;
      session_code: string;
      school_id: string;
    }>();
  const seen = new Set(
    existing.map(
      (r) =>
        `${r.teacher_id}|${r.centre_id}|${r.duty_type_code}|${r.exam_date}|${r.session_code}`,
    ),
  );
  const extra: Array<{
    teacher_id: string;
    centre_id: string;
    duty_type_code: string;
    role_code: string;
    exam_date: string;
    session_code: string;
  }> = [];
  for (const s of rs.results ?? []) {
    const slots = [
      {
        teacher_id: s.internal_examiner_id,
        centre_id: s.school_id,
        duty_type_code: "PRACTICAL_INTERNAL",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: s.exam_date,
        session_code: s.session_code,
      },
      {
        teacher_id: s.external_examiner_id,
        centre_id: s.school_id,
        duty_type_code: "PRACTICAL_EXTERNAL",
        role_code: "PRACTICAL_EXTERNAL",
        exam_date: s.exam_date,
        session_code: s.session_code,
      },
    ];
    for (const slot of slots) {
      const key = `${slot.teacher_id}|${slot.centre_id}|${slot.duty_type_code}|${slot.exam_date}|${slot.session_code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      extra.push(slot);
    }
  }
  return extra;
}

export type BackupPayload = {
  metadata?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  teachers: Array<Record<string, unknown>>;
  schools: Array<Record<string, unknown>>;
  centres: Array<Record<string, unknown>>;
  /** Preferred key for centre↔school links */
  centre_school_relationships?: Array<Record<string, unknown>>;
  /** Demo/UI alias */
  relationships?: Array<Record<string, unknown>>;
  /** Preferred key for published duty history */
  duty_history?: Array<Record<string, unknown>>;
  /** Demo/UI alias */
  history?: Array<Record<string, unknown>>;
  teacher_school_history?: Array<Record<string, unknown>>;
  teacher_designation_history?: Array<Record<string, unknown>>;
  teacher_location_history?: Array<Record<string, unknown>>;
  /** UI aliases */
  schoolHistory?: Array<Record<string, unknown>>;
  designationHistory?: Array<Record<string, unknown>>;
  locationHistory?: Array<Record<string, unknown>>;
  teacher_exemptions?: Array<Record<string, unknown>>;
  exemptions?: Array<Record<string, unknown>>;
  blocks?: Array<Record<string, unknown>>;
  exam_cycles?: Array<Record<string, unknown>>;
  rule_versions?: Array<Record<string, unknown>>;
  rule_parameters?: Array<Record<string, unknown>>;
  /** Allocation run archive (DR). Wipe leftovers only when the key is present. */
  input_snapshots?: Array<Record<string, unknown>>;
  allocation_runs?: Array<Record<string, unknown>>;
  allocation_run_results?: Array<Record<string, unknown>>;
  allocation_decision_reasons?: Array<Record<string, unknown>>;
  audit_logs?: Array<Record<string, unknown>>;
  subjects?: Array<Record<string, unknown>>;
  practical_batches?: Array<Record<string, unknown>>;
  practical_schedules?: Array<Record<string, unknown>>;
  /** Examiner pair memory that drives the next cycle's role switch */
  examiner_pairs?: Array<Record<string, unknown>>;
  manual_overrides?: Array<Record<string, unknown>>;
  duty_assignments?: Array<Record<string, unknown>>;
  /** Audit-page consumers: GET /api/imports, /imports/:id/rows, /exports */
  source_imports?: Array<Record<string, unknown>>;
  source_import_rows?: Array<Record<string, unknown>>;
  export_records?: Array<Record<string, unknown>>;
  rules?: unknown;
};

type NormalizedBackup = {
  metadata: Record<string, unknown>;
  teachers: Array<Record<string, unknown>>;
  schools: Array<Record<string, unknown>>;
  centres: Array<Record<string, unknown>>;
  centre_school_relationships: Array<Record<string, unknown>>;
  duty_history: Array<Record<string, unknown>>;
  teacher_school_history: Array<Record<string, unknown>>;
  teacher_designation_history: Array<Record<string, unknown>>;
  teacher_location_history: Array<Record<string, unknown>>;
  teacher_exemptions: Array<Record<string, unknown>>;
  blocks: Array<Record<string, unknown>>;
  exam_cycles: Array<Record<string, unknown>>;
  rule_versions: Array<Record<string, unknown>>;
  rule_parameters: Array<Record<string, unknown>>;
  input_snapshots: Array<Record<string, unknown>>;
  allocation_runs: Array<Record<string, unknown>>;
  allocation_run_results: Array<Record<string, unknown>>;
  allocation_decision_reasons: Array<Record<string, unknown>>;
  audit_logs: Array<Record<string, unknown>>;
  subjects: Array<Record<string, unknown>>;
  practical_batches: Array<Record<string, unknown>>;
  practical_schedules: Array<Record<string, unknown>>;
  examiner_pairs: Array<Record<string, unknown>>;
  manual_overrides: Array<Record<string, unknown>>;
  duty_assignments: Array<Record<string, unknown>>;
  source_imports: Array<Record<string, unknown>>;
  source_import_rows: Array<Record<string, unknown>>;
  export_records: Array<Record<string, unknown>>;
};

function idOf(
  row: Record<string, unknown>,
  camel: string,
  snake: string,
): string {
  return String(row[camel] ?? row[snake] ?? "");
}

export function normalizeBackupPayload(
  payload: BackupPayload,
): NormalizedBackup {
  return {
    metadata: (payload.metadata ?? payload.meta ?? {}) as Record<
      string,
      unknown
    >,
    teachers: payload.teachers ?? [],
    schools: payload.schools ?? [],
    centres: payload.centres ?? [],
    centre_school_relationships:
      payload.centre_school_relationships ?? payload.relationships ?? [],
    duty_history: payload.duty_history ?? payload.history ?? [],
    teacher_school_history:
      payload.teacher_school_history ?? payload.schoolHistory ?? [],
    teacher_designation_history:
      payload.teacher_designation_history ?? payload.designationHistory ?? [],
    teacher_location_history:
      payload.teacher_location_history ?? payload.locationHistory ?? [],
    teacher_exemptions: payload.teacher_exemptions ?? payload.exemptions ?? [],
    blocks: payload.blocks ?? [],
    exam_cycles: payload.exam_cycles ?? [],
    rule_versions: payload.rule_versions ?? [],
    rule_parameters: payload.rule_parameters ?? [],
    input_snapshots: payload.input_snapshots ?? [],
    allocation_runs: payload.allocation_runs ?? [],
    allocation_run_results: payload.allocation_run_results ?? [],
    allocation_decision_reasons: payload.allocation_decision_reasons ?? [],
    audit_logs: payload.audit_logs ?? [],
    subjects: payload.subjects ?? [],
    practical_batches: payload.practical_batches ?? [],
    practical_schedules: payload.practical_schedules ?? [],
    examiner_pairs: payload.examiner_pairs ?? [],
    manual_overrides: payload.manual_overrides ?? [],
    duty_assignments: payload.duty_assignments ?? [],
    source_imports: payload.source_imports ?? [],
    source_import_rows: payload.source_import_rows ?? [],
    export_records: payload.export_records ?? [],
  };
}

/** True when the snapshot claimed this collection (including an empty array). */
function backupHasCollection(
  payload: BackupPayload,
  key: keyof BackupPayload,
): boolean {
  return Array.isArray(payload[key]);
}

/** Persisted D1 audit rows carry audit_id. The Backup page used to put the
 * in-session trail (`id` / `detail`, no audit_id) under the same key — that
 * is a different collection. Treating it as replaceable would wipe GET
 * `/api/audit` (same leftover-wipe class, wrong payload). */
function auditLogLooksPersisted(row: Record<string, unknown>): boolean {
  const id = row.audit_id ?? row.auditId;
  return typeof id === "string" && id.length > 0;
}

function backupHasReplaceableAuditLogs(payload: BackupPayload): boolean {
  if (!Array.isArray(payload.audit_logs)) return false;
  if (payload.audit_logs.length === 0) return true;
  return payload.audit_logs.some((row) =>
    auditLogLooksPersisted(row as Record<string, unknown>),
  );
}

/** Schema/ref validation for DR preflight (API + offline verify script). */
export function validateBackupPayload(
  payload: BackupPayload,
): { ok: true } | { ok: false; error: string } {
  if (!isLoadableBackupPayload(payload)) {
    return {
      ok: false,
      error: "Backup schema invalid: missing core collections",
    };
  }
  const data = normalizeBackupPayload(payload);
  const refError = validateBackupRefs(data);
  if (refError) return { ok: false, error: refError };
  return { ok: true };
}

function validateBackupRefs(data: NormalizedBackup): string | null {
  const schoolIds = new Set(
    data.schools.map((s) => idOf(s, "schoolId", "school_id")),
  );
  const centreIds = new Set(
    data.centres.map((c) => idOf(c, "centreId", "centre_id")),
  );
  for (const t of data.teachers) {
    const sid = idOf(t, "schoolId", "school_id");
    if (!sid || !schoolIds.has(sid)) {
      return `Teacher ${idOf(t, "teacherId", "teacher_id")} references missing school ${sid}`;
    }
  }
  for (const r of data.centre_school_relationships) {
    const sid = idOf(r, "schoolId", "school_id");
    const cid = idOf(r, "centreId", "centre_id");
    if (!schoolIds.has(sid)) {
      return `Relationship references missing school ${sid}`;
    }
    if (!centreIds.has(cid)) {
      return `Relationship references missing centre ${cid}`;
    }
  }
  if (data.duty_history.length) {
    const teacherIds = new Set(
      data.teachers.map((t) => idOf(t, "teacherId", "teacher_id")),
    );
    for (const h of data.duty_history) {
      const tid = idOf(h, "teacherId", "teacher_id");
      if (tid && !teacherIds.has(tid)) {
        return `History row references missing teacher ${tid}`;
      }
      const cid = idOf(h, "centreId", "centre_id");
      if (cid && !centreIds.has(cid)) {
        return `History row references missing centre ${cid}`;
      }
    }
  }
  return null;
}

/**
 * Transactional restore: validate → wipe mutable master (not published history unless
 * includeHistory) → insert. Atomic via DbClient.batch (D1) or SQLite BEGIN/COMMIT.
 *
 * - includeHistory=false (default): preserves duty_assignment_history; upserts masters
 *   so existing history teacher ids remain present when re-imported.
 *   teacher_exemptions, teacher_*_history, allocation runs/results/reasons,
 *   input_snapshots, practical batches/schedules, examiner_pairs, manual_overrides,
 *   duty_assignments, and centre_school_relationships wipe only when those
 *   snapshot keys are present (empty array is a point-in-time replace).
 * - includeHistory=true: deletes and reloads history from the backup (disaster recovery).
 *   Also clears exemption/teacher-history children and other teacher/school/centre
 *   dependents so those parent deletes stay FK-safe.
 */
export async function transactionalRestore(
  db: DbClient,
  payload: BackupPayload,
  opts: { adminConfirmed: boolean; includeHistory?: boolean },
): Promise<
  { ok: true; counts: Record<string, number> } | { ok: false; error: string }
> {
  if (!opts.adminConfirmed) {
    return { ok: false, error: "Admin confirmation required" };
  }
  if (!isLoadableBackupPayload(payload)) {
    return {
      ok: false,
      error: "Backup schema invalid: missing core collections",
    };
  }

  const data = normalizeBackupPayload(payload);
  const refError = validateBackupRefs(data);
  if (refError) {
    return { ok: false, error: refError };
  }

  // Old backups omit these keys — leave live provenance. New canonical
  // snapshots always include the arrays (possibly empty) so restore is a
  // point-in-time replace for Audit GET /api/imports and /api/exports.
  const replaceImportProvenance =
    backupHasCollection(payload, "source_imports") ||
    backupHasCollection(payload, "source_import_rows");
  const replaceExportRecords = backupHasCollection(payload, "export_records");
  // Canonical archives always include these keys. Leftover live rows would
  // survive upsert-only restore and change GET /api/subjects or hydrated
  // rule parameters after DR. Old snapshots that omit the keys leave seed
  // subjects / live parameters intact (same pattern as provenance).
  const replaceSubjects = backupHasCollection(payload, "subjects");
  const replaceRuleParameters = backupHasCollection(payload, "rule_parameters");
  // Cycles and rule versions were upsert-only. A cycle or version created
  // after the snapshot survived same-DB restore and showed up on
  // GET /api/exam-cycles and GET /api/rule-versions — boot hydrate prefers
  // INITIAL_CYCLE when that leftover id is still present. Wipe when the
  // key is present (canonical always includes both). Versions are wiped
  // only together with parameters so an old snapshot that has versions
  // but omits rule_parameters cannot drop live parameter rows.
  const replaceExamCycles = backupHasCollection(payload, "exam_cycles");
  const replaceRuleVersions =
    backupHasCollection(payload, "rule_versions") && replaceRuleParameters;
  const replaceAuditLogs = backupHasReplaceableAuditLogs(payload);
  // Exemptions and teacher_*_history were always wiped. A local-built
  // contingency (or an old snapshot that omits the keys) then dropped live
  // GET /api/exemptions and teacher history. Wipe only when the snapshot
  // claimed the collection — canonical always includes the arrays.
  const replaceExemptions =
    backupHasCollection(payload, "teacher_exemptions") ||
    backupHasCollection(payload, "exemptions");
  const replaceSchoolHistory =
    backupHasCollection(payload, "teacher_school_history") ||
    backupHasCollection(payload, "schoolHistory");
  const replaceDesignationHistory =
    backupHasCollection(payload, "teacher_designation_history") ||
    backupHasCollection(payload, "designationHistory");
  const replaceLocationHistory =
    backupHasCollection(payload, "teacher_location_history") ||
    backupHasCollection(payload, "locationHistory");
  // Run-scoped tables were always wiped. A local-built contingency (or an
  // old snapshot that omits the keys) then dropped live GET /api/allocation-runs
  // and examiner pair memory. Wipe only when the snapshot claimed the
  // collection — canonical always includes the arrays.
  const replaceRelationships =
    backupHasCollection(payload, "centre_school_relationships") ||
    backupHasCollection(payload, "relationships");
  const replaceInputSnapshots = backupHasCollection(payload, "input_snapshots");
  const replaceAllocationRuns = backupHasCollection(payload, "allocation_runs");
  const replaceAllocationResults = backupHasCollection(
    payload,
    "allocation_run_results",
  );
  const replaceDecisionReasons = backupHasCollection(
    payload,
    "allocation_decision_reasons",
  );
  const replaceManualOverrides = backupHasCollection(
    payload,
    "manual_overrides",
  );
  const replaceDutyAssignments = backupHasCollection(
    payload,
    "duty_assignments",
  );
  const replacePracticalBatches = backupHasCollection(
    payload,
    "practical_batches",
  );
  const replacePracticalSchedules = backupHasCollection(
    payload,
    "practical_schedules",
  );
  const replaceExaminerPairs = backupHasCollection(payload, "examiner_pairs");

  const includeHistory = Boolean(opts.includeHistory);
  const now = new Date().toISOString();
  const stmts: ReturnType<DbClient["prepare"]>[] = [];

  // Parent wipe still clears children first (FK-safe same-DB overwrite).
  // allocation_runs.exam_cycle_id / rule_version_id are NOT NULL, so replacing
  // those parents must clear runs even when the snapshot omitted the run key.
  // includeHistory deletes teachers/schools/centres; dependents that FK those
  // parents must clear even when omitted. input_snapshot_id is nullable —
  // unlink leftover runs instead of dropping them when only snapshots replace.
  const wipeAllocationRuns =
    replaceAllocationRuns || replaceExamCycles || replaceRuleVersions;
  const wipeAllocationResults =
    replaceAllocationResults || wipeAllocationRuns;
  const wipeDecisionReasons =
    replaceDecisionReasons || wipeAllocationResults;
  const wipeManualOverrides =
    replaceManualOverrides || wipeAllocationRuns || wipeAllocationResults;
  const wipeDutyAssignments =
    replaceDutyAssignments ||
    replaceExamCycles ||
    wipeAllocationRuns ||
    includeHistory;
  const wipePracticalBatches =
    replacePracticalBatches ||
    replaceExamCycles ||
    replaceSubjects ||
    includeHistory;
  const wipePracticalSchedules =
    replacePracticalSchedules ||
    wipePracticalBatches ||
    wipeAllocationRuns ||
    includeHistory;
  const wipeExaminerPairs =
    replaceExaminerPairs || replaceSubjects || includeHistory;
  const wipeRelationships = replaceRelationships || includeHistory;
  const wipeInputSnapshots = replaceInputSnapshots;

  if (wipeDecisionReasons) {
    stmts.push(db.prepare(`DELETE FROM allocation_decision_reasons`));
  }
  if (wipeManualOverrides) {
    stmts.push(db.prepare(`DELETE FROM manual_overrides`));
  }
  if (wipePracticalSchedules) {
    stmts.push(db.prepare(`DELETE FROM practical_schedules`));
  }
  if (wipePracticalBatches) {
    stmts.push(db.prepare(`DELETE FROM practical_batches`));
  }
  if (wipeDutyAssignments) {
    stmts.push(db.prepare(`DELETE FROM duty_assignments`));
  }
  if (wipeAllocationResults) {
    stmts.push(db.prepare(`DELETE FROM allocation_run_results`));
  }
  if (wipeAllocationRuns) {
    stmts.push(db.prepare(`DELETE FROM allocation_runs`));
  }
  if (wipeInputSnapshots && !wipeAllocationRuns) {
    stmts.push(
      db.prepare(`UPDATE allocation_runs SET input_snapshot_id = NULL`),
    );
  }
  if (wipeInputSnapshots) {
    stmts.push(db.prepare(`DELETE FROM input_snapshots`));
  }
  if (wipeExaminerPairs) {
    stmts.push(db.prepare(`DELETE FROM examiner_pairs`));
  }
  if (wipeRelationships) {
    stmts.push(db.prepare(`DELETE FROM centre_school_relationships`));
  }
  // includeHistory deletes teachers; those child tables FK to teachers, so
  // they must clear even when the snapshot omitted the keys.
  if (replaceExemptions || includeHistory) {
    stmts.push(db.prepare(`DELETE FROM teacher_exemptions`));
  }
  if (replaceLocationHistory || includeHistory) {
    stmts.push(db.prepare(`DELETE FROM teacher_location_history`));
  }
  if (replaceDesignationHistory || includeHistory) {
    stmts.push(db.prepare(`DELETE FROM teacher_designation_history`));
  }
  if (replaceSchoolHistory || includeHistory) {
    stmts.push(db.prepare(`DELETE FROM teacher_school_history`));
  }
  if (replaceAuditLogs) {
    stmts.push(db.prepare(`DELETE FROM audit_logs`));
  }
  if (replaceImportProvenance) {
    stmts.push(db.prepare(`DELETE FROM source_import_rows`));
    stmts.push(db.prepare(`DELETE FROM source_imports`));
  }
  if (replaceExportRecords) {
    stmts.push(db.prepare(`DELETE FROM export_records`));
  }
  if (replaceRuleParameters) {
    stmts.push(db.prepare(`DELETE FROM rule_parameters`));
  }
  if (replaceSubjects) {
    stmts.push(db.prepare(`DELETE FROM exam_subjects`));
    stmts.push(db.prepare(`DELETE FROM subjects`));
  }
  // exam_days / exam_sessions are unwritten (OQ-020) but still FK to
  // exam_cycles. Wipe them so a leftover cycle row can be deleted.
  if (replaceExamCycles) {
    stmts.push(db.prepare(`DELETE FROM exam_sessions`));
    stmts.push(db.prepare(`DELETE FROM exam_days`));
    if (!replaceSubjects) {
      stmts.push(db.prepare(`DELETE FROM exam_subjects`));
    }
    if (!replaceImportProvenance) {
      stmts.push(
        db.prepare(`UPDATE source_imports SET exam_cycle_id = NULL`),
      );
    }
    stmts.push(db.prepare(`DELETE FROM exam_cycles`));
  }
  if (replaceRuleVersions) {
    if (!replaceExamCycles) {
      stmts.push(
        db.prepare(`UPDATE exam_cycles SET rule_version_id = NULL`),
      );
    }
    stmts.push(db.prepare(`DELETE FROM rule_versions`));
  }
  if (includeHistory) {
    for (const table of [
      "duty_assignment_history",
      "teachers",
      "centres",
      "schools",
      "blocks",
    ]) {
      stmts.push(db.prepare(`DELETE FROM ${table}`));
    }
  }

  const blockIds = new Set<string>();
  for (const b of data.blocks) {
    const id = idOf(b, "blockId", "block_id");
    if (id) blockIds.add(id);
  }
  for (const s of data.schools) {
    blockIds.add(idOf(s, "blockId", "block_id") || "blk_restored");
  }
  for (const c of data.centres) {
    blockIds.add(idOf(c, "blockId", "block_id") || "blk_restored");
  }

  for (const blockId of blockIds) {
    const fromPayload = data.blocks.find(
      (b) => idOf(b, "blockId", "block_id") === blockId,
    );
    stmts.push(
      db
        .prepare(
          `INSERT INTO blocks (block_id, block_code, block_name, active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)
           ON CONFLICT(block_id) DO UPDATE SET
             block_code=excluded.block_code,
             block_name=excluded.block_name,
             updated_at=excluded.updated_at`,
        )
        .bind(
          blockId,
          String(fromPayload?.blockCode ?? fromPayload?.block_code ?? blockId),
          String(fromPayload?.blockName ?? fromPayload?.block_name ?? blockId),
          now,
          now,
        ),
    );
  }

  for (const rv of data.rule_versions) {
    const id = idOf(rv, "ruleVersionId", "rule_version_id");
    if (!id) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO rule_versions
            (rule_version_id, version_label, description, created_at, created_by, is_active)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(rule_version_id) DO UPDATE SET
             version_label=excluded.version_label,
             description=excluded.description,
             is_active=excluded.is_active`,
        )
        .bind(
          id,
          String(rv.versionLabel ?? rv.version_label ?? id),
          String(rv.description ?? ""),
          String(rv.createdAt ?? rv.created_at ?? now),
          String(rv.createdBy ?? rv.created_by ?? "restore"),
          rv.isActive === true || rv.is_active === 1
            ? 1
            : Number(rv.is_active ?? 0),
        ),
    );
  }

  for (const rp of data.rule_parameters) {
    const vid = idOf(rp, "ruleVersionId", "rule_version_id");
    const key = String(rp.paramKey ?? rp.param_key ?? "");
    if (!vid || !key) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO rule_parameters
            (id, rule_version_id, param_key, param_value, value_type)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(rule_version_id, param_key) DO UPDATE SET
             param_value=excluded.param_value,
             value_type=excluded.value_type`,
        )
        .bind(
          String(rp.id ?? crypto.randomUUID()),
          vid,
          key,
          String(rp.paramValue ?? rp.param_value ?? ""),
          String(rp.valueType ?? rp.value_type ?? "string"),
        ),
    );
  }

  for (const cyc of data.exam_cycles) {
    const id = idOf(cyc, "examCycleId", "exam_cycle_id");
    if (!id) continue;
    const ruleId = idOf(cyc, "ruleVersionId", "rule_version_id") || "rv-2027-1";
    stmts.push(
      db
        .prepare(
          `INSERT INTO exam_cycles
            (exam_cycle_id, name, academic_year, standard, start_date, end_date, status, rule_version_id, created_at, created_by, amended_from_id, amendment_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(exam_cycle_id) DO UPDATE SET
             name=excluded.name,
             academic_year=excluded.academic_year,
             standard=excluded.standard,
             start_date=excluded.start_date,
             end_date=excluded.end_date,
             status=excluded.status,
             rule_version_id=excluded.rule_version_id,
             amended_from_id=COALESCE(excluded.amended_from_id, exam_cycles.amended_from_id),
             amendment_reason=COALESCE(excluded.amendment_reason, exam_cycles.amendment_reason)`,
        )
        .bind(
          id,
          String(cyc.name ?? id),
          String(cyc.academicYear ?? cyc.academic_year ?? "unknown"),
          cyc.standard ?? null,
          cyc.startDate ?? cyc.start_date ?? null,
          cyc.endDate ?? cyc.end_date ?? null,
          String(cyc.status ?? "DRAFT"),
          ruleId,
          String(cyc.createdAt ?? cyc.created_at ?? now),
          String(cyc.createdBy ?? cyc.created_by ?? "restore"),
          cyc.amendedFromId ?? cyc.amended_from_id ?? null,
          cyc.amendmentReason ?? cyc.amendment_reason ?? null,
        ),
    );
  }

  const restoredCycleIds = new Set(
    data.exam_cycles
      .map((c) => idOf(c, "examCycleId", "exam_cycle_id"))
      .filter(Boolean),
  );
  const SOURCE_IMPORT_STATUSES = new Set([
    "UPLOADED",
    "VALIDATED",
    "PREVIEWED",
    "APPLIED",
    "REJECTED",
    "FAILED",
  ]);
  const SOURCE_IMPORT_ROW_STATUSES = new Set([
    "NEW",
    "UPDATED",
    "UNCHANGED",
    "INVALID",
    "DUPLICATE",
    "MISSING",
  ]);

  if (replaceImportProvenance) {
    const restoredImportIds = new Set<string>();
    for (const imp of data.source_imports) {
      const importId = String(imp.import_id ?? imp.importId ?? "");
      const filename = String(imp.filename ?? "");
      const fileHash = String(imp.file_hash ?? imp.fileHash ?? "");
      if (!importId || !filename || !fileHash) continue;
      const status = String(imp.status ?? "UPLOADED");
      if (!SOURCE_IMPORT_STATUSES.has(status)) continue;
      const cycleId = String(imp.exam_cycle_id ?? imp.examCycleId ?? "");
      restoredImportIds.add(importId);
      stmts.push(
        db
          .prepare(
            `INSERT INTO source_imports
              (import_id, filename, file_hash, uploaded_by, uploaded_at, exam_cycle_id, row_count, status, r2_key, summary_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            importId,
            filename,
            fileHash,
            imp.uploaded_by ?? imp.uploadedBy ?? null,
            String(imp.uploaded_at ?? imp.uploadedAt ?? now),
            cycleId && restoredCycleIds.has(cycleId) ? cycleId : null,
            imp.row_count ?? imp.rowCount ?? null,
            status,
            imp.r2_key ?? imp.r2Key ?? null,
            imp.summary_json ?? imp.summaryJson ?? null,
          ),
      );
    }
    for (const row of data.source_import_rows) {
      const importId = String(row.import_id ?? row.importId ?? "");
      const status = String(row.status ?? "");
      if (!importId || !restoredImportIds.has(importId)) continue;
      if (!SOURCE_IMPORT_ROW_STATUSES.has(status)) continue;
      const rowNumber = Number(row.row_number ?? row.rowNumber);
      if (!Number.isFinite(rowNumber)) continue;
      stmts.push(
        db
          .prepare(
            `INSERT INTO source_import_rows
              (id, import_id, row_number, status, entity_type, entity_key, message, payload_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            String(row.id ?? crypto.randomUUID()),
            importId,
            rowNumber,
            status,
            row.entity_type ?? row.entityType ?? null,
            row.entity_key ?? row.entityKey ?? null,
            row.message ?? null,
            row.payload_json ?? row.payloadJson ?? null,
          ),
      );
    }
  }

  if (replaceExportRecords) {
    for (const ex of data.export_records) {
      const exportId = String(ex.export_id ?? ex.exportId ?? "");
      const exportType = String(ex.export_type ?? ex.exportType ?? "");
      if (!exportId || !exportType) continue;
      stmts.push(
        db
          .prepare(
            `INSERT INTO export_records
              (export_id, created_at, created_by, export_type, exam_cycle_id, run_id, r2_key, meta_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            exportId,
            String(ex.created_at ?? ex.createdAt ?? now),
            ex.created_by ?? ex.createdBy ?? null,
            exportType,
            ex.exam_cycle_id ?? ex.examCycleId ?? null,
            ex.run_id ?? ex.runId ?? null,
            ex.r2_key ?? ex.r2Key ?? null,
            ex.meta_json ?? ex.metaJson ?? null,
          ),
      );
    }
  }

  for (const s of data.schools) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO schools
            (school_id, school_code, school_name, block_id, latitude, longitude, active, data_quality, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(school_id) DO UPDATE SET
             school_code=excluded.school_code,
             school_name=excluded.school_name,
             block_id=excluded.block_id,
             latitude=excluded.latitude,
             longitude=excluded.longitude,
             active=excluded.active,
             data_quality=excluded.data_quality,
             updated_at=excluded.updated_at`,
        )
        .bind(
          idOf(s, "schoolId", "school_id"),
          s.schoolCode ?? s.school_code,
          s.schoolName ?? s.school_name,
          idOf(s, "blockId", "block_id") || "blk_restored",
          s.latitude ?? null,
          s.longitude ?? null,
          s.active === false || s.active === 0 ? 0 : 1,
          s.dataQuality ?? s.data_quality ?? "Imported",
          now,
          now,
        ),
    );
  }

  for (const c of data.centres) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO centres
            (centre_id, centre_code, centre_name, block_id, latitude, longitude, capacity, active, data_quality, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(centre_id) DO UPDATE SET
             centre_code=excluded.centre_code,
             centre_name=excluded.centre_name,
             block_id=excluded.block_id,
             latitude=excluded.latitude,
             longitude=excluded.longitude,
             capacity=excluded.capacity,
             active=excluded.active,
             data_quality=excluded.data_quality,
             updated_at=excluded.updated_at`,
        )
        .bind(
          idOf(c, "centreId", "centre_id"),
          c.centreCode ?? c.centre_code,
          c.centreName ?? c.centre_name,
          idOf(c, "blockId", "block_id") || "blk_restored",
          c.latitude ?? null,
          c.longitude ?? null,
          c.capacity ?? null,
          c.active === false || c.active === 0 ? 0 : 1,
          c.dataQuality ?? c.data_quality ?? "Imported",
          now,
          now,
        ),
    );
  }

  for (const r of data.centre_school_relationships) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO centre_school_relationships
            (id, centre_id, school_id, relationship_type, effective_from, effective_to, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          r.id ?? crypto.randomUUID(),
          idOf(r, "centreId", "centre_id"),
          idOf(r, "schoolId", "school_id"),
          r.relationshipType ?? r.relationship_type ?? "HOST",
          r.effectiveFrom ?? r.effective_from ?? "2020-01-01",
          r.effectiveTo ?? r.effective_to ?? null,
          now,
        ),
    );
  }

  for (const t of data.teachers) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO teachers
            (teacher_id, employee_code, name, school_id, designation, subject, seniority_rank, home_latitude, home_longitude, is_active, data_quality, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(teacher_id) DO UPDATE SET
             employee_code=excluded.employee_code,
             name=excluded.name,
             school_id=excluded.school_id,
             designation=excluded.designation,
             subject=excluded.subject,
             seniority_rank=excluded.seniority_rank,
             home_latitude=excluded.home_latitude,
             home_longitude=excluded.home_longitude,
             is_active=excluded.is_active,
             data_quality=excluded.data_quality,
             updated_at=excluded.updated_at`,
        )
        .bind(
          idOf(t, "teacherId", "teacher_id"),
          t.employeeCode ?? t.employee_code,
          t.name,
          idOf(t, "schoolId", "school_id"),
          t.designation,
          t.subject ?? null,
          t.seniorityRank ?? t.seniority_rank ?? null,
          t.homeLatitude ?? t.home_latitude ?? null,
          t.homeLongitude ?? t.home_longitude ?? null,
          t.isActive === false || t.is_active === 0 ? 0 : 1,
          t.dataQuality ?? t.data_quality ?? "Imported",
          now,
          now,
        ),
    );
  }

  for (const h of data.teacher_school_history) {
    const tid = idOf(h, "teacherId", "teacher_id");
    const sid = idOf(h, "schoolId", "school_id");
    if (!tid || !sid) continue;
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO teacher_school_history
            (id, teacher_id, school_id, effective_from, effective_to, source_import_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          String(h.id ?? crypto.randomUUID()),
          tid,
          sid,
          h.effectiveFrom ?? h.effective_from ?? "2020-01-01",
          h.effectiveTo ?? h.effective_to ?? null,
          h.sourceImportId ?? h.source_import_id ?? null,
          h.createdAt ?? h.created_at ?? now,
        ),
    );
  }

  for (const h of data.teacher_designation_history) {
    const tid = idOf(h, "teacherId", "teacher_id");
    const designation = String(h.designation ?? "");
    if (!tid || !designation) continue;
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO teacher_designation_history
            (id, teacher_id, designation, effective_from, effective_to, source_import_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          String(h.id ?? crypto.randomUUID()),
          tid,
          designation,
          h.effectiveFrom ?? h.effective_from ?? "2020-01-01",
          h.effectiveTo ?? h.effective_to ?? null,
          h.sourceImportId ?? h.source_import_id ?? null,
          h.createdAt ?? h.created_at ?? now,
        ),
    );
  }

  for (const h of data.teacher_location_history) {
    const tid = idOf(h, "teacherId", "teacher_id");
    const locType = String(h.locationType ?? h.location_type ?? "");
    if (!tid || (locType !== "HOME" && locType !== "SCHOOL")) continue;
    const lat = Number(h.latitude);
    const lng = Number(h.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO teacher_location_history
            (id, teacher_id, location_type, latitude, longitude, effective_from, effective_to, source_import_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          String(h.id ?? crypto.randomUUID()),
          tid,
          locType,
          lat,
          lng,
          h.effectiveFrom ?? h.effective_from ?? "2020-01-01",
          h.effectiveTo ?? h.effective_to ?? null,
          h.sourceImportId ?? h.source_import_id ?? null,
          h.createdAt ?? h.created_at ?? now,
        ),
    );
  }

  for (const e of data.teacher_exemptions) {
    const tid = idOf(e, "teacherId", "teacher_id");
    const reason = String(e.reason ?? "").trim();
    if (!tid || !reason) continue;
    const isExempted =
      e.isExempted === false || e.is_exempted === 0 || e.is_exempted === false
        ? 0
        : 1;
    stmts.push(
      db
        .prepare(
          `INSERT INTO teacher_exemptions
            (id, teacher_id, is_exempted, reason, effective_from, effective_to, source, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             is_exempted=excluded.is_exempted,
             reason=excluded.reason,
             effective_from=excluded.effective_from,
             effective_to=excluded.effective_to,
             source=excluded.source`,
        )
        .bind(
          String(e.id ?? crypto.randomUUID()),
          tid,
          isExempted,
          reason,
          e.effectiveFrom ?? e.effective_from ?? "2020-01-01",
          e.effectiveTo ?? e.effective_to ?? null,
          e.source ?? "restore",
          e.createdAt ?? e.created_at ?? now,
          e.createdBy ?? e.created_by ?? "restore",
        ),
    );
  }

  if (includeHistory) {
    for (const h of data.duty_history) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO duty_assignment_history
              (history_id, assignment_id, exam_cycle_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, academic_year, published_at, run_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            crypto.randomUUID(),
            h.examCycleId ?? h.exam_cycle_id ?? "restored",
            idOf(h, "teacherId", "teacher_id"),
            h.centreId ?? h.centre_id ?? null,
            h.dutyTypeCode ?? h.duty_type_code ?? "UNKNOWN",
            h.roleCode ?? h.role_code ?? null,
            h.examDate ?? h.exam_date,
            h.sessionCode ?? h.session_code ?? "MORNING",
            h.academicYear ?? h.academic_year ?? "unknown",
            h.publishedAt ?? h.published_at ?? now,
            h.runId ?? h.run_id ?? null,
          ),
      );
    }
  }

  for (const snap of data.input_snapshots) {
    const sid = String(snap.snapshot_id ?? snap.snapshotId ?? "");
    if (!sid) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO input_snapshots (snapshot_id, payload_hash, storage_key, inline_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          sid,
          String(snap.payload_hash ?? snap.payloadHash ?? ""),
          snap.storage_key ?? snap.storageKey ?? null,
          snap.inline_json ?? snap.inlineJson ?? null,
          String(snap.created_at ?? snap.createdAt ?? now),
        ),
    );
  }

  for (const run of data.allocation_runs) {
    const runId = String(run.run_id ?? run.runId ?? "");
    if (!runId) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO allocation_runs
            (run_id, exam_cycle_id, rule_version_id, algorithm_version, module, input_snapshot_id, seed, created_by, created_at, status, validation_status, summary_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          runId,
          String(run.exam_cycle_id ?? run.examCycleId ?? ""),
          String(run.rule_version_id ?? run.ruleVersionId ?? "rv-2027-1"),
          String(run.algorithm_version ?? run.algorithmVersion ?? "unknown"),
          String(run.module ?? "THEORY"),
          run.input_snapshot_id ?? run.inputSnapshotId ?? null,
          run.seed ?? null,
          run.created_by ?? run.createdBy ?? "restore",
          String(run.created_at ?? run.createdAt ?? now),
          String(run.status ?? "GENERATED"),
          run.validation_status ?? run.validationStatus ?? null,
          run.summary_json ?? run.summaryJson ?? null,
        ),
    );
  }

  for (const r of data.allocation_run_results) {
    const resultId = String(r.result_id ?? r.resultId ?? "");
    const runId = String(r.run_id ?? r.runId ?? "");
    if (!resultId || !runId) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO allocation_run_results
            (result_id, run_id, teacher_id, centre_id, school_id, duty_type_code, role_code, exam_date, session_code, subject_id, score, decision_trace_json, is_generated, is_override, final_teacher_id, generated_teacher_id, data_quality_flags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          resultId,
          runId,
          r.teacher_id ?? r.teacherId ?? null,
          r.centre_id ?? r.centreId ?? null,
          r.school_id ?? r.schoolId ?? null,
          r.duty_type_code ?? r.dutyTypeCode ?? null,
          r.role_code ?? r.roleCode ?? null,
          r.exam_date ?? r.examDate ?? null,
          r.session_code ?? r.sessionCode ?? null,
          r.subject_id ?? r.subjectId ?? null,
          r.score ?? null,
          r.decision_trace_json ?? r.decisionTraceJson ?? null,
          r.is_generated === 0 || r.isGenerated === false ? 0 : 1,
          r.is_override === 1 || r.isOverride === true ? 1 : 0,
          r.final_teacher_id ?? r.finalTeacherId ?? null,
          r.generated_teacher_id ?? r.generatedTeacherId ?? null,
          r.data_quality_flags ?? r.dataQualityFlags ?? null,
        ),
    );
  }

  for (const reason of data.allocation_decision_reasons) {
    const id = String(reason.id ?? crypto.randomUUID());
    const resultId = String(reason.result_id ?? reason.resultId ?? "");
    if (!resultId) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO allocation_decision_reasons
            (id, result_id, rule_code, severity, message, details_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          resultId,
          String(reason.rule_code ?? reason.ruleCode ?? "UNKNOWN"),
          String(reason.severity ?? "INFO"),
          String(reason.message ?? ""),
          reason.details_json ?? reason.detailsJson ?? null,
        ),
    );
  }

  if (replaceAuditLogs) {
    for (const a of data.audit_logs) {
      const auditId = String(a.audit_id ?? a.auditId ?? crypto.randomUUID());
      stmts.push(
        db
          .prepare(
            `INSERT INTO audit_logs
            (audit_id, user_id, action, entity, entity_id, timestamp, old_value, new_value, reason, meta_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            auditId,
            a.user_id ?? a.userId ?? null,
            String(a.action ?? "RESTORE"),
            a.entity ?? null,
            a.entity_id ?? a.entityId ?? null,
            String(a.timestamp ?? now),
            a.old_value ?? a.oldValue ?? null,
            a.new_value ?? a.newValue ?? null,
            a.reason ?? null,
            a.meta_json ?? a.metaJson ?? null,
          ),
      );
    }
  }

  for (const s of data.subjects) {
    const sid = String(s.subject_id ?? s.subjectId ?? "");
    if (!sid) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO subjects (subject_id, code, name, is_practical, active)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(subject_id) DO UPDATE SET
             code=excluded.code,
             name=excluded.name,
             is_practical=excluded.is_practical,
             active=excluded.active`,
        )
        .bind(
          sid,
          String(s.code ?? sid),
          String(s.name ?? sid),
          s.is_practical === 1 || s.isPractical === true ? 1 : 0,
          s.active === 0 || s.active === false ? 0 : 1,
        ),
    );
  }

  // Legacy backups did not repeat exam_cycle_id on schedules. Retain this
  // lookup so they can be restored when each batch id is unambiguous.
  const practicalBatchCycles = new Map<string, string>();
  for (const b of data.practical_batches) {
    const batchId = String(b.batch_id ?? b.batchId ?? "");
    if (!batchId) continue;
    const examCycleId = String(b.exam_cycle_id ?? b.examCycleId ?? "");
    practicalBatchCycles.set(batchId, examCycleId);
    stmts.push(
      db
        .prepare(
          `INSERT INTO practical_batches
            (batch_id, exam_cycle_id, school_id, subject_id, student_count, batch_index)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          batchId,
          examCycleId,
          String(b.school_id ?? b.schoolId ?? ""),
          String(b.subject_id ?? b.subjectId ?? ""),
          Number(b.student_count ?? b.studentCount ?? 0),
          Number(b.batch_index ?? b.batchIndex ?? 0),
        ),
    );
  }

  for (const s of data.practical_schedules) {
    const scheduleId = String(
      s.schedule_id ?? s.scheduleId ?? crypto.randomUUID(),
    );
    const batchId = String(s.batch_id ?? s.batchId ?? "");
    if (!batchId) continue;
    const examCycleId = String(
      s.exam_cycle_id ?? s.examCycleId ?? practicalBatchCycles.get(batchId) ?? "",
    );
    stmts.push(
      db
        .prepare(
          `INSERT INTO practical_schedules
            (schedule_id, exam_cycle_id, batch_id, exam_date, session_code, internal_examiner_id, external_examiner_id, run_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          scheduleId,
          examCycleId,
          batchId,
          String(s.exam_date ?? s.examDate ?? ""),
          String(s.session_code ?? s.sessionCode ?? "MORNING"),
          String(s.internal_examiner_id ?? s.internalExaminerId ?? ""),
          String(s.external_examiner_id ?? s.externalExaminerId ?? ""),
          s.run_id ?? s.runId ?? null,
        ),
    );
  }

  // Pair memory reloads when the snapshot claimed examiner_pairs (including
  // []). An omitted key leaves live rows unless a parent wipe required FK
  // hygiene (subjects replace or includeHistory teacher delete).
  for (const p of data.examiner_pairs) {
    const pairId = String(p.pair_id ?? p.pairId ?? "");
    const teacherA = String(p.teacher_a_id ?? p.teacherAId ?? "");
    const teacherB = String(p.teacher_b_id ?? p.teacherBId ?? "");
    const subjectId = String(p.subject_id ?? p.subjectId ?? "");
    const schoolId = String(p.school_id ?? p.schoolId ?? "");
    if (!pairId || !teacherA || !teacherB || !subjectId || !schoolId) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO examiner_pairs
            (pair_id, teacher_a_id, teacher_b_id, subject_id, school_id, academic_year,
             internal_teacher_id, external_teacher_id, exam_cycle_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          pairId,
          teacherA,
          teacherB,
          subjectId,
          schoolId,
          String(p.academic_year ?? p.academicYear ?? "unknown"),
          String(p.internal_teacher_id ?? p.internalTeacherId ?? teacherA),
          String(p.external_teacher_id ?? p.externalTeacherId ?? teacherB),
          p.exam_cycle_id ?? p.examCycleId ?? null,
        ),
    );
  }

  for (const o of data.manual_overrides) {
    const oid = String(o.override_id ?? o.overrideId ?? crypto.randomUUID());
    const runId = String(o.run_id ?? o.runId ?? "");
    const resultId = String(o.result_id ?? o.resultId ?? "");
    if (!runId || !resultId) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO manual_overrides
            (override_id, run_id, result_id, changed_by, changed_at, reason, old_value, new_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          oid,
          runId,
          resultId,
          String(o.changed_by ?? o.changedBy ?? "restore"),
          String(o.changed_at ?? o.changedAt ?? now),
          String(o.reason ?? ""),
          String(o.old_value ?? o.oldValue ?? ""),
          String(o.new_value ?? o.newValue ?? ""),
        ),
    );
  }

  for (const d of data.duty_assignments) {
    const aid = String(
      d.assignment_id ?? d.assignmentId ?? crypto.randomUUID(),
    );
    const tid = String(d.teacher_id ?? d.teacherId ?? "");
    if (!tid) continue;
    stmts.push(
      db
        .prepare(
          `INSERT INTO duty_assignments
            (assignment_id, exam_cycle_id, run_id, teacher_id, centre_id, school_id, duty_type_code, role_code, exam_date, session_code, subject_id, academic_year, is_published, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          aid,
          String(d.exam_cycle_id ?? d.examCycleId ?? ""),
          d.run_id ?? d.runId ?? null,
          tid,
          d.centre_id ?? d.centreId ?? null,
          d.school_id ?? d.schoolId ?? null,
          String(d.duty_type_code ?? d.dutyTypeCode ?? "UNKNOWN"),
          d.role_code ?? d.roleCode ?? null,
          String(d.exam_date ?? d.examDate ?? ""),
          String(d.session_code ?? d.sessionCode ?? "MORNING"),
          d.subject_id ?? d.subjectId ?? null,
          d.academic_year ?? d.academicYear ?? null,
          d.is_published === 1 || d.isPublished === true ? 1 : 0,
          String(d.created_at ?? d.createdAt ?? now),
        ),
    );
  }

  try {
    await runAtomic(db, stmts);
    return {
      ok: true,
      counts: {
        teachers: data.teachers.length,
        schools: data.schools.length,
        centres: data.centres.length,
        relationships: data.centre_school_relationships.length,
        history: includeHistory ? data.duty_history.length : 0,
        teacherSchoolHistory: data.teacher_school_history.length,
        teacherDesignationHistory: data.teacher_designation_history.length,
        teacherLocationHistory: data.teacher_location_history.length,
        exemptions: data.teacher_exemptions.length,
        examCycles: data.exam_cycles.length,
        ruleVersions: data.rule_versions.length,
        ruleParameters: data.rule_parameters.length,
        allocationRuns: data.allocation_runs.length,
        allocationResults: data.allocation_run_results.length,
        decisionReasons: data.allocation_decision_reasons.length,
        auditLogs: data.audit_logs.length,
        practicalBatches: data.practical_batches.length,
        practicalSchedules: data.practical_schedules.length,
        examinerPairs: data.examiner_pairs.length,
        manualOverrides: data.manual_overrides.length,
        dutyAssignments: data.duty_assignments.length,
        sourceImports: replaceImportProvenance ? data.source_imports.length : 0,
        sourceImportRows: replaceImportProvenance
          ? data.source_import_rows.length
          : 0,
        exportRecords: replaceExportRecords ? data.export_records.length : 0,
        subjects: replaceSubjects ? data.subjects.length : 0,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Restore failed",
    };
  }
}

export async function countMaster(db: DbClient) {
  const teachers = await db
    .prepare(`SELECT COUNT(*) AS n FROM teachers`)
    .first<{ n: number }>();
  const schools = await db
    .prepare(`SELECT COUNT(*) AS n FROM schools`)
    .first<{ n: number }>();
  const centres = await db
    .prepare(`SELECT COUNT(*) AS n FROM centres`)
    .first<{ n: number }>();
  const history = await db
    .prepare(`SELECT COUNT(*) AS n FROM duty_assignment_history`)
    .first<{ n: number }>();
  const blocks = await db
    .prepare(`SELECT COUNT(*) AS n FROM blocks`)
    .first<{ n: number }>();
  const subjects = await db
    .prepare(`SELECT COUNT(*) AS n FROM subjects`)
    .first<{ n: number }>();
  return {
    teachers: teachers?.n ?? 0,
    schools: schools?.n ?? 0,
    centres: centres?.n ?? 0,
    history: history?.n ?? 0,
    blocks: blocks?.n ?? 0,
    subjects: subjects?.n ?? 0,
  };
}

export type DemoSeedResult =
  | { seeded: true }
  | { seeded: false; reason: string };

/**
 * Local-API first-boot: load the synthetic demo only when the DB has no
 * officer-owned masters (teachers / schools / centres / leftover blocks),
 * published history, allocation runs, a frozen cycle, or leftover
 * provenance (`input_snapshots`, `source_imports`, `export_records`,
 * persisted `audit_logs`). A teachers-only emptiness check was wrong —
 * `includeHistory` restore deletes schools / centres / blocks /
 * `duty_assignment_history` even when a PUBLISHED cycle (or leftover
 * schools / history / geography / snapshots) is present.
 * Seed catalogue subjects from `001_reference_data` are always present after
 * migrate and must not block first-boot. An OPEN bootstrap cycle from
 * `ensureExamCycleIfMissing` does not block. An empty `audit_logs` table
 * and session-shaped rows (no `audit_id`) do not block.
 */
export async function seedDemoDatasetIfEmpty(
  db: DbClient,
  payload: BackupPayload,
): Promise<DemoSeedResult> {
  const blocked = await demoSeedBlockReason(db);
  if (blocked) return { seeded: false, reason: blocked };

  const now = new Date().toISOString();
  for (const b of payload.blocks ?? []) {
    const blockId = idOf(b, "blockId", "block_id");
    if (!blockId) continue;
    await db
      .prepare(
        `INSERT OR IGNORE INTO blocks (block_id, block_code, block_name, active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        blockId,
        String(b.blockCode ?? b.block_code ?? blockId),
        String(b.blockName ?? b.block_name ?? blockId),
        now,
        now,
      )
      .run();
  }

  const restored = await transactionalRestore(db, payload, {
    adminConfirmed: true,
    includeHistory: true,
  });
  if (!restored.ok) return { seeded: false, reason: restored.error };
  return { seeded: true };
}

async function demoSeedBlockReason(db: DbClient): Promise<string | null> {
  const counts = await countMaster(db);
  if (counts.teachers > 0) return "teachers already present";
  if (counts.schools > 0) return "schools already present";
  if (counts.centres > 0) return "centres already present";
  if (counts.blocks > 0) return "blocks already present";
  if (counts.history > 0) return "duty history already present";

  const runs = await db
    .prepare(`SELECT COUNT(*) AS n FROM allocation_runs`)
    .first<{ n: number }>();
  if ((runs?.n ?? 0) > 0) return "allocation runs already present";

  const frozen = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM exam_cycles WHERE status IN ('PUBLISHED','LOCKED','ARCHIVED')`,
    )
    .first<{ n: number }>();
  if ((frozen?.n ?? 0) > 0) return "frozen exam cycle already present";

  const snapshots = await db
    .prepare(`SELECT COUNT(*) AS n FROM input_snapshots`)
    .first<{ n: number }>();
  if ((snapshots?.n ?? 0) > 0) return "snapshots already present";

  const imports = await db
    .prepare(`SELECT COUNT(*) AS n FROM source_imports`)
    .first<{ n: number }>();
  if ((imports?.n ?? 0) > 0) return "source imports already present";

  const exports = await db
    .prepare(`SELECT COUNT(*) AS n FROM export_records`)
    .first<{ n: number }>();
  if ((exports?.n ?? 0) > 0) return "export records already present";

  const persistedAudit = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM audit_logs
       WHERE audit_id IS NOT NULL AND length(audit_id) > 0`,
    )
    .first<{ n: number }>();
  if ((persistedAudit?.n ?? 0) > 0) return "persisted audit already present";

  return null;
}

export async function listBlocks(db: DbClient, limit = 500) {
  const rs = await db
    .prepare(
      `SELECT block_id, block_code, block_name, active, created_at, updated_at
       FROM blocks ORDER BY block_code LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

export async function listSubjects(db: DbClient, limit = 500) {
  const rs = await db
    .prepare(
      `SELECT subject_id, code, name, is_practical, active
       FROM subjects ORDER BY code LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

export async function listTeachers(db: DbClient, limit = 10000) {
  const rs = await db
    .prepare(
      `SELECT teacher_id, employee_code, name, school_id, designation, subject, seniority_rank, joining_date,
              home_latitude, home_longitude, is_active, data_quality
       FROM teachers ORDER BY employee_code LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

export async function listSchools(db: DbClient, limit = 5000) {
  const rs = await db
    .prepare(
      `SELECT school_id, school_code, school_name, block_id, latitude, longitude, active, data_quality
       FROM schools ORDER BY school_code LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

export async function listCentres(db: DbClient, limit = 5000) {
  const rs = await db
    .prepare(
      `SELECT centre_id, centre_code, centre_name, block_id, latitude, longitude, capacity, active, data_quality
       FROM centres ORDER BY centre_code LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

export async function listRelationships(db: DbClient, limit = 1000) {
  const rs = await db
    .prepare(
      `SELECT id, centre_id, school_id, relationship_type, effective_from, effective_to, source_import_id
       FROM centre_school_relationships
       ORDER BY relationship_type, centre_id, school_id
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

/** Direct master-data upserts used by the offline maintenance forms. */
export async function upsertMasterRecord(
  db: DbClient,
  record:
    | {
        kind: "block";
        blockId?: string;
        blockCode: string;
        blockName: string;
        active?: boolean;
      }
    | {
        kind: "school";
        schoolId?: string;
        schoolCode: string;
        schoolName: string;
        blockId: string;
        latitude: number;
        longitude: number;
        active?: boolean;
      }
    | {
        kind: "centre";
        centreId?: string;
        centreCode: string;
        centreName: string;
        blockId: string;
        latitude: number;
        longitude: number;
        capacity: number;
        active?: boolean;
      }
    | {
        kind: "teacher";
        teacherId?: string;
        employeeCode: string;
        name: string;
        schoolId: string;
        designation: string;
        subject: string;
        seniorityRank: number;
        joiningDate?: string | null;
        homeLatitude: number;
        homeLongitude: number;
        isActive?: boolean;
      },
): Promise<{ id: string; created: boolean }> {
  const now = new Date().toISOString();
  if (record.kind === "block") {
    const existing = await db
      .prepare(`SELECT block_id FROM blocks WHERE block_code = ?`)
      .bind(record.blockCode.trim())
      .first<{ block_id: string }>();
    const id = existing?.block_id ?? record.blockId ?? `blk_${crypto.randomUUID()}`;
    if (existing) {
      await db
        .prepare(`UPDATE blocks SET block_name=?, active=?, updated_at=? WHERE block_id=?`)
        .bind(record.blockName.trim(), record.active !== false ? 1 : 0, now, id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO blocks (block_id, block_code, block_name, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, record.blockCode.trim(), record.blockName.trim(), record.active !== false ? 1 : 0, now, now)
        .run();
    }
    return { id, created: !existing };
  }

  if (record.kind === "school") {
    const parent = await db
      .prepare(`SELECT block_id FROM blocks WHERE block_id = ?`)
      .bind(record.blockId)
      .first<{ block_id: string }>();
    if (!parent) throw new Error("Select a valid block before saving");
    const existing = await db
      .prepare(`SELECT school_id FROM schools WHERE school_code = ?`)
      .bind(record.schoolCode.trim())
      .first<{ school_id: string }>();
    const id = existing?.school_id ?? record.schoolId ?? `sch_${crypto.randomUUID()}`;
    if (existing) {
      await db
        .prepare(
          `UPDATE schools SET school_name=?, block_id=?, latitude=?, longitude=?, active=?, data_quality='ManuallyCorrected', updated_at=? WHERE school_id=?`,
        )
        .bind(record.schoolName.trim(), record.blockId, record.latitude, record.longitude, record.active !== false ? 1 : 0, now, id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO schools (school_id, school_code, school_name, block_id, latitude, longitude, active, data_quality, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ManuallyCorrected', ?, ?)`,
        )
        .bind(id, record.schoolCode.trim(), record.schoolName.trim(), record.blockId, record.latitude, record.longitude, record.active !== false ? 1 : 0, now, now)
        .run();
    }
    return { id, created: !existing };
  }

  if (record.kind === "centre") {
    const parent = await db
      .prepare(`SELECT block_id FROM blocks WHERE block_id = ?`)
      .bind(record.blockId)
      .first<{ block_id: string }>();
    if (!parent) throw new Error("Select a valid block before saving");
    const existing = await db
      .prepare(`SELECT centre_id FROM centres WHERE centre_code = ?`)
      .bind(record.centreCode.trim())
      .first<{ centre_id: string }>();
    const id = existing?.centre_id ?? record.centreId ?? `ctr_${crypto.randomUUID()}`;
    if (existing) {
      await db
        .prepare(
          `UPDATE centres SET centre_name=?, block_id=?, latitude=?, longitude=?, capacity=?, active=?, data_quality='ManuallyCorrected', updated_at=? WHERE centre_id=?`,
        )
        .bind(record.centreName.trim(), record.blockId, record.latitude, record.longitude, record.capacity, record.active !== false ? 1 : 0, now, id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO centres (centre_id, centre_code, centre_name, block_id, latitude, longitude, capacity, active, data_quality, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ManuallyCorrected', ?, ?)`,
        )
        .bind(id, record.centreCode.trim(), record.centreName.trim(), record.blockId, record.latitude, record.longitude, record.capacity, record.active !== false ? 1 : 0, now, now)
        .run();
    }
    return { id, created: !existing };
  }

  const school = await db
    .prepare(`SELECT school_id FROM schools WHERE school_id = ?`)
    .bind(record.schoolId)
    .first<{ school_id: string }>();
  if (!school) throw new Error("Select a valid school before saving");
  const existing = await db
    .prepare(
      `SELECT teacher_id, school_id, designation, home_latitude, home_longitude
       FROM teachers WHERE employee_code = ?`,
    )
    .bind(record.employeeCode.trim())
    .first<{
      teacher_id: string;
      school_id: string;
      designation: string;
      home_latitude: number | null;
      home_longitude: number | null;
    }>();
  const id = existing?.teacher_id ?? record.teacherId ?? `tch_${crypto.randomUUID()}`;
  await upsertTeachers(db, [
    {
      teacherId: id,
      employeeCode: record.employeeCode.trim(),
      name: record.name.trim(),
      schoolId: record.schoolId,
      designation: record.designation,
      subject: record.subject,
      seniorityRank: record.seniorityRank,
      joiningDate: record.joiningDate ?? null,
      homeLatitude: record.homeLatitude,
      homeLongitude: record.homeLongitude,
      isActive: record.isActive !== false,
      dataQuality: "ManuallyCorrected",
    },
  ]);
  const effectiveFrom = now.slice(0, 10);
  if (!existing || existing.school_id !== record.schoolId) {
    await db
      .prepare(`UPDATE teacher_school_history SET effective_to=? WHERE teacher_id=? AND effective_to IS NULL`)
      .bind(effectiveFrom, id)
      .run();
    await insertTeacherSchoolHistory(db, [{
      id: crypto.randomUUID(), teacherId: id, schoolId: record.schoolId, effectiveFrom,
    }]);
  }
  if (!existing || existing.designation !== record.designation) {
    await db
      .prepare(`UPDATE teacher_designation_history SET effective_to=? WHERE teacher_id=? AND effective_to IS NULL`)
      .bind(effectiveFrom, id)
      .run();
    await insertTeacherDesignationHistory(db, [{
      id: crypto.randomUUID(), teacherId: id, designation: record.designation, effectiveFrom,
    }]);
  }
  if (
    !existing ||
    existing.home_latitude !== record.homeLatitude ||
    existing.home_longitude !== record.homeLongitude
  ) {
    await db
      .prepare(`UPDATE teacher_location_history SET effective_to=? WHERE teacher_id=? AND location_type='HOME' AND effective_to IS NULL`)
      .bind(effectiveFrom, id)
      .run();
    await insertTeacherLocationHistory(db, [{
      id: crypto.randomUUID(), teacherId: id, locationType: "HOME",
      latitude: record.homeLatitude, longitude: record.homeLongitude, effectiveFrom,
    }]);
  }
  return { id, created: !existing };
}

/**
 * Create a new exam cycle, optionally as an amendment of a published/locked/archived cycle.
 * Never mutates the previous cycle's published allocations.
 * New cycles always start as DRAFT (or explicit OPEN for bootstrap); never create as PUBLISHED.
 */
export async function createExamCycle(
  db: DbClient,
  input: {
    examCycleId: string;
    name: string;
    academicYear: string;
    ruleVersionId: string;
    createdBy: string;
    status?: string;
    startDate?: string | null;
    endDate?: string | null;
    amendedFromId?: string | null;
    amendmentReason?: string | null;
  },
): Promise<
  { ok: true } | { ok: false; error: string; conflict?: boolean }
> {
  const status = input.status ?? "DRAFT";
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    return { ok: false, error: "End date must not precede the start date" };
  }
  if (!["DRAFT", "OPEN"].includes(status)) {
    return {
      ok: false,
      error: `New exam cycles must start as DRAFT or OPEN (got ${status})`,
    };
  }
  const existing = await getExamCycleStatus(db, input.examCycleId);
  if (existing) {
    const mutable = assertMutable(existing, "replace exam cycle");
    if (!mutable.ok) return { ...mutable, conflict: true };
  }
  if (input.amendedFromId) {
    if (!input.amendmentReason?.trim()) {
      return { ok: false, error: "Amendment reason is required" };
    }
    const prev = await db
      .prepare(`SELECT status FROM exam_cycles WHERE exam_cycle_id = ?`)
      .bind(input.amendedFromId)
      .first<{ status: string }>();
    if (!prev) {
      return {
        ok: false,
        error: `Previous cycle ${input.amendedFromId} not found`,
      };
    }
    if (!["PUBLISHED", "LOCKED", "ARCHIVED"].includes(prev.status)) {
      return {
        ok: false,
        error: `Amendments only from PUBLISHED/LOCKED/ARCHIVED (was ${prev.status})`,
      };
    }
  }
  try {
    await upsertExamCycle(db, {
      examCycleId: input.examCycleId,
      name: input.name,
      academicYear: input.academicYear,
      status,
      ruleVersionId: input.ruleVersionId,
      createdBy: input.createdBy,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      amendedFromId: input.amendedFromId ?? null,
      amendmentReason: input.amendmentReason ?? null,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create exam cycle",
    };
  }
}

/** Upsert teachers after client-side import apply. Never deletes history.
 * Natural key is employee_code: if a row already exists for that code, update it
 * (preserve teacher_id so duty_history / FK rows stay intact).
 * Avoids INSERT…ON CONFLICT(teacher_id) which can UNIQUE-fail on employee_code
 * when the requested teacher_id and employee_code point at different rows.
 */
export async function upsertTeachers(
  db: DbClient,
  teachers: Array<Record<string, unknown>>,
): Promise<number> {
  const now = new Date().toISOString();
  let n = 0;
  for (const t of teachers) {
    const schoolId = idOf(t, "schoolId", "school_id");
    if (!schoolId) continue;
    const employeeCode = String(t.employeeCode ?? t.employee_code ?? "").trim();
    if (!employeeCode) continue;
    const requestedId = idOf(t, "teacherId", "teacher_id");
    const name = String(t.name ?? "");
    const designation = String(t.designation ?? "");
    const subject = t.subject ?? null;
    const seniority = t.seniorityRank ?? t.seniority_rank ?? null;
    const joiningDate = t.joiningDate ?? t.joining_date ?? null;
    const lat = t.homeLatitude ?? t.home_latitude ?? null;
    const lon = t.homeLongitude ?? t.home_longitude ?? null;
    const active = t.isActive === false || t.is_active === 0 ? 0 : 1;
    const quality = t.dataQuality ?? t.data_quality ?? "Imported";

    const byCode = await db
      .prepare(`SELECT teacher_id FROM teachers WHERE employee_code = ?`)
      .bind(employeeCode)
      .first<{ teacher_id: string }>();

    if (byCode?.teacher_id) {
      await db
        .prepare(
          `UPDATE teachers SET
             name=?, school_id=?, designation=?, subject=?, seniority_rank=?, joining_date=?,
             home_latitude=?, home_longitude=?, is_active=?, data_quality=?, updated_at=?
           WHERE teacher_id=?`,
        )
        .bind(
          name,
          schoolId,
          designation,
          subject,
          seniority,
          joiningDate,
          lat,
          lon,
          active,
          quality,
          now,
          byCode.teacher_id,
        )
        .run();
      n += 1;
      continue;
    }

    if (requestedId) {
      const byId = await db
        .prepare(`SELECT teacher_id FROM teachers WHERE teacher_id = ?`)
        .bind(requestedId)
        .first<{ teacher_id: string }>();
      if (byId) {
        await db
          .prepare(
            `UPDATE teachers SET
               employee_code=?, name=?, school_id=?, designation=?, subject=?, seniority_rank=?, joining_date=?,
               home_latitude=?, home_longitude=?, is_active=?, data_quality=?, updated_at=?
             WHERE teacher_id=?`,
          )
          .bind(
            employeeCode,
            name,
            schoolId,
            designation,
            subject,
            seniority,
            joiningDate,
            lat,
            lon,
            active,
            quality,
            now,
            requestedId,
          )
          .run();
        n += 1;
        continue;
      }
      await db
        .prepare(
          `INSERT INTO teachers
            (teacher_id, employee_code, name, school_id, designation, subject, seniority_rank, joining_date, home_latitude, home_longitude, is_active, data_quality, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          requestedId,
          employeeCode,
          name,
          schoolId,
          designation,
          subject,
          seniority,
          joiningDate,
          lat,
          lon,
          active,
          quality,
          now,
          now,
        )
        .run();
      n += 1;
      continue;
    }
  }
  return n;
}

/**
 * Persist a manual override against an allocation run result when present.
 * Always returns audit-friendly payload; does not invent eligibility rules.
 */
export async function recordManualOverride(
  db: DbClient,
  input: {
    runId: string;
    requirementKey: string;
    centreId: string;
    oldTeacherId: string;
    newTeacherId: string;
    reason: string;
    changedBy: string;
  },
): Promise<
  | { ok: true; overrideId: string }
  | { ok: false; error: string; conflict?: true }
> {
  if (!input.reason.trim()) {
    return { ok: false, error: "Override reason required" };
  }
  const runMeta = await db
    .prepare(
      `SELECT status, exam_cycle_id FROM allocation_runs WHERE run_id = ?`,
    )
    .bind(input.runId)
    .first<{ status: string; exam_cycle_id: string }>();
  if (!runMeta) {
    return { ok: false, error: "Allocation run not found" };
  }
  if (runMeta.status === "PUBLISHED" || runMeta.status === "LOCKED") {
    return {
      ok: false,
      conflict: true,
      error: `Cannot override published run (${runMeta.status}) — create an amendment`,
    };
  }
  const mutable = await assertExamCycleMutable(
    db,
    runMeta.exam_cycle_id,
    "override",
  );
  if (!mutable.ok) return mutable;

  const row = await db
    .prepare(
      `SELECT result_id, teacher_id, final_teacher_id, decision_trace_json FROM allocation_run_results
       WHERE run_id = ? AND centre_id = ? LIMIT 1`,
    )
    .bind(input.runId, input.centreId)
    .first<{
      result_id: string;
      teacher_id: string;
      final_teacher_id: string | null;
      decision_trace_json: string | null;
    }>();
  if (!row) {
    return {
      ok: false,
      error: "No persisted run result for this centre — generate+persist first",
    };
  }
  const overrideId = crypto.randomUUID();
  const now = new Date().toISOString();
  const nextTrace = mergeOverrideIntoDecisionTrace(row.decision_trace_json, {
    newTeacherId: input.newTeacherId,
    oldTeacherId: input.oldTeacherId,
    requirementKey: input.requirementKey,
    reason: input.reason,
  });
  await db
    .prepare(
      `UPDATE allocation_run_results
       SET final_teacher_id = ?, is_override = 1, decision_trace_json = ?
       WHERE result_id = ?`,
    )
    .bind(input.newTeacherId, nextTrace, row.result_id)
    .run();
  await db
    .prepare(
      `DELETE FROM allocation_decision_reasons
       WHERE result_id = ? AND rule_code LIKE 'INFO-%'`,
    )
    .bind(row.result_id)
    .run();
  await insertDecisionReason(db, row.result_id, {
    ruleCode: "MANUAL_OVERRIDE",
    severity: "WARNING",
    message: input.reason.trim(),
    details: {
      teacherId: input.newTeacherId,
      oldTeacherId: input.oldTeacherId,
      requirementKey: input.requirementKey,
    },
  });
  await db
    .prepare(
      `INSERT INTO manual_overrides
        (override_id, run_id, result_id, changed_by, changed_at, reason, old_value, new_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      overrideId,
      input.runId,
      row.result_id,
      input.changedBy,
      now,
      input.reason.trim(),
      JSON.stringify({
        teacherId: input.oldTeacherId,
        requirementKey: input.requirementKey,
      }),
      JSON.stringify({
        teacherId: input.newTeacherId,
        requirementKey: input.requirementKey,
      }),
    )
    .run();
  return { ok: true, overrideId };
}

export async function listRuleVersions(db: DbClient) {
  const rs = await db
    .prepare(
      `SELECT rule_version_id, version_label, description, created_at, created_by, is_active
       FROM rule_versions ORDER BY created_at DESC`,
    )
    .all();
  return rs.results;
}

export async function getRuleVersion(db: DbClient, ruleVersionId: string) {
  return db
    .prepare(
      `SELECT rule_version_id, version_label, description, created_at, created_by, is_active
       FROM rule_versions WHERE rule_version_id = ?`,
    )
    .bind(ruleVersionId)
    .first<{
      rule_version_id: string;
      version_label: string;
      description: string | null;
      created_at: string;
      created_by: string | null;
      is_active: number;
    }>();
}

export async function listRuleParameters(db: DbClient, ruleVersionId: string) {
  const rs = await db
    .prepare(
      `SELECT param_key, param_value, value_type FROM rule_parameters WHERE rule_version_id = ?`,
    )
    .bind(ruleVersionId)
    .all();
  return rs.results;
}

/**
 * Create a new rule version by cloning parameters from a source version.
 * Never silently edits an existing active version.
 */
export async function createRuleVersion(
  db: DbClient,
  input: {
    ruleVersionId: string;
    versionLabel: string;
    description: string;
    createdBy: string;
    cloneFromId: string;
    activate?: boolean;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const source = await db
    .prepare(
      `SELECT rule_version_id FROM rule_versions WHERE rule_version_id = ?`,
    )
    .bind(input.cloneFromId)
    .first<{ rule_version_id: string }>();
  if (!source) {
    return {
      ok: false,
      error: `Source rule version ${input.cloneFromId} not found`,
    };
  }
  const now = new Date().toISOString();
  try {
    if (input.activate) {
      await db.prepare(`UPDATE rule_versions SET is_active = 0`).run();
    }
    await db
      .prepare(
        `INSERT INTO rule_versions
          (rule_version_id, version_label, description, created_at, created_by, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.ruleVersionId,
        input.versionLabel,
        input.description,
        now,
        input.createdBy,
        input.activate ? 1 : 0,
      )
      .run();
    const params = await listRuleParameters(db, input.cloneFromId);
    for (const p of params) {
      const row = p as {
        param_key: string;
        param_value: string;
        value_type: string;
      };
      await db
        .prepare(
          `INSERT INTO rule_parameters (id, rule_version_id, param_key, param_value, value_type)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.ruleVersionId,
          row.param_key,
          row.param_value,
          row.value_type,
        )
        .run();
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create rule version",
    };
  }
}

/** Activate an existing rule version; deactivates all others. Never edits parameters. */
export async function activateRuleVersion(
  db: DbClient,
  ruleVersionId: string,
): Promise<{ ok: true; versionLabel: string } | { ok: false; error: string }> {
  const row = await db
    .prepare(
      `SELECT rule_version_id, version_label FROM rule_versions WHERE rule_version_id = ?`,
    )
    .bind(ruleVersionId)
    .first<{ rule_version_id: string; version_label: string }>();
  if (!row) {
    return { ok: false, error: `Rule version ${ruleVersionId} not found` };
  }
  try {
    await db.prepare(`UPDATE rule_versions SET is_active = 0`).run();
    await db
      .prepare(
        `UPDATE rule_versions SET is_active = 1 WHERE rule_version_id = ?`,
      )
      .bind(ruleVersionId)
      .run();
    return { ok: true, versionLabel: row.version_label };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to activate rule version",
    };
  }
}

/** Close open CLUBBED rows for touched schools and insert new clubbing links. Never deletes HOST. */
export async function replaceClubbingRelationships(
  db: DbClient,
  input: {
    asOfDate: string;
    importId?: string;
    relationships: Array<{
      centreId: string;
      schoolId: string;
      relationshipType: "HOST" | "CLUBBED";
      effectiveFrom: string;
      effectiveTo?: string | null;
    }>;
  },
): Promise<
  { ok: true; inserted: number; closed: number } | { ok: false; error: string }
> {
  const clubbed = input.relationships.filter(
    (r) => r.relationshipType === "CLUBBED",
  );
  if (!clubbed.length) {
    return { ok: false, error: "No CLUBBED relationships to apply" };
  }
  const schoolIds = [...new Set(clubbed.map((r) => r.schoolId))];
  const now = new Date().toISOString();
  try {
    let closed = 0;
    for (const schoolId of schoolIds) {
      const rs = await db
        .prepare(
          `UPDATE centre_school_relationships
           SET effective_to = ?
           WHERE school_id = ? AND relationship_type = 'CLUBBED' AND effective_to IS NULL`,
        )
        .bind(input.asOfDate, schoolId)
        .run();
      closed += Number(
        (rs as { meta?: { changes?: number } }).meta?.changes ?? 0,
      );
    }
    let inserted = 0;
    for (const r of clubbed) {
      await db
        .prepare(
          `INSERT INTO centre_school_relationships
            (id, centre_id, school_id, relationship_type, effective_from, effective_to, source_import_id, created_at)
           VALUES (?, ?, ?, 'CLUBBED', ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          r.centreId,
          r.schoolId,
          r.effectiveFrom || input.asOfDate,
          r.effectiveTo ?? null,
          input.importId ?? null,
          now,
        )
        .run();
      inserted += 1;
    }
    return { ok: true, inserted, closed };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to replace clubbing",
    };
  }
}

export async function updateCentreCapacities(
  db: DbClient,
  centres: Array<{ centreId: string; capacity: number }>,
): Promise<number> {
  let n = 0;
  for (const c of centres) {
    const rs = await db
      .prepare(
        `UPDATE centres SET capacity = ?, updated_at = ? WHERE centre_id = ?`,
      )
      .bind(c.capacity, new Date().toISOString(), c.centreId)
      .run();
    n += Number((rs as { meta?: { changes?: number } }).meta?.changes ?? 0);
  }
  return n;
}

async function ensureSubjectId(
  db: DbClient,
  subjectCode: string,
): Promise<string> {
  const { name: normalized, code } = normalizeSubject(subjectCode);
  const existing = await db
    .prepare(
      `SELECT subject_id FROM subjects WHERE upper(code) = ? OR upper(name) = ?`,
    )
    .bind(code, normalized)
    .first<{ subject_id: string }>();
  if (existing) return existing.subject_id;
  const subjectId = `sub_${code.toLowerCase()}`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO subjects (subject_id, code, name, is_practical, active)
       VALUES (?, ?, ?, 1, 1)`,
    )
    .bind(subjectId, code, normalized)
    .run();
  return subjectId;
}

/**
 * Persist practical batches (+ optional schedules) for an exam cycle.
 *
 * Also records each internal/external pairing in `examiner_pairs` so the next
 * cycle can apply the annual role switch (OQ-008 hardness still provisional).
 * Pair rows are keyed on the unordered teacher pair + subject + school + year,
 * so re-running a cycle updates the roles instead of duplicating memory.
 */
export async function persistPracticalBatches(
  db: DbClient,
  input: {
    examCycleId: string;
    runId?: string;
    academicYear?: string;
    batches: Array<{
      batchId: string;
      schoolId: string;
      subjectCode: string;
      studentCount: number;
      batchIndex: number;
      examDate?: string;
      sessionCode?: string;
      internalExaminerId?: string;
      externalExaminerId?: string;
    }>;
  },
): Promise<
  | { ok: true; batches: number; schedules: number; pairs: number }
  | { ok: false; error: string }
> {
  try {
    if (input.runId) {
      const run = await db
        .prepare(`SELECT run_id FROM allocation_runs WHERE run_id = ?`)
        .bind(input.runId)
        .first<{ run_id: string }>();
      if (!run) {
        return {
          ok: false,
          error: `Unknown allocation run ${input.runId} — persist the run before its practical batches`,
        };
      }
    }
    const academicYear =
      input.academicYear ??
      (
        await db
          .prepare(
            `SELECT academic_year FROM exam_cycles WHERE exam_cycle_id = ?`,
          )
          .bind(input.examCycleId)
          .first<{ academic_year: string }>()
      )?.academic_year ??
      "unknown";

    // Subject rows are resolved (and created) before the atomic block so the
    // write itself is a single all-or-nothing transaction: a mid-way failure
    // must not leave a cycle with half its batches and no schedules.
    const subjectIds = new Map<string, string>();
    for (const b of input.batches) {
      if (!subjectIds.has(b.subjectCode)) {
        subjectIds.set(b.subjectCode, await ensureSubjectId(db, b.subjectCode));
      }
    }

    const stmts: DbStatement[] = [
      db
        .prepare(`DELETE FROM practical_schedules WHERE exam_cycle_id = ?`)
        .bind(input.examCycleId),
      db
        .prepare(`DELETE FROM practical_batches WHERE exam_cycle_id = ?`)
        .bind(input.examCycleId),
      // Pair memory for this cycle only; prior cycles stay untouched (rule 3).
      db
        .prepare(`DELETE FROM examiner_pairs WHERE exam_cycle_id = ?`)
        .bind(input.examCycleId),
    ];
    let schedules = 0;
    const pairIds = new Set<string>();
    for (const b of input.batches) {
      const subjectId = subjectIds.get(b.subjectCode)!;
      stmts.push(
        db
          .prepare(
            `INSERT INTO practical_batches
            (batch_id, exam_cycle_id, school_id, subject_id, student_count, batch_index)
           VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            b.batchId,
            input.examCycleId,
            b.schoolId,
            subjectId,
            b.studentCount,
            b.batchIndex,
          ),
      );
      if (
        b.examDate &&
        b.sessionCode &&
        b.internalExaminerId &&
        b.externalExaminerId
      ) {
        stmts.push(
          db
            .prepare(
              `INSERT INTO practical_schedules
              (schedule_id, exam_cycle_id, batch_id, exam_date, session_code, internal_examiner_id, external_examiner_id, run_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              input.examCycleId,
              b.batchId,
              b.examDate,
              b.sessionCode,
              b.internalExaminerId,
              b.externalExaminerId,
              input.runId ?? null,
            ),
        );
        schedules += 1;

        const [teacherA, teacherB] = [
          b.internalExaminerId,
          b.externalExaminerId,
        ].sort();
        const pairId = `ep_${input.examCycleId}_${subjectId}_${b.schoolId}_${teacherA}_${teacherB}`;
        stmts.push(
          db
            .prepare(
              `INSERT INTO examiner_pairs
              (pair_id, teacher_a_id, teacher_b_id, subject_id, school_id, academic_year,
               internal_teacher_id, external_teacher_id, exam_cycle_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(pair_id) DO UPDATE SET
               internal_teacher_id=excluded.internal_teacher_id,
               external_teacher_id=excluded.external_teacher_id,
               academic_year=excluded.academic_year`,
            )
            .bind(
              pairId,
              teacherA!,
              teacherB!,
              subjectId,
              b.schoolId,
              academicYear,
              b.internalExaminerId,
              b.externalExaminerId,
              input.examCycleId,
            ),
        );
        // Several batches at one school usually share the same examiner pair;
        // count the distinct rows actually written.
        pairIds.add(pairId);
      }
    }
    await runAtomic(db, stmts);
    return {
      ok: true,
      batches: input.batches.length,
      schedules,
      pairs: pairIds.size,
    };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Failed to persist practical batches",
    };
  }
}

/**
 * Examiner pair memory for the practical role switch. Newest academic year
 * first so the engine sees the most recent pairing for a teacher pair.
 */
export async function listExaminerPairs(db: DbClient, limit = 5000) {
  const rs = await db
    .prepare(
      `SELECT p.pair_id, p.teacher_a_id, p.teacher_b_id, p.subject_id, p.school_id,
              p.academic_year, p.internal_teacher_id, p.external_teacher_id, p.exam_cycle_id,
              s.code AS subject_code
       FROM examiner_pairs p
       LEFT JOIN subjects s ON s.subject_id = p.subject_id
       ORDER BY p.academic_year DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

/** List practical batches + joined schedules for an exam cycle (or all). */
export async function listPracticalBatches(
  db: DbClient,
  examCycleId?: string,
  limit = 2000,
) {
  if (examCycleId) {
    const batches = await db
      .prepare(
        `SELECT b.batch_id, b.exam_cycle_id, b.school_id, b.subject_id, b.student_count, b.batch_index,
                s.code AS subject_code
         FROM practical_batches b
         LEFT JOIN subjects s ON s.subject_id = b.subject_id
         WHERE b.exam_cycle_id = ?
         ORDER BY b.batch_index
         LIMIT ?`,
      )
      .bind(examCycleId, limit)
      .all();
    const schedules = await db
      .prepare(
        `SELECT sch.schedule_id, sch.exam_cycle_id, sch.batch_id, sch.exam_date, sch.session_code,
                sch.internal_examiner_id, sch.external_examiner_id, sch.run_id
         FROM practical_schedules sch
         INNER JOIN practical_batches b
           ON b.batch_id = sch.batch_id
          AND b.exam_cycle_id = sch.exam_cycle_id
         WHERE b.exam_cycle_id = ?`,
      )
      .bind(examCycleId)
      .all();
    return { batches: batches.results, schedules: schedules.results };
  }
  const batches = await db
    .prepare(
      `SELECT b.batch_id, b.exam_cycle_id, b.school_id, b.subject_id, b.student_count, b.batch_index,
              s.code AS subject_code
       FROM practical_batches b
       LEFT JOIN subjects s ON s.subject_id = b.subject_id
       ORDER BY b.exam_cycle_id, b.batch_index
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  const schedules = await db
    .prepare(
      `SELECT schedule_id, exam_cycle_id, batch_id, exam_date, session_code, internal_examiner_id, external_examiner_id, run_id
       FROM practical_schedules LIMIT ?`,
    )
    .bind(limit)
    .all();
  return { batches: batches.results, schedules: schedules.results };
}

/** Published duty history for future allocation eligibility (never delete). */
export async function listDutyHistory(db: DbClient, limit = 5000) {
  const rs = await db
    .prepare(
      `SELECT history_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, academic_year, published_at, run_id
       FROM duty_assignment_history
       ORDER BY published_at DESC, exam_date DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

export async function listExemptions(db: DbClient, limit = 2000) {
  const rs = await db
    .prepare(
      `SELECT id, teacher_id, is_exempted, reason, effective_from, effective_to, source, created_at, created_by
       FROM teacher_exemptions
       ORDER BY effective_from DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

/** Open officer-recorded exemption: still marked exempt and not yet ended. */
async function openExemptionIdForTeacher(
  db: DbClient,
  teacherId: string,
): Promise<string | undefined> {
  const row = await db
    .prepare(
      `SELECT id FROM teacher_exemptions
       WHERE teacher_id = ?
         AND is_exempted = 1
         AND (effective_to IS NULL OR effective_to = '')
       ORDER BY effective_from DESC, created_at DESC
       LIMIT 1`,
    )
    .bind(teacherId)
    .first<{ id: string }>();
  return row?.id;
}

/**
 * Close leftover open rows for the same teacher so generate cannot keep
 * treating a sibling as active after Save/End targeted another id.
 */
async function closeSiblingOpenExemptions(
  db: DbClient,
  teacherId: string,
  keepId: string,
  endedOn: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE teacher_exemptions
       SET is_exempted = 0,
           effective_to = CASE
             WHEN effective_to IS NULL OR effective_to = '' THEN ?
             ELSE effective_to
           END
       WHERE teacher_id = ?
         AND id != ?
         AND is_exempted = 1
         AND (effective_to IS NULL OR effective_to = '')`,
    )
    .bind(endedOn, teacherId, keepId)
    .run();
}

/**
 * Record or refresh an exemption. A Save/End without `id` targets the open
 * row for that teacher — a new UUID would leave the hydrated active row in
 * D1 and generate would still exclude them after End.
 */
export async function upsertExemption(
  db: DbClient,
  input: {
    id?: string;
    teacherId: string;
    reason: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    isExempted?: boolean;
    source?: string;
    createdBy: string;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!input.reason.trim()) {
    return { ok: false, error: "Exemption reason is required" };
  }
  const teacher = await db
    .prepare(`SELECT teacher_id FROM teachers WHERE teacher_id = ?`)
    .bind(input.teacherId)
    .first<{ teacher_id: string }>();
  if (!teacher) {
    return { ok: false, error: `Teacher ${input.teacherId} not found` };
  }
  const openId = input.id ?? (await openExemptionIdForTeacher(db, input.teacherId));
  const id = openId ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const endedOn = input.effectiveTo || input.effectiveFrom || now.slice(0, 10);
  try {
    await db
      .prepare(
        `INSERT INTO teacher_exemptions
          (id, teacher_id, is_exempted, reason, effective_from, effective_to, source, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           is_exempted=excluded.is_exempted,
           reason=excluded.reason,
           effective_from=excluded.effective_from,
           effective_to=excluded.effective_to,
           source=excluded.source`,
      )
      .bind(
        id,
        input.teacherId,
        input.isExempted === false ? 0 : 1,
        input.reason.trim(),
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.source ?? "manual",
        now,
        input.createdBy,
      )
      .run();
    await closeSiblingOpenExemptions(db, input.teacherId, id, endedOn);
    return { ok: true, id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to upsert exemption",
    };
  }
}

const ALLOCATION_RUN_LIST_COLUMNS =
  "run_id, exam_cycle_id, rule_version_id, algorithm_version, module, created_by, created_at, status, validation_status, summary_json";

/** Newest-first recency window. Hydrate/calendar also need latest-per-module. */
async function listRecentAllocationRuns(
  db: DbClient,
  examCycleId: string | undefined,
  limit: number,
) {
  if (examCycleId) {
    const rs = await db
      .prepare(
        `SELECT ${ALLOCATION_RUN_LIST_COLUMNS}
         FROM allocation_runs WHERE exam_cycle_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(examCycleId, limit)
      .all();
    return rs.results;
  }
  const rs = await db
    .prepare(
      `SELECT ${ALLOCATION_RUN_LIST_COLUMNS}
       FROM allocation_runs ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

/** Latest allocation_runs row per (cycle, module). Complements the recency LIMIT. */
async function listLatestAllocationRunPerModule(
  db: DbClient,
  examCycleId?: string,
) {
  if (examCycleId) {
    const rs = await db
      .prepare(
        `SELECT ${ALLOCATION_RUN_LIST_COLUMNS}
         FROM allocation_runs a
         WHERE exam_cycle_id = ?
           AND created_at = (
             SELECT MAX(b.created_at) FROM allocation_runs b
             WHERE b.exam_cycle_id = a.exam_cycle_id AND b.module = a.module
           )
         ORDER BY created_at DESC`,
      )
      .bind(examCycleId)
      .all();
    return rs.results;
  }
  const rs = await db
    .prepare(
      `SELECT ${ALLOCATION_RUN_LIST_COLUMNS}
       FROM allocation_runs a
       WHERE created_at = (
         SELECT MAX(b.created_at) FROM allocation_runs b
         WHERE b.exam_cycle_id = a.exam_cycle_id AND b.module = a.module
       )
       ORDER BY created_at DESC`,
    )
    .all();
  return rs.results;
}

export async function listAllocationRuns(
  db: DbClient,
  examCycleId?: string,
  limit = 100,
) {
  const recent = await listRecentAllocationRuns(db, examCycleId, limit);
  if (!Array.isArray(recent)) return recent;
  const latestPerModule = await listLatestAllocationRunPerModule(
    db,
    examCycleId,
  );
  return mergeAllocationRunsWithLatestPerModule(
    recent,
    Array.isArray(latestPerModule) ? latestPerModule : [],
  );
}

export async function listAllocationRunResults(db: DbClient, runId: string) {
  const rs = await db
    .prepare(
      `SELECT result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_override, final_teacher_id
       FROM allocation_run_results WHERE run_id = ?`,
    )
    .bind(runId)
    .all();
  return rs.results;
}

/** Persisted validator/conflict/trace reasons for a run (joined via results). */
export async function listAllocationDecisionReasons(
  db: DbClient,
  runId: string,
) {
  const rs = await db
    .prepare(
      `SELECT adr.id, adr.result_id, adr.rule_code, adr.severity, adr.message, adr.details_json,
              COALESCE(arr.final_teacher_id, arr.teacher_id) AS teacher_id, arr.centre_id, arr.exam_date, arr.session_code, arr.duty_type_code,
              arr.is_override, arr.final_teacher_id, arr.teacher_id AS generated_teacher_id
       FROM allocation_decision_reasons adr
       INNER JOIN allocation_run_results arr ON arr.result_id = adr.result_id
       WHERE arr.run_id = ?
       ORDER BY adr.severity DESC, adr.rule_code`,
    )
    .bind(runId)
    .all();
  return (rs.results ?? [])
    .filter(
      (row) =>
        !isOverriddenGeneratedSelectionReason(
          row as {
            rule_code?: string;
            is_override?: number | boolean | null;
            final_teacher_id?: string | null;
            generated_teacher_id?: string | null;
            details_json?: string | null;
          },
        ),
    )
    .map((row) => {
      const listed = { ...(row as Record<string, unknown>) };
      const identified = applyPersistedReasonIdentity(
        listed as unknown as Parameters<typeof applyPersistedReasonIdentity>[0],
      );
      delete (identified as { is_override?: unknown }).is_override;
      delete (identified as { generated_teacher_id?: unknown })
        .generated_teacher_id;
      delete (identified as { final_teacher_id?: unknown }).final_teacher_id;
      return identified;
    });
}

export async function insertTeacherSchoolHistory(
  db: DbClient,
  rows: Array<{
    id: string;
    teacherId: string;
    schoolId: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    sourceImportId?: string | null;
    createdAt?: string;
  }>,
): Promise<number> {
  let n = 0;
  for (const r of rows) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO teacher_school_history
          (id, teacher_id, school_id, effective_from, effective_to, source_import_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        r.id,
        r.teacherId,
        r.schoolId,
        r.effectiveFrom,
        r.effectiveTo ?? null,
        r.sourceImportId || null,
        r.createdAt ?? new Date().toISOString(),
      )
      .run();
    n += 1;
  }
  return n;
}

export async function insertTeacherDesignationHistory(
  db: DbClient,
  rows: Array<{
    id: string;
    teacherId: string;
    designation: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    sourceImportId?: string | null;
    createdAt?: string;
  }>,
): Promise<number> {
  let n = 0;
  for (const r of rows) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO teacher_designation_history
          (id, teacher_id, designation, effective_from, effective_to, source_import_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        r.id,
        r.teacherId,
        r.designation,
        r.effectiveFrom,
        r.effectiveTo ?? null,
        r.sourceImportId || null,
        r.createdAt ?? new Date().toISOString(),
      )
      .run();
    n += 1;
  }
  return n;
}

export async function insertTeacherLocationHistory(
  db: DbClient,
  rows: Array<{
    id: string;
    teacherId: string;
    locationType: "HOME" | "SCHOOL";
    latitude: number;
    longitude: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
    sourceImportId?: string | null;
    createdAt?: string;
  }>,
): Promise<number> {
  let n = 0;
  for (const r of rows) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO teacher_location_history
          (id, teacher_id, location_type, latitude, longitude, effective_from, effective_to, source_import_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        r.id,
        r.teacherId,
        r.locationType,
        r.latitude,
        r.longitude,
        r.effectiveFrom,
        r.effectiveTo ?? null,
        r.sourceImportId || null,
        r.createdAt ?? new Date().toISOString(),
      )
      .run();
    n += 1;
  }
  return n;
}

export async function listTeacherSchoolHistory(db: DbClient, limit = 5000) {
  const rs = await db
    .prepare(
      `SELECT id, teacher_id, school_id, effective_from, effective_to, source_import_id, created_at
       FROM teacher_school_history ORDER BY effective_from DESC LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

export async function listTeacherDesignationHistory(
  db: DbClient,
  limit = 5000,
) {
  const rs = await db
    .prepare(
      `SELECT id, teacher_id, designation, effective_from, effective_to, source_import_id, created_at
       FROM teacher_designation_history ORDER BY effective_from DESC LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

export async function listTeacherLocationHistory(db: DbClient, limit = 5000) {
  const rs = await db
    .prepare(
      `SELECT id, teacher_id, location_type, latitude, longitude, effective_from, effective_to, source_import_id, created_at
       FROM teacher_location_history ORDER BY effective_from DESC LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

export async function insertExportRecord(
  db: DbClient,
  input: {
    exportId: string;
    createdBy: string;
    exportType: string;
    examCycleId?: string | null;
    runId?: string | null;
    r2Key?: string | null;
    metaJson?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO export_records
        (export_id, created_at, created_by, export_type, exam_cycle_id, run_id, r2_key, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.exportId,
      new Date().toISOString(),
      input.createdBy,
      input.exportType,
      input.examCycleId ?? null,
      input.runId ?? null,
      input.r2Key ?? null,
      input.metaJson ?? null,
    )
    .run();
}

export async function insertSourceImport(
  db: DbClient,
  input: {
    importId: string;
    filename: string;
    fileHash: string;
    uploadedBy: string;
    examCycleId?: string | null;
    rowCount?: number | null;
    status?:
      | "UPLOADED"
      | "VALIDATED"
      | "PREVIEWED"
      | "APPLIED"
      | "REJECTED"
      | "FAILED";
    r2Key?: string | null;
    summaryJson?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO source_imports
        (import_id, filename, file_hash, uploaded_by, uploaded_at, exam_cycle_id, row_count, status, r2_key, summary_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.importId,
      input.filename,
      input.fileHash,
      input.uploadedBy,
      new Date().toISOString(),
      input.examCycleId ?? null,
      input.rowCount ?? null,
      input.status ?? "UPLOADED",
      input.r2Key ?? null,
      input.summaryJson ?? null,
    )
    .run();
}

export async function updateSourceImportStatus(
  db: DbClient,
  importId: string,
  status:
    "UPLOADED" | "VALIDATED" | "PREVIEWED" | "APPLIED" | "REJECTED" | "FAILED",
  opts?: { rowCount?: number; summaryJson?: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE source_imports
       SET status = ?,
           row_count = COALESCE(?, row_count),
           summary_json = COALESCE(?, summary_json)
       WHERE import_id = ?`,
    )
    .bind(status, opts?.rowCount ?? null, opts?.summaryJson ?? null, importId)
    .run();
}

/** Manual overrides joined to the run/result they changed, newest first. */
export async function listManualOverrides(db: DbClient, limit = 500) {
  const rs = await db
    .prepare(
      `SELECT o.override_id, o.run_id, o.result_id, o.changed_by, o.changed_at, o.reason,
              o.old_value, o.new_value,
              r.exam_cycle_id, r.module,
              res.centre_id, res.role_code, res.exam_date, res.session_code
       FROM manual_overrides o
       LEFT JOIN allocation_runs r ON r.run_id = o.run_id
       LEFT JOIN allocation_run_results res ON res.result_id = o.result_id
       ORDER BY o.changed_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

/** Export download metadata, newest first. */
export async function listExportRecords(db: DbClient, limit = 200) {
  const rs = await db
    .prepare(
      `SELECT export_id, created_at, created_by, export_type, exam_cycle_id, run_id, r2_key, meta_json
       FROM export_records ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

/**
 * Per-row provenance for one import: what the file said about each row and what
 * the preview decided (NEW / UPDATED / UNCHANGED / INVALID / DUPLICATE /
 * MISSING). Re-applying the same import replaces its rows, never other imports'.
 */
export async function insertSourceImportRows(
  db: DbClient,
  importId: string,
  rows: Array<{
    rowNumber: number;
    status: string;
    entityType?: string;
    entityKey?: string;
    message?: string;
    payload?: Record<string, unknown>;
  }>,
): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> {
  try {
    const stmts: DbStatement[] = [
      db
        .prepare(`DELETE FROM source_import_rows WHERE import_id = ?`)
        .bind(importId),
    ];
    for (const r of rows) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO source_import_rows
              (id, import_id, row_number, status, entity_type, entity_key, message, payload_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            importId,
            r.rowNumber,
            r.status,
            r.entityType ?? "teacher",
            r.entityKey ?? null,
            r.message ?? null,
            r.payload ? JSON.stringify(r.payload) : null,
          ),
      );
    }
    await runAtomic(db, stmts);
    return { ok: true, inserted: rows.length };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to persist import rows",
    };
  }
}

export async function listSourceImportRows(
  db: DbClient,
  importId: string,
  limit = 5000,
) {
  const rs = await db
    .prepare(
      `SELECT id, import_id, row_number, status, entity_type, entity_key, message, payload_json
       FROM source_import_rows WHERE import_id = ?
       ORDER BY row_number LIMIT ?`,
    )
    .bind(importId, limit)
    .all();
  return rs.results;
}

export async function listSourceImports(db: DbClient, limit = 100) {
  const rs = await db
    .prepare(
      `SELECT import_id, filename, file_hash, uploaded_by, uploaded_at, exam_cycle_id, row_count, status, r2_key
       FROM source_imports ORDER BY uploaded_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

export async function listBackupRecords(db: DbClient, limit = 50) {
  const rs = await db
    .prepare(
      `SELECT backup_id, created_at, created_by, trigger_reason, r2_key, checksum, status
       FROM backup_records ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all();
  return rs.results;
}

export async function getBackupRecord(db: DbClient, backupId: string) {
  return db
    .prepare(
      `SELECT backup_id, created_at, created_by, trigger_reason, r2_key, checksum, status
       FROM backup_records WHERE backup_id = ?`,
    )
    .bind(backupId)
    .first<{
      backup_id: string;
      created_at: string;
      created_by: string;
      trigger_reason: string | null;
      r2_key: string | null;
      checksum: string | null;
      status: string;
    }>();
}

/**
 * Assemble a canonical backup payload from SQLite/D1 (server-side truth),
 * not from browser memory. Used for archival and DR.
 */
export async function buildCanonicalBackup(
  db: DbClient,
): Promise<BackupPayload & { metadata: Record<string, unknown> }> {
  const [
    teachers,
    schools,
    centres,
    relationships,
    history,
    schoolHist,
    desigHist,
    locHist,
    exemptions,
    blocks,
    cycles,
    ruleVersions,
    inputSnapshots,
    allocationRuns,
    allocationResults,
    decisionReasons,
    auditLogs,
    subjects,
    practicalBatches,
    practicalSchedules,
    examinerPairs,
    manualOverrides,
    dutyAssignments,
    sourceImports,
    sourceImportRows,
    exportRecords,
  ] = await Promise.all([
    listTeachers(db),
    listSchools(db),
    listCentres(db),
    listRelationships(db),
    listDutyHistory(db),
    listTeacherSchoolHistory(db),
    listTeacherDesignationHistory(db),
    listTeacherLocationHistory(db),
    listExemptions(db),
    db
      .prepare(
        `SELECT block_id, block_code, block_name, active FROM blocks ORDER BY block_code`,
      )
      .all()
      .then((r) => r.results),
    listExamCycles(db),
    listRuleVersions(db),
    db
      .prepare(
        `SELECT snapshot_id, payload_hash, storage_key, inline_json, created_at
         FROM input_snapshots ORDER BY created_at`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT run_id, exam_cycle_id, rule_version_id, algorithm_version, module, input_snapshot_id, seed, created_by, created_at, status, validation_status, summary_json
         FROM allocation_runs ORDER BY created_at`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT result_id, run_id, teacher_id, centre_id, school_id, duty_type_code, role_code, exam_date, session_code, subject_id, score, decision_trace_json, is_generated, is_override, final_teacher_id, generated_teacher_id, data_quality_flags
         FROM allocation_run_results`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT id, result_id, rule_code, severity, message, details_json
         FROM allocation_decision_reasons`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT audit_id, user_id, action, entity, entity_id, timestamp, old_value, new_value, reason, meta_json
         FROM audit_logs ORDER BY timestamp DESC LIMIT 5000`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT subject_id, code, name, is_practical, active FROM subjects ORDER BY code`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT batch_id, exam_cycle_id, school_id, subject_id, student_count, batch_index
         FROM practical_batches`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT schedule_id, exam_cycle_id, batch_id, exam_date, session_code, internal_examiner_id, external_examiner_id, run_id
         FROM practical_schedules`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT pair_id, teacher_a_id, teacher_b_id, subject_id, school_id, academic_year,
                internal_teacher_id, external_teacher_id, exam_cycle_id
         FROM examiner_pairs`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT override_id, run_id, result_id, changed_by, changed_at, reason, old_value, new_value
         FROM manual_overrides`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT assignment_id, exam_cycle_id, run_id, teacher_id, centre_id, school_id, duty_type_code, role_code, exam_date, session_code, subject_id, academic_year, is_published, created_at
         FROM duty_assignments`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT import_id, filename, file_hash, uploaded_by, uploaded_at, exam_cycle_id, row_count, status, r2_key, summary_json
         FROM source_imports ORDER BY uploaded_at`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT id, import_id, row_number, status, entity_type, entity_key, message, payload_json
         FROM source_import_rows ORDER BY import_id, row_number`,
      )
      .all()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT export_id, created_at, created_by, export_type, exam_cycle_id, run_id, r2_key, meta_json
         FROM export_records ORDER BY created_at`,
      )
      .all()
      .then((r) => r.results),
  ]);

  const rule_parameters: Array<Record<string, unknown>> = [];
  for (const rv of ruleVersions) {
    const vid = String(
      (rv as { rule_version_id?: string }).rule_version_id ?? "",
    );
    if (!vid) continue;
    const params = await listRuleParameters(db, vid);
    for (const p of params) {
      rule_parameters.push({
        ...(p as Record<string, unknown>),
        rule_version_id: vid,
      });
    }
  }

  return {
    metadata: {
      createdAt: new Date().toISOString(),
      source: "server-canonical",
      note: "Assembled from D1/SQLite — not client memory (OQ-015 passphrase remains client-held for encrypted downloads)",
    },
    teachers: teachers as Array<Record<string, unknown>>,
    schools: schools as Array<Record<string, unknown>>,
    centres: centres as Array<Record<string, unknown>>,
    centre_school_relationships: relationships as Array<
      Record<string, unknown>
    >,
    duty_history: history as Array<Record<string, unknown>>,
    teacher_school_history: schoolHist as Array<Record<string, unknown>>,
    teacher_designation_history: desigHist as Array<Record<string, unknown>>,
    teacher_location_history: locHist as Array<Record<string, unknown>>,
    teacher_exemptions: exemptions as Array<Record<string, unknown>>,
    blocks: blocks as Array<Record<string, unknown>>,
    exam_cycles: cycles as Array<Record<string, unknown>>,
    rule_versions: ruleVersions as Array<Record<string, unknown>>,
    rule_parameters,
    input_snapshots: inputSnapshots as Array<Record<string, unknown>>,
    allocation_runs: allocationRuns as Array<Record<string, unknown>>,
    allocation_run_results: allocationResults as Array<Record<string, unknown>>,
    allocation_decision_reasons: decisionReasons as Array<
      Record<string, unknown>
    >,
    audit_logs: auditLogs as Array<Record<string, unknown>>,
    subjects: subjects as Array<Record<string, unknown>>,
    practical_batches: practicalBatches as Array<Record<string, unknown>>,
    practical_schedules: practicalSchedules as Array<Record<string, unknown>>,
    examiner_pairs: examinerPairs as Array<Record<string, unknown>>,
    manual_overrides: manualOverrides as Array<Record<string, unknown>>,
    duty_assignments: dutyAssignments as Array<Record<string, unknown>>,
    source_imports: sourceImports as Array<Record<string, unknown>>,
    source_import_rows: sourceImportRows as Array<Record<string, unknown>>,
    export_records: exportRecords as Array<Record<string, unknown>>,
  };
}
