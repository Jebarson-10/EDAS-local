import { describe, expect, it } from "vitest";
import {
  feasibleFromPersistedSummary,
  mergeFallbackIntoDecisionTrace,
  isGeneratedInfoRuleCode,
  isOverriddenGeneratedSelectionReason,
  mergeOverrideIntoDecisionTrace,
  roleSwitchAppliedForSchedule,
  roleSwitchAppliedFromPersisted,
  theoryAssignmentsFromPersistedResults,
  usedFallbackBandFromPersisted,
} from "./persistedFlags.js";

describe("mergeFallbackIntoDecisionTrace", () => {
  it("folds usedFallbackBand onto an object trace without dropping slotIndex", () => {
    const merged = mergeFallbackIntoDecisionTrace(
      JSON.stringify({ slotIndex: 2, teacherId: "t1" }),
      true,
    );
    expect(JSON.parse(merged)).toEqual({
      slotIndex: 2,
      teacherId: "t1",
      usedFallbackBand: true,
    });
  });

  it("wraps a practical notes array so role-switch survives reload", () => {
    const merged = mergeFallbackIntoDecisionTrace(
      JSON.stringify(["Applied annual role switch from academic year 2026"]),
      true,
    );
    expect(JSON.parse(merged)).toEqual({
      decisionNotes: [
        "Applied annual role switch from academic year 2026",
      ],
      roleSwitchApplied: true,
      usedFallbackBand: true,
    });
  });

  it("leaves unparsable JSON unchanged", () => {
    expect(mergeFallbackIntoDecisionTrace("not-json", true)).toBe("not-json");
  });
});

describe("usedFallbackBandFromPersisted", () => {
  it("reads the explicit persisted boolean instead of inventing false", () => {
    expect(
      usedFallbackBandFromPersisted({
        teacher_id: "t1",
        centre_id: "c1",
        role_code: "CHIEF_EXAMINATION",
        exam_date: "2027-03-15",
        session_code: "MORNING",
        score: 1,
        decision_trace_json: JSON.stringify({ usedFallbackBand: true }),
      }),
    ).toBe(true);
    expect(
      usedFallbackBandFromPersisted({
        teacher_id: "t2",
        centre_id: "c1",
        role_code: "CHIEF_EXAMINATION",
        exam_date: "2027-03-15",
        session_code: "MORNING",
        score: 1,
        decision_trace_json: JSON.stringify({ usedFallbackBand: false }),
      }),
    ).toBe(false);
  });

  it("recovers old rows from INFO-HM-FALLBACK or is_override", () => {
    expect(
      usedFallbackBandFromPersisted({
        teacher_id: "t1",
        centre_id: "c1",
        role_code: "CHIEF_EXAMINATION",
        exam_date: "2027-03-15",
        session_code: "MORNING",
        score: 1,
        decision_trace_json: JSON.stringify({
          teacherId: "t1",
          reasons: [
            {
              ruleCode: "INFO-HM-FALLBACK",
              severity: "WARNING",
              message: "Preferred band shortage",
            },
          ],
        }),
      }),
    ).toBe(true);
    expect(
      usedFallbackBandFromPersisted({
        teacher_id: "t1",
        centre_id: "c1",
        role_code: "CHIEF_EXAMINATION",
        exam_date: "2027-03-15",
        session_code: "MORNING",
        score: 1,
        is_override: 1,
        decision_trace_json: "{}",
      }),
    ).toBe(true);
  });

  it("does not invent true from row order or an empty trace", () => {
    expect(
      usedFallbackBandFromPersisted({
        teacher_id: "t1",
        centre_id: "c1",
        role_code: "CHIEF_EXAMINATION",
        exam_date: "2027-03-15",
        session_code: "MORNING",
        score: 1,
        decision_trace_json: JSON.stringify({ teacherId: "t1" }),
      }),
    ).toBe(false);
  });
});

