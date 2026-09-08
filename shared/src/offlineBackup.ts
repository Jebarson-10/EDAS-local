/** Keys that trigger a leftover wipe on restore when present as an array. */
export const OFFLINE_CONTINGENCY_WIPE_TRIGGER_KEYS = [
  "audit_logs",
  "exam_cycles",
  "rule_versions",
  "subjects",
  "rule_parameters",
  "teacher_exemptions",
  "exemptions",
  "teacher_school_history",
  "teacher_designation_history",
  "teacher_location_history",
  "schoolHistory",
  "designationHistory",
  "locationHistory",
  "allocation_runs",
  "allocation_run_results",
  "allocation_decision_reasons",
  "input_snapshots",
  "examiner_pairs",
  "practical_batches",
  "practical_schedules",
  "manual_overrides",
  "duty_assignments",
] as const;

export type OfflineContingencyInput = {
  examCycleName: string;
  examCycleStatus: string;
  ruleVersionLabel: string;
  teachers: unknown[];
  schools: unknown[];
  centres: unknown[];
  relationships: unknown[];
  history: unknown[];
  blocks: unknown[];
};

/**
 * Memory-only fallback when the API cannot assemble a canonical archive.
 * Must not include wipe-trigger keys — restoring this file must not drop
 * live D1 exemptions, teacher history, cycles, persisted audit, allocation
 * runs, or examiner pair memory.
 */
export function buildOfflineContingencyPayload(
  input: OfflineContingencyInput,
): Record<string, unknown> {
  return {
    metadata: {
      createdAt: new Date().toISOString(),
      note: "In-memory contingency — not a server-canonical DR archive (OQ-015)",
      examCycle: input.examCycleName,
      examCycleStatus: input.examCycleStatus,
      source: "offline-memory",
    },
    teachers: input.teachers,
    schools: input.schools,
    centres: input.centres,
    centre_school_relationships: input.relationships,
    duty_history: input.history,
    rules: input.ruleVersionLabel,
    blocks: input.blocks,
  };
}

export function offlineContingencyHasWipeTrigger(
  payload: Record<string, unknown>,
): boolean {
  return OFFLINE_CONTINGENCY_WIPE_TRIGGER_KEYS.some((key) =>
    Array.isArray(payload[key]),
  );
}
