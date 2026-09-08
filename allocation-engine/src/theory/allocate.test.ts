import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS, type Teacher } from "@exam-duty/shared";
import {
  allocateTheory,
  balanceBatches,
  calculateHallRequirements,
  DeterministicSolverAdapter,
  type TheoryDataset,
  type TheoryRequirement,
} from "../index.js";

const rules = { ...DEFAULT_RULE_PARAMETERS };

function teacher(partial: Partial<Teacher> & Pick<Teacher, "teacherId" | "employeeCode" | "name" | "schoolId" | "designation">): Teacher {
  return {
    isActive: true,
    dataQuality: "Confirmed",
    homeLatitude: 11.34,
    homeLongitude: 77.72,
    seniorityRank: 100,
    ...partial,
  };
}

function baseDataset(overrides: Partial<TheoryDataset> = {}): TheoryDataset {
  return {
    teachers: [
      teacher({
        teacherId: "t1",
        employeeCode: "E001",
        name: "Alpha HM",
        schoolId: "s1",
        designation: "HM",
        seniorityRank: 1,
        homeLatitude: 11.341,
        homeLongitude: 77.721,
      }),
      teacher({
        teacherId: "t2",
        employeeCode: "E002",
        name: "Beta PG",
        schoolId: "s2",
        designation: "SENIOR_PG",
        seniorityRank: 2,
        homeLatitude: 11.342,
        homeLongitude: 77.722,
      }),
      teacher({
        teacherId: "t3",
        employeeCode: "E003",
        name: "Gamma HM",
        schoolId: "s3",
        designation: "HM",
        seniorityRank: 3,
        homeLatitude: 11.343,
        homeLongitude: 77.723,
      }),
    ],
    schools: [
      {
        schoolId: "s1",
        schoolCode: "S1",
        schoolName: "School 1",
        blockId: "b1",
        latitude: 11.341,
        longitude: 77.721,
        active: true,
      },
      {
        schoolId: "s2",
        schoolCode: "S2",
        schoolName: "School 2",
        blockId: "b1",
        latitude: 11.342,
        longitude: 77.722,
        active: true,
      },
      {
        schoolId: "s3",
        schoolCode: "S3",
        schoolName: "School 3",
        blockId: "b1",
        latitude: 11.343,
        longitude: 77.723,
        active: true,
      },
    ],
    centres: [
      {
        centreId: "c1",
        centreCode: "C1",
        centreName: "Centre 1",
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
    ...overrides,
  };
}

describe("theory allocation", () => {
  it("is deterministic for same inputs", () => {
    const dataset = baseDataset();
    const requirements: TheoryRequirement[] = [
      {
        requirementKey: "c1-chief",
        centreId: "c1",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-10",
        sessionCode: "MORNING",
        preferredDesignations: ["HM"],
        fallbackDesignations: ["SENIOR_PG"],
      },
    ];
    const a = allocateTheory(requirements, dataset, rules);
    const b = allocateTheory(requirements, dataset, rules);
    expect(a).toEqual(b);
    expect(a.assignments[0]?.teacherId).toBe("t3"); // t1 excluded own school; t3 HM preferred over fallback
  });

  it("excludes repeat centre from history without current excel", () => {
    const dataset = baseDataset({
      history: [
        {
          teacherId: "t3",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          examDate: "2026-03-10",
          sessionCode: "MORNING",
          academicYear: "2026",
        },
        {
          teacherId: "t2",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          examDate: "2025-03-10",
          sessionCode: "MORNING",
          academicYear: "2025",
        },
      ],
    });
    const requirements: TheoryRequirement[] = [
      {
        requirementKey: "c1-chief",
        centreId: "c1",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-10",
        sessionCode: "MORNING",
        preferredDesignations: ["HM", "SENIOR_PG"],
        fallbackDesignations: [],
      },
    ];
    const result = allocateTheory(requirements, dataset, rules);
    // t1 own school, t3 and t2 repeat centre → shortage
    expect(result.feasible).toBe(false);
    expect(result.shortages[0]?.message).toContain("NO FEASIBLE ALLOCATION");
  });

  it("surfaces HM shortage and uses senior PG fallback explicitly", () => {
    const dataset = baseDataset({
      teachers: [
        teacher({
          teacherId: "t1",
          employeeCode: "E001",
          name: "Alpha HM",
          schoolId: "s1",
          designation: "HM",
        }),
        teacher({
          teacherId: "t2",
          employeeCode: "E002",
          name: "Beta PG",
          schoolId: "s2",
          designation: "SENIOR_PG",
        }),
      ],
    });
    const requirements: TheoryRequirement[] = [
      {
        requirementKey: "c1-chief",
        centreId: "c1",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-10",
        sessionCode: "MORNING",
        preferredDesignations: ["HM"],
        fallbackDesignations: ["SENIOR_PG"],
      },
    ];
    const result = allocateTheory(requirements, dataset, rules);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]?.teacherId).toBe("t2");
    expect(result.assignments[0]?.usedFallbackBand).toBe(true);
    expect(
      result.assignments[0]?.decisionTrace.reasons.some(
        (r) => r.ruleCode === "INFO-HM-FALLBACK",
      ),
    ).toBe(true);
  });

  it("uses a Senior PG from the centre block before the wider district", () => {
    const dataset = baseDataset({
      teachers: [
        teacher({
          teacherId: "t-block",
          employeeCode: "E010",
          name: "Block PG",
          schoolId: "s2",
          designation: "SENIOR_PG",
          seniorityRank: 20,
        }),
        teacher({
          teacherId: "t-district",
          employeeCode: "E011",
          name: "District PG",
          schoolId: "s4",
          designation: "SENIOR_PG",
          seniorityRank: 1,
        }),
      ],
      schools: [
        ...baseDataset().schools,
        {
          schoolId: "s4", schoolCode: "S4", schoolName: "District School", blockId: "b2",
          latitude: 11.344, longitude: 77.724, active: true,
        },
      ],
    });
    const requirements: TheoryRequirement[] = [{
      requirementKey: "c1-chief", centreId: "c1", roleCode: "CHIEF_EXAMINATION",
      examDate: "2027-03-10", sessionCode: "MORNING",
      preferredDesignations: ["HM"], fallbackDesignations: ["SENIOR_PG"],
    }];

    const result = allocateTheory(requirements, dataset, {
      ...rules, seniority_mode: "block_then_district",
    });
    expect(result.assignments[0]?.teacherId).toBe("t-block");
    expect(result.assignments[0]?.usedFallbackBand).toBe(true);
  });

  it("does not assign exempted teachers", () => {
    const dataset = baseDataset({
      exemptions: [
        {
          teacherId: "t3",
          isExempted: true,
          reason: "Medical",
          effectiveFrom: "2027-01-01",
        },
      ],
      teachers: [
        teacher({
          teacherId: "t3",
          employeeCode: "E003",
          name: "Gamma HM",
          schoolId: "s3",
          designation: "HM",
        }),
      ],
    });
    const result = allocateTheory(
      [
        {
          requirementKey: "c1-chief",
          centreId: "c1",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-10",
          sessionCode: "MORNING",
          preferredDesignations: ["HM"],
          fallbackDesignations: [],
        },
      ],
      dataset,
      rules,
    );
    expect(result.feasible).toBe(false);
  });
});

describe("practical batching", () => {
  it("balances uneven populations", () => {
    expect(balanceBatches(100, 50)).toEqual([50, 50]);
    expect(balanceBatches(120, 50)).toEqual([40, 40, 40]);
    expect(balanceBatches(30, 50)).toEqual([30]);
  });
});

describe("hall calculation", () => {
  it("computes halls and standby", () => {
    expect(calculateHallRequirements(200, 20, 10)).toEqual({
      requiredHalls: 10,
      standby: 1,
    });
  });
});

describe("solver adapter", () => {
  it("routes modules", () => {
    const solver = new DeterministicSolverAdapter();
    const out = solver.solve({
      module: "THEORY",
      requirements: [],
      dataset: baseDataset(),
      rules,
    });
    expect(out.module).toBe("THEORY");
  });
});
