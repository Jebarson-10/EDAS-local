import { describe, expect, it } from "vitest";
import {
  allocationRunsToHydrate,
  latestRunForModule,
  latestRunForModuleInCycle,
  latestRunInCycle,
  mergeAllocationRunsWithLatestPerModule,
  publishableSiblingRun,
  runsForExamCycle,
} from "./latestRun.js";

const theory = (
  runId: string,
  createdAt: string,
): { module: "THEORY"; runId: string; createdAt: string } => ({
  module: "THEORY",
  runId,
  createdAt,
});

describe("latestRunForModule", () => {
  it("returns undefined when the module has no runs", () => {
    expect(
      latestRunForModule(
        [{ module: "HALL", runId: "h1", createdAt: "2027-03-02T00:00:00.000Z" }],
        "THEORY",
      ),
    ).toBeUndefined();
  });

  it("prefers the newest createdAt even when that row is last in the list", () => {
    const latest = latestRunForModule(
      [
        theory("old", "2027-03-01T00:00:00.000Z"),
        theory("new", "2027-03-02T12:00:00.000Z"),
      ],
      "THEORY",
    );
    expect(latest?.runId).toBe("new");
  });

  it("prefers the newest createdAt even when that row is first (live addRun order)", () => {
    const latest = latestRunForModule(
      [
        theory("new", "2027-03-02T12:00:00.000Z"),
        theory("old", "2027-03-01T00:00:00.000Z"),
      ],
      "THEORY",
    );
    expect(latest?.runId).toBe("new");
  });

  it("ignores newer runs from other modules", () => {
    const latest = latestRunForModule(
      [
        { module: "HALL", runId: "h-new", createdAt: "2027-03-03T00:00:00.000Z" },
        theory("t-old", "2027-03-01T00:00:00.000Z"),
        theory("t-new", "2027-03-02T00:00:00.000Z"),
      ],
      "THEORY",
    );
    expect(latest?.runId).toBe("t-new");
  });
});

describe("runsForExamCycle", () => {
  it("drops leftover runs from another exam cycle", () => {
    const mixed = [
      {
        module: "PRACTICAL" as const,
        runId: "p-old",
        createdAt: "2027-03-03T00:00:00.000Z",
        examCycleId: "ec_published",
        validationStatus: "INVALID",
      },
      {
        module: "THEORY" as const,
        runId: "t-amend",
        createdAt: "2027-03-04T00:00:00.000Z",
        examCycleId: "ec_amend",
        validationStatus: "VALID",
      },
    ];
    expect(runsForExamCycle(mixed, "ec_amend").map((r) => r.runId)).toEqual([
      "t-amend",
    ]);
    expect(
      latestRunForModuleInCycle(mixed, "PRACTICAL", "ec_amend"),
    ).toBeUndefined();
    expect(latestRunForModuleInCycle(mixed, "THEORY", "ec_amend")?.runId).toBe(
      "t-amend",
    );
    expect(
      latestRunForModuleInCycle(mixed, "PRACTICAL", "ec_published")?.runId,
    ).toBe("p-old");
  });

  it("latestRunInCycle prefers createdAt over first-in-list after hydrate append", () => {
    const mixed = [
      {
        module: "THEORY" as const,
        runId: "t-old",
        createdAt: "2027-03-01T00:00:00.000Z",
        examCycleId: "ec_amend",
      },
      {
        module: "HALL" as const,
        runId: "h-new",
        createdAt: "2027-03-04T00:00:00.000Z",
        examCycleId: "ec_amend",
      },
      {
        module: "THEORY" as const,
        runId: "t-other",
        createdAt: "2027-03-05T00:00:00.000Z",
        examCycleId: "ec_published",
      },
    ];
    expect(runsForExamCycle(mixed, "ec_amend")[0]?.runId).toBe("t-old");
    expect(latestRunInCycle(mixed, "ec_amend")?.runId).toBe("h-new");
    expect(latestRunInCycle(mixed, "ec_published")?.runId).toBe("t-other");
  });
});

describe("publishableSiblingRun", () => {
  it("omits a leftover INVALID sibling instead of treating it as publishable", () => {
    const omitted = publishableSiblingRun({
      runId: "run_live_hall_short",
      module: "HALL",
      result: { assignments: [{ teacherId: "t1" }] },
      validation: { status: "INVALID" },
    });
    expect(omitted.publish).toBeUndefined();
    expect(omitted.omitted).toBe("hall run_live_hall_short (INVALID)");
  });

  it("keeps a VALID sibling for publish", () => {
    const kept = publishableSiblingRun({
      runId: "p_new",
      module: "PRACTICAL",
      result: { schedules: [{}] },
      validation: { status: "VALID" },
    });
    expect(kept.publish?.runId).toBe("p_new");
    expect(kept.omitted).toBeNull();
  });
});

describe("allocationRunsToHydrate", () => {
  it("keeps a hall and practical run older than eight newer theory runs", () => {
    const runs = [
      ...Array.from({ length: 9 }, (_, i) => ({
        module: "THEORY",
        run_id: `t${i}`,
        created_at: `2027-03-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
      })),
      {
        module: "HALL",
        run_id: "h1",
        created_at: "2027-03-01T00:00:00.000Z",
      },
      {
        module: "PRACTICAL",
        run_id: "p1",
        created_at: "2027-03-02T00:00:00.000Z",
      },
    ];
    const picked = allocationRunsToHydrate(runs);
    expect(picked).toHaveLength(11);
    expect(picked.some((r) => r.module === "HALL" && r.run_id === "h1")).toBe(
      true,
    );
    expect(
      picked.some((r) => r.module === "PRACTICAL" && r.run_id === "p1"),
    ).toBe(true);
  });
});

describe("mergeAllocationRunsWithLatestPerModule", () => {
  it("keeps the latest hall and practical after a 100-run theory recency window", () => {
    const recent = Array.from({ length: 100 }, (_, i) => ({
      module: "THEORY",
      run_id: `t${i}`,
      created_at: `2027-06-01T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
    }));
    const latestPerModule = [
      recent[recent.length - 1]!,
      {
        module: "HALL",
        run_id: "h_older",
        created_at: "2027-01-01T00:00:00.000Z",
      },
      {
        module: "PRACTICAL",
        run_id: "p_older",
        created_at: "2027-01-02T00:00:00.000Z",
      },
    ];
    const merged = mergeAllocationRunsWithLatestPerModule(
      recent,
      latestPerModule,
    );
    expect(merged).toHaveLength(102);
    expect(merged.some((r) => r.run_id === "h_older")).toBe(true);
    expect(merged.some((r) => r.run_id === "p_older")).toBe(true);
    expect(merged.filter((r) => r.module === "THEORY")).toHaveLength(100);
    expect(merged[0]?.run_id).toBe("t99");
  });
});
