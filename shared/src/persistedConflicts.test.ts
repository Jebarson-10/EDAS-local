import { describe, expect, it } from "vitest";
import {
  applyPersistedReasonIdentity,
  conflictsFromPersistedReasons,
} from "./persistedConflicts.js";

describe("conflictsFromPersistedReasons", () => {
  it("surfaces only RULE-CONFLICT-* rows already persisted", () => {
    const conflicts = conflictsFromPersistedReasons([
      {
        rule_code: "RULE-THEORY-DISTANCE",
        severity: "INFO",
        message: "Within preferred band",
        teacher_id: "t1",
        exam_date: "2027-03-15",
        session_code: "MORNING",
      },
      {
        rule_code: "RULE-CONFLICT-SESSION",
        severity: "ERROR",
        message: "Teacher has multiple duties in the same date and session",
        teacher_id: "t1",
        exam_date: "2027-03-15",
        session_code: "MORNING",
        details_json: JSON.stringify({
          duties: ["THEORY", "HALL"],
          teacherId: "t1",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
        }),
      },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      ruleCode: "RULE-CONFLICT-SESSION",
      severity: "ERROR",
      message: "Teacher has multiple duties in the same date and session",
      teacherId: "t1",
      date: "2027-03-15",
      session: "MORNING",
      duties: ["THEORY", "HALL"],
    });
  });

  it("skips conflict rows that lack a usable session (does not invent one)", () => {
    const conflicts = conflictsFromPersistedReasons([
      {
        rule_code: "RULE-CONFLICT-SESSION",
        severity: "ERROR",
        message: "overlap",
        teacher_id: "t1",
        exam_date: "2027-03-15",
        session_code: "EVENING",
      },
    ]);
    expect(conflicts).toEqual([]);
  });

  it("prefers details_json teacher/date/session when the joined result differs", () => {
    const conflicts = conflictsFromPersistedReasons([
      {
        rule_code: "RULE-CONFLICT-SESSION",
        severity: "WARNING",
        message: "overlap",
        teacher_id: "fallback-result",
        exam_date: "1999-01-01",
        session_code: "AFTERNOON",
        details_json: JSON.stringify({
          teacherId: "t-real",
          examDate: "2027-03-16",
          sessionCode: "MORNING",
          duties: ["THEORY"],
        }),
      },
    ]);
    expect(conflicts).toEqual([
      {
        ruleCode: "RULE-CONFLICT-SESSION",
        severity: "WARNING",
        message: "overlap",
        teacherId: "t-real",
        date: "2027-03-16",
        session: "MORNING",
        duties: ["THEORY"],
      },
    ]);
  });

  it("prefers details examDate over JOIN When, and blanks unmatched JOIN identity", () => {
    const matched = applyPersistedReasonIdentity({
      rule_code: "RULE-THEORY-DISTANCE",
      severity: "ERROR",
      message: "Too far",
      teacher_id: "join-teacher",
      exam_date: "1999-01-01",
      session_code: "AFTERNOON",
      details_json: JSON.stringify({
        teacherId: "t1",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
      }),
    });
    expect(matched.teacher_id).toBe("t1");
    expect(matched.exam_date).toBe("2027-03-15");
    expect(matched.session_code).toBe("MORNING");

    const unmatched = applyPersistedReasonIdentity({
      rule_code: "RULE-SHORTAGE",
      severity: "ERROR",
      message: "NO FEASIBLE ALLOCATION",
      teacher_id: "results-0",
      exam_date: "2027-03-10",
      session_code: "MORNING",
      details_json: JSON.stringify({
        requirementKey: "c2-CHIEF",
        unmatched: true,
      }),
    });
    expect(unmatched.teacher_id).toBe("");
    expect(unmatched.exam_date).toBe("");
    expect(unmatched.session_code).toBe("");
  });

  it("does not COALESCE generate RULE-* onto the override teacher", () => {
    const remapped = applyPersistedReasonIdentity({
      rule_code: "RULE-THEORY-DISTANCE",
      severity: "ERROR",
      message: "Distance exceeds 40 km",
      teacher_id: "t-override",
      generated_teacher_id: "t-generated",
      exam_date: "2027-03-15",
      session_code: "MORNING",
      details_json: JSON.stringify({ distanceHomeKm: 55 }),
    });
    expect(remapped.teacher_id).toBe("t-generated");
    expect(remapped.exam_date).toBe("2027-03-15");

    const fromDetails = applyPersistedReasonIdentity({
      rule_code: "RULE-CONFLICT-SESSION",
      severity: "ERROR",
      message: "overlap",
      teacher_id: "t-override",
      generated_teacher_id: "t-generated",
      exam_date: "2027-03-15",
      session_code: "MORNING",
      details_json: JSON.stringify({
        teacherId: "t-generated",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
      }),
    });
    expect(fromDetails.teacher_id).toBe("t-generated");

    const override = applyPersistedReasonIdentity({
      rule_code: "MANUAL_OVERRIDE",
      severity: "WARNING",
      message: "Coverage",
      teacher_id: "t-override",
      generated_teacher_id: "t-generated",
      exam_date: "2027-03-15",
      session_code: "MORNING",
      details_json: JSON.stringify({ teacherId: "t-override" }),
    });
    expect(override.teacher_id).toBe("t-override");
  });

  it("does not inherit a filled slot when a hall shortage only has centreId", () => {
    const hall = applyPersistedReasonIdentity({
      rule_code: "RULE-HALL-SHORTAGE",
      severity: "ERROR",
      message: "NO FEASIBLE ALLOCATION",
      teacher_id: "t-assigned",
      exam_date: "2027-03-15",
      session_code: "MORNING",
      details_json: JSON.stringify({
        centreId: "c1",
        required: 11,
        eligible: 3,
        shortage: 8,
        source: "validator",
      }),
    });
    expect(hall.teacher_id).toBe("");
    expect(hall.exam_date).toBe("");
    expect(hall.session_code).toBe("");
  });
});
