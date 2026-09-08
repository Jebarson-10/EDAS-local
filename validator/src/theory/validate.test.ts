import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS } from "@exam-duty/shared";
import {
  allocateTheory,
  schedulePractical,
  type TheoryDataset,
} from "@exam-duty/allocation-engine";
import { validateTheoryAllocation, validatePracticalAllocation, detectSessionConflicts } from "../index.js";

describe("independent theory validator", () => {
  it("flags own-school assignment as ERROR even if injected", () => {
    const dataset: TheoryDataset = {
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E001",
          name: "A",
          schoolId: "s1",
          designation: "HM",
          isActive: true,
          dataQuality: "Confirmed",
          homeLatitude: 11.34,
          homeLongitude: 77.72,
        },
      ],
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
    };
    const requirements = [
      {
        requirementKey: "r1",
        centreId: "c1",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-10",
        sessionCode: "MORNING" as const,
        preferredDesignations: ["HM"],
        fallbackDesignations: [],
      },
    ];
    const forged = {
      algorithmVersion: "test",
      assignments: [
        {
          requirementKey: "r1",
          centreId: "c1",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-10",
          sessionCode: "MORNING" as const,
          teacherId: "t1",
          employeeCode: "E001",
          score: 0,
          usedFallbackBand: false,
          decisionTrace: {
            teacherId: "t1",
            targetId: "c1",
            eligibility: "PASS" as const,
            reasons: [],
            score: 0,
            selectedBecause: "forged",
          },
        },
      ],
      shortages: [],
      candidateMatrixSize: 0,
      feasible: true,
    };
    const v = validateTheoryAllocation(requirements, forged, dataset, DEFAULT_RULE_PARAMETERS);
    expect(v.status).toBe("INVALID");
    expect(v.issues.some((i) => i.ruleCode === "RULE-THEORY-OWN-SCHOOL")).toBe(true);
  });

  it("accepts a clean engine result", () => {
    const dataset: TheoryDataset = {
      teachers: [
        {
          teacherId: "t2",
          employeeCode: "E002",
          name: "B",
          schoolId: "s2",
          designation: "HM",
          isActive: true,
          dataQuality: "Confirmed",
          homeLatitude: 11.341,
          homeLongitude: 77.721,
          seniorityRank: 1,
        },
      ],
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
          latitude: 11.341,
          longitude: 77.721,
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
    };
    const requirements = [
      {
        requirementKey: "r1",
        centreId: "c1",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-10",
        sessionCode: "MORNING" as const,
        preferredDesignations: ["HM"],
        fallbackDesignations: [],
      },
    ];
    const result = allocateTheory(requirements, dataset, DEFAULT_RULE_PARAMETERS);
    const v = validateTheoryAllocation(requirements, result, dataset, DEFAULT_RULE_PARAMETERS);
    expect(v.status).toBe("VALID");
  });
});

describe("conflict engine", () => {
  it("detects same session collision", () => {
    const findings = detectSessionConflicts([
      {
        teacherId: "t1",
        date: "2027-03-10",
        session: "MORNING",
        dutyType: "THEORY",
      },
      {
        teacherId: "t1",
        date: "2027-03-10",
        session: "MORNING",
        dutyType: "HALL",
      },
    ]);
    expect(findings).toHaveLength(1);
  });
});

describe("practical validator", () => {
  it("rejects schedules exceeding completion window", () => {
    const result = schedulePractical(
      [{ schoolId: "s1", subjectId: "phy", studentCount: 200 }],
      {
        teachers: [
          {
            teacherId: "i1",
            employeeCode: "I1",
            name: "Int",
            schoolId: "s1",
            designation: "PG",
            isActive: true,
            dataQuality: "Confirmed",
          },
          {
            teacherId: "e1",
            employeeCode: "E1",
            name: "Ext",
            schoolId: "s2",
            designation: "PG",
            isActive: true,
            dataQuality: "Confirmed",
          },
        ],
        exemptions: [],
        calendar: [],
        pairHistory: [],
        availableDates: ["2027-03-01"],
        asOfDate: "2027-03-01",
        academicYear: "2027",
        internalEligible: (t, schoolId) => t.schoolId === schoolId,
        externalEligible: (t, schoolId) => t.schoolId !== schoolId,
      },
      { ...DEFAULT_RULE_PARAMETERS, practical_batch_size: 50, practical_completion_days: 1 },
    );
    // 200 students → 4 batches, only 2 slots in 1 day → infeasible
    expect(result.feasible).toBe(false);
    const v = validatePracticalAllocation(result, DEFAULT_RULE_PARAMETERS);
    expect(v.status).toBe("INVALID");
  });
});
