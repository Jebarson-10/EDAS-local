import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS, type Teacher } from "@exam-duty/shared";
import { schedulePractical } from "./schedule.js";

const teacher = (
  teacherId: string,
  employeeCode: string,
  schoolId: string,
): Teacher => ({
  teacherId,
  employeeCode,
  name: teacherId,
  schoolId,
  designation: "PG",
  isActive: true,
  dataQuality: "Confirmed",
});

describe("practical scheduling", () => {
  it("never uses office staff as practical internal or external examiners", () => {
    const officeInternal: Teacher = {
      ...teacher("office-internal", "A-OFFICE", "host"),
      staffCategory: "NON_TEACHING",
      designation: "Junior Assistant",
    };
    const officeExternal: Teacher = {
      ...teacher("office-external", "B-OFFICE", "outside"),
      staffCategory: "NON_TEACHING",
      designation: "Record Clerk",
    };
    const result = schedulePractical(
      [{ schoolId: "host", subjectId: "bio", studentCount: 40 }],
      {
        teachers: [
          officeInternal,
          officeExternal,
          teacher("teaching-internal", "Z-INTERNAL", "host"),
          teacher("teaching-external", "Z-EXTERNAL", "outside"),
        ],
        exemptions: [],
        calendar: [],
        pairHistory: [],
        availableDates: ["2027-03-01"],
        asOfDate: "2027-03-01",
        academicYear: "2027",
        // These callbacks intentionally only check school. The scheduler must
        // still enforce staff group independently of a caller's callback.
        internalEligible: (candidate, schoolId) => candidate.schoolId === schoolId,
        externalEligible: (candidate, schoolId) => candidate.schoolId !== schoolId,
      },
      DEFAULT_RULE_PARAMETERS,
    );

    expect(result.feasible).toBe(true);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0]).toMatchObject({
      internalExaminerId: "teaching-internal",
      externalExaminerId: "teaching-external",
    });
  });

  it("runs different subject groups in parallel while keeping each subject's batches sequential", () => {
    const result = schedulePractical(
      [
        { schoolId: "host", subjectId: "bio", studentCount: 100 },
        { schoolId: "host", subjectId: "computer", studentCount: 100 },
        { schoolId: "host", subjectId: "vocational", studentCount: 100 },
      ],
      {
        teachers: [
          teacher("i-bio", "I1", "host"), teacher("i-computer", "I2", "host"), teacher("i-vocational", "I3", "host"),
          teacher("e-bio", "E1", "outside"), teacher("e-computer", "E2", "outside"), teacher("e-vocational", "E3", "outside"),
        ],
        exemptions: [],
        calendar: [],
        pairHistory: [],
        availableDates: ["2027-03-01", "2027-03-02"],
        asOfDate: "2027-03-01",
        academicYear: "2027",
        internalEligible: (candidate, schoolId, subjectId) =>
          candidate.teacherId === `i-${subjectId}` && candidate.schoolId === schoolId,
        externalEligible: (candidate, _schoolId, subjectId) =>
          candidate.teacherId === `e-${subjectId}`,
      },
      { ...DEFAULT_RULE_PARAMETERS, practical_batch_size: 50, practical_completion_days: 2 },
    );

    expect(result.feasible).toBe(true);
    expect(result.schedules).toHaveLength(6);
    const firstBatches = result.schedules.filter((item) => item.batchKey.endsWith("|1"));
    const secondBatches = result.schedules.filter((item) => item.batchKey.endsWith("|2"));
    expect(new Set(firstBatches.map((item) => `${item.examDate}|${item.sessionCode}`))).toEqual(
      new Set(["2027-03-01|MORNING"]),
    );
    expect(new Set(secondBatches.map((item) => `${item.examDate}|${item.sessionCode}`))).toEqual(
      new Set(["2027-03-01|AFTERNOON"]),
    );
  });
});
