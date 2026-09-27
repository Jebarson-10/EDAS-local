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

  it("does not use non-teaching office staff as hall invigilators", () => {
    const officeStaff = {
      ...teacher("office", "O1", 1),
      staffCategory: "NON_TEACHING" as const,
    };
    const teachingStaff = teacher("teacher", "T1", 2);
    const result = allocateHall(
      [{ centreId: "centre", totalStudents: 20, examDate: "2027-03-01", sessionCode: "MORNING" }],
      {
        teachers: [officeStaff, teachingStaff],
        schools: [{ schoolId: "outside", schoolCode: "OUT", schoolName: "Outside school", blockId: "b1", latitude: 11.34, longitude: 77.72, active: true }],
        centres: [{ centreId: "centre", centreCode: "C1", centreName: "Centre", blockId: "b1", latitude: 11.34, longitude: 77.72, active: true }],
        exemptions: [], history: [], calendar: [], academicYear: "2027", asOfDate: "2027-03-01",
        centreSchoolIds: new Map([["centre", new Set()]]),
      },
      { ...DEFAULT_RULE_PARAMETERS, standby_percentage: 0 },
    );
    expect(result.assignments.map((assignment) => assignment.teacherId)).toEqual(["teacher"]);
  });

  it("uses SGT teachers only after the regular hall pool is not enough", () => {
    const regular = teacher("regular", "R1", 9);
    const sgt: Teacher = {
      ...teacher("sgt", "S1", 1),
      designation: "SGT",
    };
    const dataset = {
      teachers: [regular, sgt],
      schools: [{ schoolId: "outside", schoolCode: "OUT", schoolName: "Outside school", blockId: "b1", latitude: 11.34, longitude: 77.72, active: true }],
      centres: [{ centreId: "centre", centreCode: "C1", centreName: "Centre", blockId: "b1", latitude: 11.34, longitude: 77.72, active: true }],
      exemptions: [], history: [], calendar: [], academicYear: "2027", asOfDate: "2027-03-01",
      centreSchoolIds: new Map([["centre", new Set<string>()]]),
    };

    const regularOnly = allocateHall(
      [{ centreId: "centre", totalStudents: 20, examDate: "2027-03-01", sessionCode: "MORNING" }],
      dataset,
      { ...DEFAULT_RULE_PARAMETERS, standby_percentage: 0 },
    );
    expect(regularOnly.assignments.map((assignment) => assignment.teacherId)).toEqual(["regular"]);

    const reserveNeeded = allocateHall(
      [{ centreId: "centre", totalStudents: 40, examDate: "2027-03-01", sessionCode: "MORNING" }],
      dataset,
      { ...DEFAULT_RULE_PARAMETERS, standby_percentage: 0 },
    );
    expect(reserveNeeded.assignments.map((assignment) => assignment.teacherId)).toEqual(["regular", "sgt"]);
  });

  it("allows SPL teachers to support hall invigilation", () => {
    const spl: Teacher = {
      ...teacher("spl", "SPL1", 1),
      designation: "SPECIAL_TEACHER",
    };
    const result = allocateHall(
      [{ centreId: "centre", totalStudents: 20, examDate: "2027-03-01", sessionCode: "MORNING" }],
      {
        teachers: [spl],
        schools: [{ schoolId: "outside", schoolCode: "OUT", schoolName: "Outside school", blockId: "b1", latitude: 11.34, longitude: 77.72, active: true }],
        centres: [{ centreId: "centre", centreCode: "C1", centreName: "Centre", blockId: "b1", latitude: 11.34, longitude: 77.72, active: true }],
        exemptions: [], history: [], calendar: [], academicYear: "2027", asOfDate: "2027-03-01",
        centreSchoolIds: new Map([["centre", new Set<string>()]]),
      },
      { ...DEFAULT_RULE_PARAMETERS, standby_percentage: 0 },
    );
    expect(result.assignments.map((assignment) => assignment.teacherId)).toEqual(["spl"]);
  });
});
