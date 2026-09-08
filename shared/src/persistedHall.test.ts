import { describe, expect, it } from "vitest";
import {
  employeeCodeFromMasters,
  hallAssignmentsFromPersistedResults,
  slotIndexFromDecisionTrace,
} from "./persistedHall.js";

describe("slotIndexFromDecisionTrace", () => {
  it("reads the persisted hall slot instead of the array index", () => {
    expect(slotIndexFromDecisionTrace(JSON.stringify({ slotIndex: 2 }), 0)).toBe(
      2,
    );
  });

  it("keeps the row index when the trace has no slot (old rows)", () => {
    expect(slotIndexFromDecisionTrace(JSON.stringify({ teacherId: "t1" }), 7)).toBe(
      7,
    );
    expect(slotIndexFromDecisionTrace(null, 3)).toBe(3);
    expect(slotIndexFromDecisionTrace("not-json", 4)).toBe(4);
  });

  it("ignores negative or non-numeric slot values", () => {
    expect(slotIndexFromDecisionTrace(JSON.stringify({ slotIndex: -1 }), 5)).toBe(
      5,
    );
    expect(
      slotIndexFromDecisionTrace(JSON.stringify({ slotIndex: "2" }), 5),
    ).toBe(5);
  });
});

describe("hallAssignmentsFromPersistedResults", () => {
  it("does not invent a global slot from result order", () => {
    const codes = new Map([["tch_a", "SYN0001"]]);
    const assignments = hallAssignmentsFromPersistedResults(
      [
        {
          teacher_id: "tch_a",
          centre_id: "ctr_1",
          role_code: "HALL_INVIGILATOR",
          exam_date: "2027-03-15",
          session_code: "MORNING",
          score: 0,
          decision_trace_json: JSON.stringify({ slotIndex: 1 }),
        },
        {
          teacher_id: "tch_b",
          final_teacher_id: "tch_b",
          centre_id: "ctr_1",
          role_code: "HALL_STANDBY",
          exam_date: "2027-03-15",
          session_code: "MORNING",
          score: 1,
          decision_trace_json: JSON.stringify({ slotIndex: 0 }),
        },
      ],
      codes,
    );
    expect(assignments.map((a) => a.slotIndex)).toEqual([1, 0]);
    expect(assignments[0]?.employeeCode).toBe("SYN0001");
    expect(assignments[0]?.roleCode).toBe("HALL_INVIGILATOR");
    expect(assignments[1]?.roleCode).toBe("HALL_STANDBY");
    expect(assignments[1]?.employeeCode).toBe("tch_b");
  });
});

describe("employeeCodeFromMasters", () => {
  it("falls back to the teacher id when the master list missed the row", () => {
    expect(employeeCodeFromMasters("tch_x", new Map())).toBe("tch_x");
  });
});
