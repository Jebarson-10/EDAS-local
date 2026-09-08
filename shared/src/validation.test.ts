import { describe, expect, it } from "vitest";
import {
  allocationRunBodySchema,
  exportRecordBodySchema,
  importApplyBodySchema,
  manualOverrideBodySchema,
  parseBody,
  publishRunBodySchema,
  restoreBodySchema,
  foldUnstoredFindingsIntoSummaryJson,
  validationFindingsFromRunBody,
} from "./validation.js";

describe("API body schemas", () => {
  it("accepts a valid allocation run body", () => {
    const parsed = parseBody(allocationRunBodySchema, {
      runId: "run1",
      examCycleId: "ec1",
      module: "THEORY",
      results: [
        {
          teacherId: "t1",
          centreId: "c1",
          dutyTypeCode: "CHIEF",
          roleCode: "CHIEF",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
        },
      ],
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects unknown allocation modules", () => {
    const parsed = parseBody(allocationRunBodySchema, {
      runId: "run1",
      examCycleId: "ec1",
      module: "OTHER",
    });
    expect(parsed.ok).toBe(false);
  });

  it("keeps generate date/duty aliases and maps them onto persist slots", () => {
    const parsed = parseBody(allocationRunBodySchema, {
      runId: "run1",
      examCycleId: "ec1",
      module: "THEORY",
      validationIssues: [
        {
          ruleCode: "RULE-THEORY-DISTANCE",
          severity: "ERROR",
          message: "Too far",
          teacherId: "t1",
          centreId: "c1",
          date: "2027-03-15",
          duty: "CHIEF_EXAMINATION",
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const issue = parsed.data.validationIssues?.[0];
    expect(issue?.date).toBe("2027-03-15");
    expect(issue?.duty).toBe("CHIEF_EXAMINATION");
    const findings = validationFindingsFromRunBody(parsed.data);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.examDate).toBe("2027-03-15");
    expect(findings[0]?.sessionCode).toBeUndefined();
    expect(
      (findings[0]?.details as { duty?: string } | undefined)?.duty,
    ).toBe("CHIEF_EXAMINATION");
  });

  it("does not store the same conflict twice when generate posts issues + conflicts", () => {
    const parsed = parseBody(allocationRunBodySchema, {
      runId: "run1",
      examCycleId: "ec1",
      module: "THEORY",
      validationIssues: [
        {
          ruleCode: "RULE-CONFLICT-SESSION",
          severity: "ERROR",
          message: "Teacher has multiple duties in the same date and session",
          teacherId: "t1",
          date: "2027-03-15",
          duty: "THEORY,HALL",
        },
      ],
      conflicts: [
        {
          ruleCode: "RULE-CONFLICT-SESSION",
          severity: "ERROR",
          message: "Teacher has multiple duties in the same date and session",
          teacherId: "t1",
          date: "2027-03-15",
          session: "MORNING",
          duties: ["THEORY", "HALL"],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const findings = validationFindingsFromRunBody(parsed.data);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.examDate).toBe("2027-03-15");
    expect(findings[0]?.sessionCode).toBe("MORNING");
    expect(
      (findings[0]?.details as { duties?: string[] } | undefined)?.duties,
    ).toEqual(["THEORY", "HALL"]);
  });

  it("keeps same-message shortages that differ by centre or requirement", () => {
    const parsed = parseBody(allocationRunBodySchema, {
      runId: "run1",
      examCycleId: "ec1",
      module: "HALL",
      validationIssues: [
        {
          ruleCode: "RULE-HALL-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
          centreId: "c1",
          details: { centreId: "c1", required: 5, eligible: 1, shortage: 4 },
        },
        {
          ruleCode: "RULE-HALL-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
          centreId: "c2",
          details: { centreId: "c2", required: 6, eligible: 2, shortage: 4 },
        },
        {
          ruleCode: "RULE-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
          details: {
            requirementKey: "c1-CHIEF",
            required: 1,
            eligible: 0,
            shortage: 1,
          },
        },
        {
          ruleCode: "RULE-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
          details: {
            requirementKey: "c2-CHIEF",
            required: 1,
            eligible: 0,
            shortage: 1,
          },
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const findings = validationFindingsFromRunBody(parsed.data);
    const hall = findings.filter((f) => f.ruleCode === "RULE-HALL-SHORTAGE");
    const theory = findings.filter((f) => f.ruleCode === "RULE-SHORTAGE");
    expect(hall).toHaveLength(2);
    expect(theory).toHaveLength(2);
    expect(hall.map((f) => f.centreId).sort()).toEqual(["c1", "c2"]);
    expect(
      theory
        .map((f) => (f.details as { requirementKey?: string }).requirementKey)
        .sort(),
    ).toEqual(["c1-CHIEF", "c2-CHIEF"]);
  });

  it("folds unstored findings into summary.issues without inventing from errors", () => {
    const folded = foldUnstoredFindingsIntoSummaryJson(
      JSON.stringify({ errors: 1, feasible: false }),
      [
        {
          ruleCode: "RULE-PRACTICAL-INFEASIBLE",
          severity: "ERROR",
          message: "NO VALID SCHEDULE — no available dates",
        },
      ],
    );
    expect(JSON.parse(folded)).toEqual({
      errors: 1,
      feasible: false,
      issues: [
        {
          ruleCode: "RULE-PRACTICAL-INFEASIBLE",
          severity: "ERROR",
          message: "NO VALID SCHEDULE — no available dates",
        },
      ],
    });
    expect(
      foldUnstoredFindingsIntoSummaryJson(JSON.stringify({ errors: 1 }), []),
    ).toBe(JSON.stringify({ errors: 1 }));
    const existing = JSON.stringify({
      errors: 1,
      issues: [{ ruleCode: "KEEP", severity: "ERROR", message: "already" }],
    });
    expect(
      foldUnstoredFindingsIntoSummaryJson(existing, [
        {
          ruleCode: "RULE-PRACTICAL-INFEASIBLE",
          severity: "ERROR",
          message: "dropped",
        },
      ]),
    ).toBe(existing);
  });

  it("keeps same-day conflicts that already have different sessions", () => {
    const parsed = parseBody(allocationRunBodySchema, {
      runId: "run1",
      examCycleId: "ec1",
      module: "THEORY",
      conflicts: [
        {
          ruleCode: "RULE-CONFLICT-SESSION",
          severity: "ERROR",
          message: "Teacher has multiple duties in the same date and session",
          teacherId: "t1",
          date: "2027-03-15",
          session: "MORNING",
          duties: ["THEORY", "HALL"],
        },
        {
          ruleCode: "RULE-CONFLICT-SESSION",
          severity: "ERROR",
          message: "Teacher has multiple duties in the same date and session",
          teacherId: "t1",
          date: "2027-03-15",
          session: "AFTERNOON",
          duties: ["PRACTICAL_INTERNAL", "HALL"],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const findings = validationFindingsFromRunBody(parsed.data);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.sessionCode).sort()).toEqual([
      "AFTERNOON",
      "MORNING",
    ]);
  });

  it("accepts validation issues and conflict findings on allocation runs", () => {
    const parsed = parseBody(allocationRunBodySchema, {
      runId: "run1",
      examCycleId: "ec1",
      module: "THEORY",
      validationIssues: [
        {
          ruleCode: "RULE-VALIDATOR-DUP",
          severity: "ERROR",
          message: "Duplicate",
          teacherId: "t1",
        },
      ],
      conflicts: [
        {
          ruleCode: "RULE-CONFLICT-SESSION",
          severity: "ERROR",
          message: "Overlap",
          teacherId: "t1",
          date: "2027-03-15",
          session: "MORNING",
          duties: ["THEORY", "HALL"],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
  });

  it("requires publish examCycleId and academicYear", () => {
    expect(parseBody(publishRunBodySchema, {}).ok).toBe(false);
    expect(
      parseBody(publishRunBodySchema, {
        examCycleId: "ec1",
        academicYear: "2027",
      }).ok,
    ).toBe(true);
  });

  it("requires adminConfirmed literal true on restore", () => {
    expect(
      parseBody(restoreBodySchema, {
        payload: { teachers: [] },
        adminConfirmed: false,
      }).ok,
    ).toBe(false);
    expect(
      parseBody(restoreBodySchema, {
        payload: { teachers: [] },
        adminConfirmed: true,
      }).ok,
    ).toBe(true);
  });

  it("passes the restore payload through unchanged", () => {
    const payload = {
      teachers: [{ teacherId: "t1" }],
      teacher_exemptions: [{ id: "ex1", teacherId: "t1", reason: "Medical" }],
      audit_logs: [{ audit_id: "a1", action: "BACKUP" }],
      exam_cycles: [{ exam_cycle_id: "ec1" }],
    };
    const parsed = parseBody(restoreBodySchema, {
      payload,
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.payload).toEqual(payload);
      expect(parsed.data.includeHistory).toBe(false);
    }
  });

  it("requires override reason", () => {
    expect(
      parseBody(manualOverrideBodySchema, {
        runId: "r",
        requirementKey: "k",
        centreId: "c",
        oldTeacherId: "a",
        newTeacherId: "b",
        reason: "",
      }).ok,
    ).toBe(false);
  });

  it("requires non-empty teachers on import apply", () => {
    expect(parseBody(importApplyBodySchema, { teachers: [] }).ok).toBe(false);
    expect(
      parseBody(importApplyBodySchema, {
        teachers: [
          {
            employee_code: "SYN1",
            name: "T",
            school_id: "s1",
            designation: "HM",
          },
        ],
      }).ok,
    ).toBe(true);
    expect(
      parseBody(importApplyBodySchema, {
        examCycleId: "ec1",
        teachers: [
          {
            employee_code: "SYN1",
            name: "T",
            school_id: "s1",
            designation: "HM",
          },
        ],
      }).ok,
    ).toBe(true);
  });

  it("validates export record type", () => {
    expect(parseBody(exportRecordBodySchema, { exportType: "" }).ok).toBe(false);
    expect(
      parseBody(exportRecordBodySchema, {
        exportType: "teacher-wise-xlsx",
        examCycleId: "ec1",
      }).ok,
    ).toBe(true);
  });
});
