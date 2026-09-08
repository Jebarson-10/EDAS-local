import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS, type Teacher } from "@exam-duty/shared";
import { allocateHall } from "./allocate.js";

const teacher = (teacherId: string, employeeCode: string, seniorityRank: number): Teacher => ({
  teacherId,
  employeeCode,
  name: teacherId,
  schoolId: "outside",
  designation: "PG",
  isActive: true,
  dataQuality: "Confirmed",
  seniorityRank,
  homeLatitude: 11.34,
  homeLongitude: 77.72,
});

describe("hall allocation", () => {
  it("rotates candidates across different sessions instead of excluding a teacher for the entire exam", () => {
    const result = allocateHall(
      [
        { centreId: "centre", totalStudents: 20, examDate: "2027-03-01", sessionCode: "MORNING" },
        { centreId: "centre", totalStudents: 20, examDate: "2027-03-02", sessionCode: "MORNING" },
      ],
      {
        teachers: [teacher("t1", "E1", 1), teacher("t2", "E2", 2)],
        schools: [
          {
            schoolId: "outside",
            schoolCode: "OUT",
            schoolName: "Outside school",
            blockId: "b1",
            latitude: 11.34,
            longitude: 77.72,
            active: true,
          },
        ],
        centres: [
          {
            centreId: "centre",
            centreCode: "C1",
            centreName: "Centre",
            blockId: "b1",
            latitude: 11.34,
            longitude: 77.72,
            active: true,
          },
        ],
        exemptions: [],
        history: [],
        calendar: [],
        academicYear: "2027",
        asOfDate: "2027-03-01",
        centreSchoolIds: new Map([["centre", new Set()]]),
      },
      { ...DEFAULT_RULE_PARAMETERS, standby_percentage: 0 },
    );

    expect(result.feasible).toBe(true);
    expect(result.assignments.map((assignment) => assignment.teacherId)).toEqual(["t1", "t2"]);
  });
});