describe("roleSwitchAppliedFromPersisted", () => {
  it("reads the explicit persisted boolean", () => {
    expect(
      roleSwitchAppliedFromPersisted({
        teacher_id: "t1",
        centre_id: "s1",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify({
          decisionNotes: ["Applied annual role switch from academic year 2026"],
          roleSwitchApplied: true,
          usedFallbackBand: true,
        }),
      }),
    ).toBe(true);
    expect(
      roleSwitchAppliedFromPersisted({
        teacher_id: "t2",
        centre_id: "s1",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify({
          decisionNotes: [],
          roleSwitchApplied: false,
          usedFallbackBand: false,
        }),
      }),
    ).toBe(false);
  });

  it("recovers old notes-array traces that mention a role switch", () => {
    expect(
      roleSwitchAppliedFromPersisted({
        teacher_id: "t1",
        centre_id: "s1",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify([
          "Applied annual role switch from academic year 2026",
        ]),
      }),
    ).toBe(true);
  });
});

describe("roleSwitchAppliedForSchedule", () => {
  it("matches the persisted internal row, not schedule-array order", () => {
    const rows = [
      {
        teacher_id: "int_b",
        centre_id: "s1",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-02",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify({ roleSwitchApplied: false }),
      },
      {
        teacher_id: "int_a",
        centre_id: "s1",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify({ roleSwitchApplied: true }),
      },
    ];
    expect(
      roleSwitchAppliedForSchedule(rows, {
        schoolId: "s1",
        examDate: "2027-03-01",
        internalExaminerId: "int_a",
      }),
    ).toBe(true);
    expect(
      roleSwitchAppliedForSchedule(rows, {
        schoolId: "s1",
        examDate: "2027-03-02",
        internalExaminerId: "int_b",
      }),
    ).toBe(false);
    expect(
      roleSwitchAppliedForSchedule(rows, {
        schoolId: "missing",
        examDate: "2027-03-01",
        internalExaminerId: "int_a",
      }),
    ).toBe(false);
  });
});

describe("isOverriddenGeneratedSelectionReason", () => {
  it("drops generate INFO-* and generate RULE-* about the generated pick after override", () => {
    expect(isGeneratedInfoRuleCode("INFO-DISTANCE")).toBe(true);
    expect(isGeneratedInfoRuleCode("INFO-FAIRNESS")).toBe(true);
    expect(isGeneratedInfoRuleCode("INFO-HM-FALLBACK")).toBe(true);
    expect(isGeneratedInfoRuleCode("MANUAL_OVERRIDE")).toBe(false);
    expect(
      isOverriddenGeneratedSelectionReason({
        rule_code: "INFO-SELECTED",
        is_override: 1,
        generated_teacher_id: "tch_gen",
        final_teacher_id: "tch_ov",
      }),
    ).toBe(true);
    expect(
      isOverriddenGeneratedSelectionReason({
        rule_code: "INFO-DISTANCE",
        is_override: 1,
        generated_teacher_id: "tch_gen",
        final_teacher_id: "tch_ov",
      }),
    ).toBe(true);
    expect(
      isOverriddenGeneratedSelectionReason({
        rule_code: "INFO-FAIRNESS",
        generated_teacher_id: "tch_gen",
        final_teacher_id: "tch_ov",
      }),
    ).toBe(true);
    expect(
      isOverriddenGeneratedSelectionReason({
        rule_code: "INFO-HM-FALLBACK",
        generated_teacher_id: "tch_gen",
        final_teacher_id: "tch_ov",
      }),
    ).toBe(true);
    expect(
      isOverriddenGeneratedSelectionReason({
        rule_code: "INFO-SELECTED",
        is_override: 0,
        generated_teacher_id: "tch_gen",
        final_teacher_id: "tch_gen",
      }),
    ).toBe(false);
    expect(
      isOverriddenGeneratedSelectionReason({
        rule_code: "MANUAL_OVERRIDE",
        is_override: 1,
        generated_teacher_id: "tch_gen",
        final_teacher_id: "tch_ov",
      }),
    ).toBe(false);
    expect(
      isOverriddenGeneratedSelectionReason({
        rule_code: "RULE-THEORY-DISTANCE",
        is_override: 1,
        generated_teacher_id: "tch_gen",
        final_teacher_id: "tch_ov",
      }),
    ).toBe(true);
    expect(
      isOverriddenGeneratedSelectionReason({
        rule_code: "RULE-CONFLICT-SESSION",
        is_override: 1,
        generated_teacher_id: "tch_gen",
        final_teacher_id: "tch_ov",
        details_json: JSON.stringify({ teacherId: "tch_gen" }),
      }),
    ).toBe(true);
    expect(
      isOverriddenGeneratedSelectionReason({
        rule_code: "RULE-SHORTAGE",
        is_override: 1,
        generated_teacher_id: "tch_gen",
        final_teacher_id: "tch_ov",
        details_json: JSON.stringify({
          unmatched: true,
          requirementKey: "c2-CHIEF",
        }),
      }),
    ).toBe(false);
    expect(
      isOverriddenGeneratedSelectionReason({
        rule_code: "RULE-THEORY-DISTANCE",
        is_override: 0,
        generated_teacher_id: "tch_gen",
        final_teacher_id: "tch_gen",
      }),
    ).toBe(false);
  });
});

