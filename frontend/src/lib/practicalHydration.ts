/**
 * Indexing for practical rows fetched per exam cycle.
 *
 * `batch_id` is unique only within an exam cycle (see migration 003), so every
 * lookup here is keyed by (exam cycle, batch id). Indexing by batch id alone
 * silently binds one cycle's schedule to another cycle's batch — wrong school,
 * subject and student count on the practical view.
 */

export interface PracticalBatchRow {
  batch_id: string;
  exam_cycle_id: string;
}

export interface PracticalScheduleRow {
  batch_id: string;
  exam_cycle_id?: string;
  run_id: string | null;
}

export interface PracticalPage<
  B extends PracticalBatchRow,
  S extends PracticalScheduleRow,
> {
  batches: B[];
  schedules: S[];
}

export interface PracticalIndex<
  B extends PracticalBatchRow,
  S extends PracticalScheduleRow,
> {
  /** Schedules of one allocation run, keyed by run id. */
  schedulesByRun: Map<string, S[]>;
  /** The batch a schedule belongs to, resolved within its own cycle. */
  batchFor: (schedule: S, fallbackCycleId: string) => B | undefined;
  /** Distinct batches referenced by the given schedules, in schedule order. */
  batchesForRun: (schedules: S[], fallbackCycleId: string) => B[];
}

const keyOf = (examCycleId: string, batchId: string) =>
  `${examCycleId}::${batchId}`;

export function indexPracticalPages<
  B extends PracticalBatchRow,
  S extends PracticalScheduleRow,
>(pages: Array<PracticalPage<B, S> | null | undefined>): PracticalIndex<B, S> {
  const schedulesByRun = new Map<string, S[]>();
  const batchesByKey = new Map<string, B>();

  for (const page of pages) {
    for (const b of page?.batches ?? []) {
      batchesByKey.set(keyOf(String(b.exam_cycle_id), b.batch_id), b);
    }
    for (const s of page?.schedules ?? []) {
      const runId = s.run_id ?? "";
      if (!runId) continue;
      const list = schedulesByRun.get(runId) ?? [];
      list.push(s);
      schedulesByRun.set(runId, list);
    }
  }

  const batchFor = (schedule: S, fallbackCycleId: string) =>
    batchesByKey.get(
      keyOf(String(schedule.exam_cycle_id ?? fallbackCycleId), schedule.batch_id),
    );

  const batchesForRun = (schedules: S[], fallbackCycleId: string) => {
    const seen = new Map<string, B>();
    for (const s of schedules) {
      const batch = batchFor(s, fallbackCycleId);
      if (!batch) continue;
      const key = keyOf(String(batch.exam_cycle_id), batch.batch_id);
      if (!seen.has(key)) seen.set(key, batch);
    }
    return Array.from(seen.values());
  };

  return { schedulesByRun, batchFor, batchesForRun };
}
