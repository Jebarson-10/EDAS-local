import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS, type Teacher } from "@exam-duty/shared";
import {
  allocateTheory,
  schedulePractical,
  type TheoryAllocationResult,
  type TheoryDataset,
  type TheoryRequirement,
} from "@exam-duty/allocation-engine";
import { validateTheoryAllocation, validatePracticalAllocation, detectSessionConflicts } from "../index.js";

it.each(["PG", "BT", "SENIOR_PG", "HM", "SPECIAL_TEACHER", "OFFICE_STAFF"])("independently verifies custodian post %s", designation => {
  const requirement = makeRequirement({roleCode: "CUSTODIAN", preferredDesignations: [], fallbackDesignations: []});
  const result = validateTheoryAllocation([requirement], makeForgedResult(requirement), makeDataset({teachers: [makeTeacher({designation})]}), DEFAULT_RULE_PARAMETERS);
  expect(result.valid).toBe(["PG", "BT", "SENIOR_PG"].includes(designation) ? 1 : 0);
});

function makeTeacher(overrides: Partial<Teacher> = {}): Teacher {
  return {
    teacherId: "t1",
    employeeCode: "E001",
    name: "Teacher One",
    schoolId: "s1",
    designation: "PG",
    isActive: true,
    dataQuality: "Confirmed",
    homeLatitude: 11.341,
    homeLongitude: 77.721,
    staffCategory: "TEACHING",
    ...overrides,
  };
}