describe("mergeOverrideIntoDecisionTrace", () => {
  it("replaces the generated teacher and generate INFO-* with MANUAL_OVERRIDE", () => {
    const merged = mergeOverrideIntoDecisionTrace(
      JSON.stringify({
        teacherId: "tch_gen",
        targetId: "ctr_1",
        eligibility: "PASS",
        requirementKey: "ctr_1-CHIEF",
        selectedBecause: "lowest eligible fairness score",
        reasons: [
          {
            ruleCode: "INFO-DISTANCE",
            severity: "INFO",
            message: "Within 40 km (home=12 school=8)",
          },
          {
            ruleCode: "INFO-FAIRNESS",
            severity: "INFO",
            message: "Fairness components recent=0 historyCount=1",
          },
          {
            ruleCode: "INFO-HM-FALLBACK",
            severity: "WARNING",
            message: "Preferred band shortage",
          },
          {
            ruleCode: "INFO-SELECTED",
            severity: "INFO",
            message:
              "Selected because lowest eligible fairness score with deterministic tie-break",
          },
        ],
        score: 4,
      }),
      {
        newTeacherId: "tch_ov",
        oldTeacherId: "tch_gen",
        requirementKey: "ctr_1-CHIEF",
        reason: "Officer medical leave",
      },
    );
    const parsed = JSON.parse(merged) as {
      teacherId: string;
      selectedBecause: string;
      usedFallbackBand: boolean;
      reasons: Array<{ ruleCode: string; message: string }>;
    };
    expect(parsed.teacherId).toBe("tch_ov");
    expect(parsed.selectedBecause).toBe("manual override");
    expect(parsed.usedFallbackBand).toBe(true);
    expect(parsed.reasons.map((r) => r.ruleCode)).toEqual(["MANUAL_OVERRIDE"]);
    expect(parsed.reasons.at(-1)?.message).toBe("Officer medical leave");
  });
});

