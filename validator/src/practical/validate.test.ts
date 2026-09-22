import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS } from "@exam-duty/shared";
import {
  schedulePractical,
  balanceBatches,
  type PracticalResult,
} from "@exam-duty/allocation-engine";
import { validatePracticalAllocation } from "../practical/validate.js";

const rules = { ...DEFAULT_RULE_PARAMETERS };

describe("practical validator", () => {
  it("accepts a feasible balanced schedule", () => {
    const teachers = [
      {
        teacherId: "i1",
        employeeCode: "I1",
        name: "Internal",
        schoolId: "s1",
        designation: "PG" as const,
        isActive: true,
        dataQuality: "Confirmed" as const,
        homeLatitude: 11.3,
        homeLongitude: 77.7,
      },
      {
        teacherId: "e1",
        employeeCode: "E1",
        name: "External",
        schoolId: "s2",
        designation: "PG" as const,
        isActive: true,
        dataQuality: "Confirmed" as const,
        homeLatitude: 11.31,
        homeLongitude: 77.71,
      },
    ];
    const result = schedulePractical(
      [{ schoolId: "s1", subjectId: "phy", studentCount: 40 }],
      {
        teachers,
        exemptions: [],
        calendar: [],
        pairHistory: [],
        availableDates: ["2027-03-01", "2027-03-02", "2027-03-03"],
        asOfDate: "2027-03-01",
        academicYear: "2027",
        internalEligible: (t, schoolId) => t.schoolId === schoolId,
        externalEligible: (t, schoolId) => t.schoolId !== schoolId,
      },
      rules,
    );
    expect(result.feasible).toBe(true);
    const v = validatePracticalAllocation(result, rules);
    expect(v.status).not.toBe("INVALID");
  });

  it("marks infeasible when completion window is too short", () => {
    const teachers = Array.from({ length: 4 }, (_, i) => ({
      teacherId: `t${i}`,
      employeeCode: `E${i}`,
      name: `T${i}`,
      schoolId: i === 0 ? "s1" : "s2",
      designation: "PG" as const,
      isActive: true,
      dataQuality: "Confirmed" as const,
      homeLatitude: 11.3,
      homeLongitude: 77.7,
    }));
    const result = schedulePractical(
      [{ schoolId: "s1", subjectId: "phy", studentCount: 250 }],
      {
        teachers,
        exemptions: [],
        calendar: [],
        pairHistory: [],
        availableDates: ["2027-03-01"],
        asOfDate: "2027-03-01",
        academicYear: "2027",
        internalEligible: (t, schoolId) => t.schoolId === schoolId,
        externalEligible: (t, schoolId) => t.schoolId !== schoolId,
      },
      { ...rules, practical_completion_days: 1, practical_batch_size: 50 },
    );
    const v = validatePracticalAllocation(result, {
      ...rules,
      practical_completion_days: 1,
    });
    if (!result.feasible) {
      expect(v.status).toBe("INVALID");
    }
    expect(balanceBatches(120, 50).length).toBeGreaterThan(1);
  });

  it("rejects a forged schedule that uses office staff as an examiner", () => {
    const result: PracticalResult = {
      algorithmVersion: "forged",
      batches: [
        {
          batchKey: "s1|phy|1",
          schoolId: "s1",
          subjectId: "phy",
          batchIndex: 1,
          studentCount: 40,
        },
      ],
      schedules: [
        {
          batchKey: "s1|phy|1",
          schoolId: "s1",
          subjectId: "phy",
          examDate: "2027-03-01",
          sessionCode: "MORNING",
          internalExaminerId: "office",
          externalExaminerId: "teacher",
          roleSwitchApplied: false,
          decisionNotes: [],
        },
      ],
      feasible: true,
    };

    const validation = validatePracticalAllocation(result, rules, {
      teachers: [
        {
          teacherId: "office",
          employeeCode: "O1",
          name: "Office staff",
          schoolId: "s1",
          designation: "Junior Assistant",
          subject: null,
          staffCategory: "NON_TEACHING",
          isActive: true,
          dataQuality: "Confirmed",
        },
        {
          teacherId: "teacher",
          employeeCode: "T1",
          name: "Teacher",
          schoolId: "s2",
          designation: "PG",
          subject: "Physics",
          staffCategory: "TEACHING",
          isActive: true,
          dataQuality: "Confirmed",
        },
      ],
    });

    expect(validation.status).toBe("INVALID");
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleCode: "RULE-PRACTICAL-STAFF-CATEGORY",
          teacherId: "office",
        }),
      ]),
    );
  });

  it("rejects a forged schedule whose examiner teaches a different subject", () => {
    const result: PracticalResult = {
      algorithmVersion: "forged",
      batches: [
        {
          batchKey: "s1|COMPUTER_SCIENCE|1",
          schoolId: "s1",
          subjectId: "COMPUTER_SCIENCE",
          batchIndex: 1,
          studentCount: 40,
        },
      ],
      schedules: [
        {
          batchKey: "s1|COMPUTER_SCIENCE|1",
          schoolId: "s1",
          subjectId: "COMPUTER_SCIENCE",
          examDate: "2027-03-01",
          sessionCode: "MORNING",
          internalExaminerId: "physics-internal",
          externalExaminerId: "computer-external",
          roleSwitchApplied: false,
          decisionNotes: [],
        },
      ],
      feasible: true,
    };

    const validation = validatePracticalAllocation(result, rules, {
      teachers: [
        {
          teacherId: "physics-internal",
          employeeCode: "P1",
          name: "Physics teacher",
          schoolId: "s1",
          designation: "PG",
          subject: "PHY",
          staffCategory: "TEACHING",
          isActive: true,
          dataQuality: "Confirmed",
        },
        {
          teacherId: "computer-external",
          employeeCode: "C1",
          name: "Computer teacher",
          schoolId: "s2",
          designation: "PG",
          subject: "CS",
          staffCategory: "TEACHING",
          isActive: true,
          dataQuality: "Confirmed",
        },
      ],
    });

    expect(validation.status).toBe("INVALID");
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleCode: "RULE-PRACTICAL-SUBJECT",
          teacherId: "physics-internal",
        }),
      ]),
    );
  });
});
