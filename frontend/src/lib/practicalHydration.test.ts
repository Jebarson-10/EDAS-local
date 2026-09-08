import { describe, expect, it } from "vitest";
import { indexPracticalPages } from "./practicalHydration";

const batch = (examCycleId: string, batchId: string, schoolId: string) => ({
  batch_id: batchId,
  exam_cycle_id: examCycleId,
  school_id: schoolId,
});

const schedule = (
  runId: string,
  batchId: string,
  examCycleId?: string,
) => ({
  run_id: runId,
  batch_id: batchId,
  ...(examCycleId ? { exam_cycle_id: examCycleId } : {}),
});

// The two cycles below deliberately reuse batch key BATCH-1: batch_id is
// unique only per exam cycle, so any index keyed by batch id alone would
// hand cycle two's schedule the school of cycle one.
const cycleOne = {
  batches: [batch("EC-1", "BATCH-1", "SCH-A")],
  schedules: [schedule("RUN-1", "BATCH-1", "EC-1")],
};
const cycleTwo = {
  batches: [batch("EC-2", "BATCH-1", "SCH-B")],
  schedules: [schedule("RUN-2", "BATCH-1", "EC-2")],
};

describe("indexPracticalPages", () => {
  it("resolves a repeated batch key within its own exam cycle", () => {
    const index = indexPracticalPages([cycleOne, cycleTwo]);

    const first = index.schedulesByRun.get("RUN-1") ?? [];
    const second = index.schedulesByRun.get("RUN-2") ?? [];
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);

    expect(index.batchFor(first[0], "EC-1")?.school_id).toBe("SCH-A");
    expect(index.batchFor(second[0], "EC-2")?.school_id).toBe("SCH-B");
  });

  it("keeps the runs of different cycles apart in schedulesByRun", () => {
    const index = indexPracticalPages([cycleOne, cycleTwo]);
    expect(Array.from(index.schedulesByRun.keys()).sort()).toEqual([
      "RUN-1",
      "RUN-2",
    ]);
  });

  it("falls back to the run's cycle when a schedule has no exam_cycle_id", () => {
    const index = indexPracticalPages([
      cycleOne,
      { batches: cycleTwo.batches, schedules: [schedule("RUN-2", "BATCH-1")] },
    ]);

    const second = index.schedulesByRun.get("RUN-2") ?? [];
    expect(index.batchFor(second[0], "EC-2")?.school_id).toBe("SCH-B");
    expect(index.batchFor(second[0], "EC-1")?.school_id).toBe("SCH-A");
  });

  it("drops schedules with no run id", () => {
    const index = indexPracticalPages([
      {
        batches: cycleOne.batches,
        schedules: [
          { run_id: null, batch_id: "BATCH-1", exam_cycle_id: "EC-1" },
          schedule("RUN-1", "BATCH-1", "EC-1"),
        ],
      },
    ]);
    expect(index.schedulesByRun.get("RUN-1")).toHaveLength(1);
    expect(index.schedulesByRun.size).toBe(1);
  });

  it("returns undefined for a batch that belongs to no fetched cycle", () => {
    const index = indexPracticalPages([cycleOne]);
    const orphan = schedule("RUN-9", "BATCH-1", "EC-404");
    expect(index.batchFor(orphan, "EC-404")).toBeUndefined();
  });

  describe("batchesForRun", () => {
    it("dedupes repeated schedules of the same batch", () => {
      const index = indexPracticalPages([
        {
          batches: [
            batch("EC-1", "BATCH-1", "SCH-A"),
            batch("EC-1", "BATCH-2", "SCH-C"),
          ],
          schedules: [
            schedule("RUN-1", "BATCH-1", "EC-1"),
            schedule("RUN-1", "BATCH-1", "EC-1"),
            schedule("RUN-1", "BATCH-2", "EC-1"),
          ],
        },
      ]);

      const batches = index.batchesForRun(
        index.schedulesByRun.get("RUN-1") ?? [],
        "EC-1",
      );
      expect(batches.map((b) => b.batch_id)).toEqual(["BATCH-1", "BATCH-2"]);
    });

    it("does not leak another cycle's batch of the same key", () => {
      const index = indexPracticalPages([cycleOne, cycleTwo]);
      const batches = index.batchesForRun(
        index.schedulesByRun.get("RUN-2") ?? [],
        "EC-2",
      );
      expect(batches).toHaveLength(1);
      expect(batches[0].school_id).toBe("SCH-B");
    });

    it("skips schedules whose batch was not fetched", () => {
      const index = indexPracticalPages([cycleOne]);
      const batches = index.batchesForRun(
        [
          schedule("RUN-1", "BATCH-1", "EC-1"),
          schedule("RUN-1", "BATCH-MISSING", "EC-1"),
        ],
        "EC-1",
      );
      expect(batches.map((b) => b.batch_id)).toEqual(["BATCH-1"]);
    });

    it("returns nothing for an empty schedule list", () => {
      const index = indexPracticalPages([cycleOne]);
      expect(index.batchesForRun([], "EC-1")).toEqual([]);
    });
  });

  it("tolerates null, undefined and empty pages", () => {
    const index = indexPracticalPages([
      null,
      undefined,
      { batches: [], schedules: [] },
      cycleOne,
    ]);
    expect(index.schedulesByRun.size).toBe(1);
    expect(
      index.batchFor(schedule("RUN-1", "BATCH-1", "EC-1"), "EC-1")?.school_id,
    ).toBe("SCH-A");
  });
});