function makeDataset(overrides: Partial<TheoryDataset> = {}): TheoryDataset {
  return {
    teachers: [makeTeacher()],
    schools: [
      {
        schoolId: "s1",
        schoolCode: "S1",
        schoolName: "Teacher school",
        blockId: "b1",
        latitude: 11.341,
        longitude: 77.721,
        active: true,
      },
      {
        schoolId: "s2",
        schoolCode: "S2",
        schoolName: "Host school",
        blockId: "b1",
        latitude: 11.342,
        longitude: 77.722,
        active: true,
      },
    ],
    centres: [
      {
        centreId: "c1",
        centreCode: "C1",
        centreName: "Centre One",
        blockId: "b1",
        latitude: 11.34,
        longitude: 77.72,
        active: true,
      },
    ],
    relationships: [
      {
        centreId: "c1",
        schoolId: "s2",
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

function makeRequirement(
  overrides: Partial<TheoryRequirement> = {},
): TheoryRequirement {
  return {
    requirementKey: "r1",
    centreId: "c1",
    roleCode: "DEPARTMENT_OFFICER",
    examDate: "2027-03-10",
    sessionCode: "MORNING",
    preferredDesignations: ["PG"],
    fallbackDesignations: [],
    staffCategory: "TEACHING",
    ...overrides,
  };
}

function makeForgedResult(
  requirement: TheoryRequirement,
  teacherId = "t1",
  usedFallbackBand = false,
): TheoryAllocationResult {
  return {
    algorithmVersion: "forged",
    assignments: [
      {
        requirementKey: requirement.requirementKey,
        centreId: requirement.centreId,
        roleCode: requirement.roleCode,
        examDate: requirement.examDate,
        sessionCode: requirement.sessionCode,
        teacherId,
        employeeCode: "E001",
        score: 0,
        usedFallbackBand,
        decisionTrace: {
          teacherId,
          targetId: requirement.centreId,
          eligibility: "PASS",
          reasons: [],
          score: 0,
          selectedBecause: "forged for validator test",
        },
      },
    ],
    shortages: [],
    candidateMatrixSize: 0,
    feasible: true,
  };
}

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

  it("checks teaching and office staff roles without trusting the allocator", () => {
    const officeTeacher = makeTeacher({
      designation: "OFFICE_STAFF",
      staffCategory: "NON_TEACHING",
    });
    const officeRequirement = makeRequirement({
      roleCode: "OFFICE_STAFF",
      preferredDesignations: [],
      fallbackDesignations: [],
      staffCategory: "NON_TEACHING",
    });
    const officeResult = validateTheoryAllocation(
      [officeRequirement],
      makeForgedResult(officeRequirement),
      makeDataset({ teachers: [officeTeacher] }),
      DEFAULT_RULE_PARAMETERS,
    );
    expect(officeResult.status).toBe("VALID");

    const departmentRequirement = makeRequirement({
      preferredDesignations: ["SENIOR_PG"],
      fallbackDesignations: ["PG"],
    });
    const wronglyAssignedOfficeStaff = validateTheoryAllocation(
      [departmentRequirement],
      makeForgedResult(departmentRequirement),
      makeDataset({ teachers: [officeTeacher] }),
      DEFAULT_RULE_PARAMETERS,
    );
    expect(
      wronglyAssignedOfficeStaff.issues.some(
        (issue) => issue.ruleCode === "RULE-THEORY-STAFF-CATEGORY",
      ),
    ).toBe(true);
    expect(
      wronglyAssignedOfficeStaff.issues.some(
        (issue) => issue.ruleCode === "RULE-THEORY-ROLE",
      ),
    ).toBe(true);

    const pgTeacher = makeTeacher({ designation: "PG" });
    const validFallback = validateTheoryAllocation(
      [departmentRequirement],
      makeForgedResult(departmentRequirement, "t1", true),
      makeDataset({ teachers: [pgTeacher] }),
      DEFAULT_RULE_PARAMETERS,
    );
    expect(validFallback.status).toBe("VALID");

    const falsePreferredBand = validateTheoryAllocation(
      [departmentRequirement],
      makeForgedResult(departmentRequirement, "t1", false),
      makeDataset({ teachers: [pgTeacher] }),
      DEFAULT_RULE_PARAMETERS,
    );
    expect(
      falsePreferredBand.issues.some(
        (issue) => issue.ruleCode === "RULE-THEORY-ROLE",
      ),
    ).toBe(true);
  });

  it("includes office and custodian duties in the previous-centre check", () => {
    const requirement = makeRequirement({
      roleCode: "OFFICE_STAFF",
      preferredDesignations: [],
      fallbackDesignations: [],
      staffCategory: "NON_TEACHING",
    });
    const teacher = makeTeacher({
      designation: "OFFICE_STAFF",
      staffCategory: "NON_TEACHING",
    });

    for (const history of [
      { dutyTypeCode: "OFFICE_STAFF", roleCode: undefined },
      { dutyTypeCode: "OTHER", roleCode: "CUSTODIAN" },
    ]) {
      const validation = validateTheoryAllocation(
        [requirement],
        makeForgedResult(requirement),
        makeDataset({
          teachers: [teacher],
          history: [
            {
              teacherId: teacher.teacherId,
              centreId: "c1",
              dutyTypeCode: history.dutyTypeCode,
              roleCode: history.roleCode,
              examDate: "2026-03-10",
              sessionCode: "MORNING",
              academicYear: "2026",
              dataQuality: "Unverified",
            },
          ],
        }),
        DEFAULT_RULE_PARAMETERS,
      );
      expect(
        validation.issues.some((issue) => issue.ruleCode === "RULE-THEORY-002"),
      ).toBe(true);
      expect(
        validation.issues.some(
          (issue) => issue.ruleCode === "UNVERIFIED_HISTORY_USED",
        ),
      ).toBe(true);
    }
  });

  it("rechecks active, exemption, calendar, clubbed-school and distance constraints", () => {
    const requirement = makeRequirement();
    const cases: Array<{ dataset: TheoryDataset; ruleCode: string }> = [
      {
        dataset: makeDataset({ teachers: [makeTeacher({ isActive: false })] }),
        ruleCode: "RULE-THEORY-INACTIVE",
      },
      {
        dataset: makeDataset({
          exemptions: [
            {
              teacherId: "t1",
              isExempted: true,
              reason: "Medical",
              effectiveFrom: "2027-01-01",
            },
          ],
        }),
        ruleCode: "RULE-THEORY-EXEMPT",
      },
      {
        dataset: makeDataset({
          calendar: [
            {
              teacherId: "t1",
              date: requirement.examDate,
              session: requirement.sessionCode,
              dutyType: "HALL",
            },
          ],
        }),
        ruleCode: "RULE-THEORY-CONFLICT",
      },
      {
        dataset: makeDataset({
          relationships: [
            {
              centreId: "c1",
              schoolId: "s1",
              relationshipType: "CLUBBED",
              effectiveFrom: "2020-01-01",
            },
          ],
        }),
        ruleCode: "RULE-THEORY-OWN-SCHOOL",
      },
      {
        dataset: makeDataset({
          teachers: [makeTeacher({ homeLatitude: 12, homeLongitude: 78 })],
          schools: [
            {
              schoolId: "s1",
              schoolCode: "S1",
              schoolName: "Far teacher school",
              blockId: "b1",
              latitude: 12,
              longitude: 78,
              active: true,
            },
            {
              schoolId: "s2",
              schoolCode: "S2",
              schoolName: "Host school",
              blockId: "b1",
              latitude: 11.342,
              longitude: 77.722,
              active: true,
            },
          ],
        }),
        ruleCode: "RULE-THEORY-DISTANCE",
      },
    ];

    for (const testCase of cases) {
      const validation = validateTheoryAllocation(
        [requirement],
        makeForgedResult(requirement),
        testCase.dataset,
        DEFAULT_RULE_PARAMETERS,
      );
      expect(
        validation.issues.some((issue) => issue.ruleCode === testCase.ruleCode),
      ).toBe(true);
    }
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

    const missing = validateTheoryAllocation(
      requirements,
      { ...result, assignments: [], shortages: [] },
      dataset,
      DEFAULT_RULE_PARAMETERS,
    );
    expect(missing.issues.some((issue) => issue.ruleCode === "RULE-VALIDATOR-MISSING")).toBe(true);

    const assignment = result.assignments[0]!;
    const duplicate = validateTheoryAllocation(
      requirements,
      { ...result, assignments: [assignment, assignment] },
      dataset,
      DEFAULT_RULE_PARAMETERS,
    );
    expect(duplicate.issues.some((issue) => issue.ruleCode === "RULE-VALIDATOR-REQUIREMENT-DUP")).toBe(true);

    const laterRequirement = {
      ...requirements[0]!,
      requirementKey: "r2",
      examDate: "2027-03-11",
    };
    const laterAssignment = {
      ...assignment,
      requirementKey: "r2",
      examDate: "2027-03-11",
    };
    const laterSession = validateTheoryAllocation(
      [...requirements, laterRequirement],
      { ...result, assignments: [assignment, laterAssignment] },
      dataset,
      DEFAULT_RULE_PARAMETERS,
    );
    expect(laterSession.status).toBe("VALID");

    const identityMismatch = validateTheoryAllocation(
      requirements,
      { ...result, assignments: [{ ...assignment, roleCode: "OFFICE_STAFF" }] },
      dataset,
      DEFAULT_RULE_PARAMETERS,
    );
    expect(identityMismatch.issues.some((issue) => issue.ruleCode === "RULE-VALIDATOR-IDENTITY")).toBe(true);
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
        standard: "12",
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
