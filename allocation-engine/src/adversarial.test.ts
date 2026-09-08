/**
 * Adversarial cases from master spec §99 — each must be handled explicitly.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS, type Teacher } from "@exam-duty/shared";
import {
  allocateTheory,
  schedulePractical,
  type TheoryDataset,
} from "@exam-duty/allocation-engine";

const rules = { ...DEFAULT_RULE_PARAMETERS };

function t(
  p: Partial<Teacher> & Pick<Teacher, "teacherId" | "employeeCode" | "schoolId" | "designation">,
): Teacher {
  return {
    name: p.teacherId,
    isActive: true,
    dataQuality: "Confirmed",
    homeLatitude: 11.34,
    homeLongitude: 77.72,
    seniorityRank: 1,
    ...p,
  };
}

function ds(partial: Partial<TheoryDataset>): TheoryDataset {
  return {
    teachers: [],
    schools: [
      {
        schoolId: "s1",
        schoolCode: "S1",
        schoolName: "S1",
        blockId: "b1",
        latitude: 11.34,
        longitude: 77.72,
        active: true,
      },
      {
        schoolId: "s2",
        schoolCode: "S2",
        schoolName: "S2",
        blockId: "b1",
        latitude: 11.35,
        longitude: 77.73,
        active: true,
      },
      {
        schoolId: "s3",
        schoolCode: "S3",
        schoolName: "S3",
        blockId: "b1",
        latitude: 11.36,
        longitude: 77.74,
        active: true,
      },
    ],
    centres: [
      {
        centreId: "c1",
        centreCode: "C1",
        centreName: "C1",
        blockId: "b1",
        latitude: 11.34,
        longitude: 77.72,
        active: true,
      },
    ],
    relationships: [
      {
        centreId: "c1",
        schoolId: "s1",
        relationshipType: "HOST",
        effectiveFrom: "2020-01-01",
      },
    ],
    exemptions: [],
    history: [],
    calendar: [],
    academicYear: "2027",
    asOfDate: "2027-03-01",
    ...partial,
  };
}

const req = [
  {
    requirementKey: "r1",
    centreId: "c1",
    roleCode: "CHIEF_EXAMINATION",
    examDate: "2027-03-10",
    sessionCode: "MORNING" as const,
    preferredDesignations: ["HM"],
    fallbackDesignations: ["SENIOR_PG"],
  },
];

describe("adversarial cases", () => {
  it("Case 1: No HM available → fallback or shortage surfaced", () => {
    const result = allocateTheory(
      req,
      ds({
        teachers: [t({ teacherId: "t1", employeeCode: "E1", schoolId: "s2", designation: "SENIOR_PG" })],
      }),
      rules,
    );
    expect(result.assignments[0]?.usedFallbackBand).toBe(true);
  });

  it("Case 2: Insufficient PG teachers → NO FEASIBLE ALLOCATION", () => {
    const result = allocateTheory(
      req,
      ds({
        teachers: [t({ teacherId: "t1", employeeCode: "E1", schoolId: "s1", designation: "HM" })],
      }),
      rules,
    );
    // only HM is at own school → ineligible
    expect(result.feasible).toBe(false);
    expect(result.shortages[0]?.message).toContain("NO FEASIBLE");
  });

  it("Case 5: All candidates exempted", () => {
    const result = allocateTheory(
      req,
      ds({
        teachers: [t({ teacherId: "t1", employeeCode: "E1", schoolId: "s2", designation: "HM" })],
        exemptions: [
          {
            teacherId: "t1",
            isExempted: true,
            reason: "Exempt",
            effectiveFrom: "2020-01-01",
          },
        ],
      }),
      rules,
    );
    expect(result.feasible).toBe(false);
  });

  it("Case 6: Three schools share one centre — clubbing excludes all three", () => {
    const result = allocateTheory(
      req,
      ds({
        relationships: [
          { centreId: "c1", schoolId: "s1", relationshipType: "HOST", effectiveFrom: "2020-01-01" },
          { centreId: "c1", schoolId: "s2", relationshipType: "CLUBBED", effectiveFrom: "2020-01-01" },
          { centreId: "c1", schoolId: "s3", relationshipType: "CLUBBED", effectiveFrom: "2020-01-01" },
        ],
        teachers: [
          t({ teacherId: "t1", employeeCode: "E1", schoolId: "s1", designation: "HM" }),
          t({ teacherId: "t2", employeeCode: "E2", schoolId: "s2", designation: "HM" }),
          t({ teacherId: "t3", employeeCode: "E3", schoolId: "s3", designation: "HM" }),
        ],
      }),
      rules,
    );
    expect(result.feasible).toBe(false);
  });

  it("Case 9: Simultaneous duty conflict", () => {
    const result = allocateTheory(
      req,
      ds({
        teachers: [t({ teacherId: "t1", employeeCode: "E1", schoolId: "s2", designation: "HM" })],
        calendar: [
          {
            teacherId: "t1",
            date: "2027-03-10",
            session: "MORNING",
            dutyType: "HALL_INVIGILATOR",
          },
        ],
      }),
      rules,
    );
    expect(result.feasible).toBe(false);
  });

  it("Case 10: Practical cannot finish within window", () => {
    const result = schedulePractical(
      [{ schoolId: "s1", subjectId: "phy", studentCount: 250 }],
      {
        teachers: [
          t({ teacherId: "i1", employeeCode: "I1", schoolId: "s1", designation: "PG" }),
          t({ teacherId: "e1", employeeCode: "E1", schoolId: "s2", designation: "PG" }),
        ],
        exemptions: [],
        calendar: [],
        pairHistory: [],
        availableDates: ["2027-03-01"],
        asOfDate: "2027-03-01",
        academicYear: "2027",
        internalEligible: (x, schoolId) => x.schoolId === schoolId,
        externalEligible: (x, schoolId) => x.schoolId !== schoolId,
      },
      { ...rules, practical_batch_size: 50, practical_completion_days: 1 },
    );
    expect(result.feasible).toBe(false);
    expect(result.message).toContain("NO VALID SCHEDULE");
  });

  it("Case 4: Teacher worked all nearby centres in lookback", () => {
    const result = allocateTheory(
      req,
      ds({
        teachers: [t({ teacherId: "t1", employeeCode: "E1", schoolId: "s2", designation: "HM" })],
        history: [
          {
            teacherId: "t1",
            centreId: "c1",
            dutyTypeCode: "CHIEF_EXAMINATION",
            examDate: "2026-03-01",
            sessionCode: "MORNING",
            academicYear: "2026",
          },
        ],
      }),
      rules,
    );
    expect(result.feasible).toBe(false);
  });

  it("Case 3: every nearby centre prohibited by distance", () => {
    const result = allocateTheory(
      req,
      ds({
        teachers: [
          t({
            teacherId: "t1",
            employeeCode: "E1",
            schoolId: "s2",
            designation: "HM",
            homeLatitude: 12.5,
            homeLongitude: 79.0,
          }),
        ],
        schools: [
          {
            schoolId: "s2",
            schoolCode: "S2",
            schoolName: "S2",
            blockId: "b1",
            latitude: 12.5,
            longitude: 79.0,
            active: true,
          },
        ],
      }),
      rules,
    );
    expect(result.feasible).toBe(false);
  });

  it("Case 7/8: teacher transfer — current school used for clubbing, history retained separately", () => {
    const result = allocateTheory(
      req,
      ds({
        teachers: [
          t({
            teacherId: "t1",
            employeeCode: "E1",
            schoolId: "s2", // transferred away from host school s1
            designation: "HM",
          }),
        ],
        history: [],
      }),
      rules,
    );
    expect(result.assignments[0]?.teacherId).toBe("t1");
  });

  it("Case 11: annual role switch preferred for practical pair", () => {
    const result = schedulePractical(
      [{ schoolId: "s1", subjectId: "phy", studentCount: 40 }],
      {
        teachers: [
          t({ teacherId: "a", employeeCode: "A1", schoolId: "s1", designation: "PG" }),
          t({ teacherId: "b", employeeCode: "B1", schoolId: "s2", designation: "PG" }),
        ],
        exemptions: [],
        calendar: [],
        pairHistory: [
          {
            teacherAId: "a",
            teacherBId: "b",
            subjectId: "phy",
            schoolId: "s1",
            academicYear: "2026",
            internalTeacherId: "a",
            externalTeacherId: "b",
          },
        ],
        availableDates: ["2027-03-01", "2027-03-02", "2027-03-03"],
        asOfDate: "2027-03-01",
        academicYear: "2027",
        internalEligible: (x, schoolId) => x.schoolId === schoolId || x.teacherId === "b",
        externalEligible: (x, schoolId) => x.schoolId !== schoolId || x.teacherId === "a",
      },
      rules,
    );
    expect(result.feasible).toBe(true);
    expect(result.schedules[0]?.roleSwitchApplied).toBe(true);
    expect(result.schedules[0]?.internalExaminerId).toBe("b");
    expect(result.schedules[0]?.externalExaminerId).toBe("a");
  });

  it("Case 12/13: import duplicates and school change detected in preview", async () => {
    const { previewTeacherImport } = await import("@exam-duty/shared");
    const preview = previewTeacherImport(
      [
        { employeeCode: "E1", name: "Ann", schoolCode: "S2", designation: "HM" },
        { employeeCode: "E1", name: "Dup", schoolCode: "S2", designation: "HM" },
      ],
      [
        {
          employeeCode: "E1",
          name: "Ann",
          schoolCode: "S1",
          designation: "HM",
          isActive: true,
        },
      ],
    );
    expect(preview.duplicates).toBe(1);
    expect(preview.updatedTeachers).toBe(1);
  });

  it("Case 14: DB has teachers absent from Excel — missing flagged, not deleted", async () => {
    const { previewTeacherImport } = await import("@exam-duty/shared");
    const preview = previewTeacherImport(
      [{ employeeCode: "E1", name: "Ann", schoolCode: "S1", designation: "HM" }],
      [
        {
          employeeCode: "E1",
          name: "Ann",
          schoolCode: "S1",
          designation: "HM",
          isActive: true,
        },
        {
          employeeCode: "E9",
          name: "OnlyInDb",
          schoolCode: "S1",
          designation: "PG",
          isActive: true,
        },
      ],
    );
    expect(preview.missingFromFile).toBe(1);
  });

  it("Case 15: historical data contradicts current school — current school drives clubbing", () => {
    // Teacher currently at s2, but history shows duties while at s1; own-school
    // exclusion uses current schoolId only (transfer semantics OQ).
    const dataset = ds({
      teachers: [
        t({
          teacherId: "t1",
          employeeCode: "E1",
          schoolId: "s2",
          designation: "HM",
        }),
      ],
      relationships: [
        {
          centreId: "c1",
          schoolId: "s1",
          relationshipType: "HOST",
          effectiveFrom: "2020-01-01",
        },
      ],
      history: [
        {
          teacherId: "t1",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          examDate: "2025-03-12",
          sessionCode: "MORNING",
          academicYear: "2025",
          dataQuality: "Confirmed",
        },
      ],
      centres: [
        {
          centreId: "c1",
          centreCode: "C1",
          centreName: "C1",
          blockId: "b1",
          latitude: 11.34,
          longitude: 77.72,
          active: true,
        },
      ],
    });
    const result = allocateTheory(
      [
        {
          requirementKey: "c1-CHIEF",
          centreId: "c1",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          preferredDesignations: ["HM"],
          fallbackDesignations: ["SENIOR_PG"],
        },
      ],
      dataset,
      rules,
    );
    // Not blocked solely by historical school; may still fail distance/repeat rules.
    // Explicit assertion: eligibility does not treat historical school as current HOST.
    const assigned = result.assignments.find((a) => a.requirementKey === "c1-CHIEF");
    if (assigned) {
      expect(assigned.teacherId).toBe("t1");
    } else {
      expect(result.shortages[0]?.message ?? "").not.toMatch(/own school/i);
    }
  });
});
