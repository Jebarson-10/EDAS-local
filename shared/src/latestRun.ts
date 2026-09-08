/**
 * Session runs are newest-first after addRun, but hydrate appends API rows.
 * Pick by createdAt so the dashboard cannot show a stale module status.
 */
export function latestRunForModule<
  T extends { module: string; createdAt: string },
>(runs: readonly T[], module: T["module"]): T | undefined {
  let best: T | undefined;
  for (const run of runs) {
    if (run.module !== module) continue;
    if (!best || run.createdAt > best.createdAt) best = run;
  }
  return best;
}

/**
 * Publish, calendar, and review surfaces are one open cycle.
 * A leftover INVALID (or published) run from the previous cycle must not
 * look like this cycle's module — it would block publish without saying
 * it is leftover, and would feed the amendment calendar.
 */
export function runsForExamCycle<T extends { examCycleId?: string }>(
  runs: readonly T[],
  examCycleId: string,
): T[] {
  return runs.filter((run) => run.examCycleId === examCycleId);
}

export function latestRunForModuleInCycle<
  T extends { module: string; createdAt: string; examCycleId?: string },
>(
  runs: readonly T[],
  module: T["module"],
  examCycleId: string,
): T | undefined {
  return latestRunForModule(runsForExamCycle(runs, examCycleId), module);
}

/**
 * Validation shows one "Latest run" for the open cycle. List order is not
 * newest-first after hydrate appends, so `[0]` after `runsForExamCycle` can
 * be an older same-cycle row while the dashboard already shows a newer one.
 */
export function latestRunInCycle<
  T extends { createdAt: string; examCycleId?: string },
>(runs: readonly T[], examCycleId: string): T | undefined {
  let best: T | undefined;
  for (const run of runsForExamCycle(runs, examCycleId)) {
    if (!best || run.createdAt > best.createdAt) best = run;
  }
  return best;
}

/**
 * Publish theory (+ practical/hall if generated). A leftover INVALID sibling
 * must not abort the cycle — the server would 409 that run id anyway.
 * Omit it and say so; only a VALID result is posted.
 */
export function publishableSiblingRun<
  T extends {
    runId: string;
    module: string;
    result?: unknown;
    validation?: { status?: string } | null;
  },
>(
  run: T | undefined,
): { publish: T | undefined; omitted: string | null } {
  if (!run?.result) return { publish: undefined, omitted: null };
  if (run.validation?.status === "INVALID") {
    return {
      publish: undefined,
      omitted: `${run.module.toLowerCase()} ${run.runId} (INVALID)`,
    };
  }
  return { publish: run, omitted: null };
}

/**
 * Boot hydrate must reconstruct every listed allocation run.
 * A recency slice (e.g. 8) drops an older hall/practical after a burst of
 * theory regenerations, while the dashboard Runs stat and pipeline still
 * claim to reflect persisted modules. The list endpoint recency window is
 * 100 plus the latest run per module so that window cannot drop them.
 */
export function allocationRunsToHydrate<T>(runs: readonly T[]): T[] {
  return [...runs];
}

/**
 * GET /api/allocation-runs is newest-first with a recency LIMIT.
 * That window can be 100 theory regenerations and drop the latest
 * hall/practical — same class as a hydrate slice(0, 8).
 * Union the latest row per module so boot hydrate / calendar / dashboard
 * still see each module's current run. Not a pager.
 */
export function mergeAllocationRunsWithLatestPerModule<
  T extends {
    run_id?: string;
    runId?: string;
    created_at?: string;
    createdAt?: string;
  },
>(recent: readonly T[], latestPerModule: readonly T[]): T[] {
  const idOf = (row: T) => row.run_id ?? row.runId ?? "";
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const row of [...recent, ...latestPerModule]) {
    const id = idOf(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }
  merged.sort((a, b) => {
    const ac = a.created_at ?? a.createdAt ?? "";
    const bc = b.created_at ?? b.createdAt ?? "";
    return bc.localeCompare(ac);
  });
  return merged;
}
