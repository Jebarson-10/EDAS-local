import { describe, expect, it } from "vitest";
import { crossModuleCalendar } from "./crossModuleCalendar";
import type { AllocationRunRecord } from "../state/AppContext";

function theoryRun(
  examCycleId: string,
  runId: string,
  teacherId: string,
): AllocationRunRecord {
  return {
    runId,
    examCycleId,
    module: "THEORY",
    createdAt: "2027-03-02T00:00:00.000Z",
    algorithmVersion: "test",
    validationStatus: "VALID",
    result: {
      algorithmVersion: "test",
      assignments: [
        {
          teacherId,
          centreId: "c1",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
        },
      ],
    },
    validation: { status: "VALID" },
  } as unknown as AllocationRunRecord;
}

function practicalRun(
  examCycleId: string,
  runId: string,
  teacherId: string,
  status: "VALID" | "INVALID",
): AllocationRunRecord {
  return {
    runId,
    examCycleId,
    module: "PRACTICAL",
    createdAt: "2027-03-03T00:00:00.000Z",
    algorithmVersion: "test",
    validationStatus: status,
    result: {
      algorithmVersion: "test",
      batches: [],
      schedules: [
        {
          batchKey: "b1",
          schoolId: "s1",
          subjectId: "sub1",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          internalExaminerId: teacherId,
          externalExaminerId: "t_ext",
          roleSwitchApplied: false,
          decisionNotes: [],
        },
      ],
      feasible: status === "VALID",
      message: status,
    },
    validation: { status },
  } as unknown as AllocationRunRecord;
}

describe("crossModuleCalendar", () => {
  it("does not fold the previous cycle's leftover INVALID practical into an amendment", () => {
    const leftover = practicalRun("ec_published", "p_old", "t_old", "INVALID");
    const amendTheory = theoryRun("ec_amend", "t_new", "t_new");
    const events = crossModuleCalendar(
      [leftover, amendTheory],
      "THEORY",
      "ec_amend",
    );
    expect(events).toEqual([]);
  });

  it("still uses this cycle's latest other-module run", () => {
    const leftover = practicalRun("ec_published", "p_old", "t_old", "INVALID");
    const amendPractical = practicalRun("ec_amend", "p_new", "t_new", "VALID");
    const events = crossModuleCalendar(
      [leftover, amendPractical],
      "THEORY",
      "ec_amend",
    );
    expect(events.some((e) => e.teacherId === "t_new")).toBe(true);
    expect(events.some((e) => e.teacherId === "t_old")).toBe(false);
  });
});