describe("theoryAssignmentsFromPersistedResults", () => {
  it("does not invent usedFallbackBand as false for every row", () => {
    const assignments = theoryAssignmentsFromPersistedResults(
      [
        {
          teacher_id: "tch_a",
          centre_id: "ctr_1",
          role_code: "CHIEF_EXAMINATION",
          exam_date: "2027-03-15",
          session_code: "MORNING",
          score: 4,
          decision_trace_json: JSON.stringify({
            teacherId: "tch_a",
            usedFallbackBand: true,
            reasons: [],
          }),
        },
        {
          teacher_id: "tch_b",
          centre_id: "ctr_2",
          role_code: "CHIEF_EXAMINATION",
          exam_date: "2027-03-15",
          session_code: "MORNING",
          score: 1,
          decision_trace_json: JSON.stringify({
            teacherId: "tch_b",
            usedFallbackBand: false,
          }),
        },
      ],
      new Map([["tch_a", "SYN0001"]]),
    );
    expect(assignments.map((a) => a.usedFallbackBand)).toEqual([true, false]);
    expect(assignments[0]?.employeeCode).toBe("SYN0001");
    expect(assignments[1]?.employeeCode).toBe("tch_b");
  });

  it("reads persisted requirementKey instead of inventing centre-roleCode", () => {
    const assignments = theoryAssignmentsFromPersistedResults([
      {
        teacher_id: "tch_a",
        centre_id: "ctr_1",
        role_code: "CHIEF_EXAMINATION",
        exam_date: "2027-03-15",
        session_code: "MORNING",
        score: 4,
        decision_trace_json: JSON.stringify({
          teacherId: "tch_a",
          requirementKey: "ctr_1-CHIEF",
        }),
      },
    ]);
    expect(assignments[0]?.requirementKey).toBe("ctr_1-CHIEF");
  });

  it("Why after override names the replacement, not the generated teacher", () => {
    const merged = theoryAssignmentsFromPersistedResults([
      {
        teacher_id: "tch_gen",
        final_teacher_id: "tch_ov",
        is_override: 1,
        centre_id: "ctr_1",
        role_code: "CHIEF_EXAMINATION",
        exam_date: "2027-03-15",
        session_code: "MORNING",
        score: 4,
        decision_trace_json: mergeOverrideIntoDecisionTrace(
          JSON.stringify({
            teacherId: "tch_gen",
            selectedBecause: "lowest eligible fairness score",
            requirementKey: "ctr_1-CHIEF",
            reasons: [
              {
                ruleCode: "INFO-DISTANCE",
                severity: "INFO",
                message: "Within 40 km (home=12 school=8)",
              },
              {
                ruleCode: "INFO-SELECTED",
                severity: "INFO",
                message: "Selected because lowest eligible fairness score",
              },
            ],
          }),
          {
            newTeacherId: "tch_ov",
            oldTeacherId: "tch_gen",
            requirementKey: "ctr_1-CHIEF",
            reason: "Coverage",
          },
        ),
      },
    ]);
    expect(merged[0]?.teacherId).toBe("tch_ov");
    expect(merged[0]?.decisionTrace.teacherId).toBe("tch_ov");
    expect(merged[0]?.decisionTrace.selectedBecause).toBe("manual override");
    expect(
      merged[0]?.decisionTrace.reasons.some((r) => r.ruleCode === "MANUAL_OVERRIDE"),
    ).toBe(true);
    expect(
      merged[0]?.decisionTrace.reasons.some((r) => r.ruleCode.startsWith("INFO-")),
    ).toBe(false);

    const stale = theoryAssignmentsFromPersistedResults([
      {
        teacher_id: "tch_gen",
        final_teacher_id: "tch_ov",
        is_override: 1,
        centre_id: "ctr_1",
        role_code: "CHIEF_EXAMINATION",
        exam_date: "2027-03-15",
        session_code: "MORNING",
        score: 4,
        decision_trace_json: JSON.stringify({
          teacherId: "tch_gen",
          selectedBecause: "lowest eligible fairness score",
          reasons: [
            {
              ruleCode: "INFO-FAIRNESS",
              severity: "INFO",
              message: "Fairness components recent=0 historyCount=1",
            },
            {
              ruleCode: "INFO-HM-FALLBACK",
              severity: "WARNING",
              message: "Preferred band shortage",
            },
            {
              ruleCode: "INFO-SELECTED",
              severity: "INFO",
              message: "Selected because lowest eligible fairness score",
            },
          ],
        }),
      },
    ]);
    expect(stale[0]?.decisionTrace.teacherId).toBe("tch_ov");
    expect(stale[0]?.decisionTrace.selectedBecause).toBe("manual override");
    expect(
      stale[0]?.decisionTrace.reasons.some((r) => r.ruleCode === "MANUAL_OVERRIDE"),
    ).toBe(true);
    expect(
      stale[0]?.decisionTrace.reasons.some((r) => r.ruleCode.startsWith("INFO-")),
    ).toBe(false);
  });
});

describe("feasibleFromPersistedSummary", () => {
  it("reads persisted feasible instead of inventing it from row count", () => {
    expect(
      feasibleFromPersistedSummary(
        JSON.stringify({ assignments: 8, shortages: 2, feasible: false }),
        8,
      ),
    ).toBe(false);
    expect(
      feasibleFromPersistedSummary(
        JSON.stringify({ schedules: 3, feasible: true }),
        3,
      ),
    ).toBe(true);
  });

  it("falls back to row count only when summary omitted the flag", () => {
    expect(feasibleFromPersistedSummary("{}", 2)).toBe(true);
    expect(feasibleFromPersistedSummary(null, 0)).toBe(false);
  });
});
