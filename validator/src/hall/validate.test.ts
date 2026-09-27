import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS } from "@exam-duty/shared";
import { allocateHall } from "@exam-duty/allocation-engine";
import { validateHallAllocation } from "./validate.js";

describe("hall validator", () => {
  it("allows the same teacher on different exam dates", () => {
    const result = {
      algorithmVersion: "test",
      requiredHallsByCentre: { c1: 1 },
      standbyByCentre: { c1: 1 },
      assignments: [
        { centreId: "c1", examDate: "2027-03-15", sessionCode: "MORNING" as const, roleCode: "HALL_INVIGILATOR" as const, slotIndex: 1, teacherId: "t1", employeeCode: "E1", score: 0 },
        { centreId: "c1", examDate: "2027-03-16", sessionCode: "MORNING" as const, roleCode: "HALL_INVIGILATOR" as const, slotIndex: 1, teacherId: "t1", employeeCode: "E1", score: 0 },
      ],
      shortages: [],
      feasible: true,
    };
    const validated = validateHallAllocation(result, [{ centreId: "c1", totalStudents: 20 }], DEFAULT_RULE_PARAMETERS);
    expect(validated.status).toBe("VALID");
    expect(validated.issues.find((issue) => issue.ruleCode === "RULE-HALL-DUP")).toBeUndefined();
  });

  it("recalculates hall/standby and flags shortages", () => {
    const demands = [
      {
        centreId: "c1",
        totalStudents: 200,
        examDate: "2027-03-15" as const,
        sessionCode: "MORNING" as const,
      },
    ];
    const result = allocateHall(
      demands,
      {
        teachers: Array.from({ length: 3 }, (_, i) => ({
          teacherId: `t${i}`,
          employeeCode: `E${i}`,
          name: `T${i}`,
          schoolId: "s2",
          designation: "PG",
          isActive: true,
          dataQuality: "Confirmed" as const,
          homeLatitude: 11.34,
          homeLongitude: 77.72,
        })),
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
        exemptions: [],
        history: [],
        calendar: [],
        academicYear: "2027",
        asOfDate: "2027-03-01",
        centreSchoolIds: new Map([["c1", new Set(["s1"])]]),
      },
      DEFAULT_RULE_PARAMETERS,
    );
    // 200 students / 20 = 10 halls + 1 standby = 11 needed, only 3 eligible → shortage
    expect(result.feasible).toBe(false);
    const v = validateHallAllocation(result, demands, DEFAULT_RULE_PARAMETERS);
    expect(v.status).toBe("INVALID");
    const shortageIssue = v.issues.find((i) => i.ruleCode === "RULE-HALL-SHORTAGE");
    expect(shortageIssue?.details).toMatchObject({
      centreId: "c1",
      required: expect.any(Number),
      eligible: expect.any(Number),
      shortage: expect.any(Number),
    });
  });

  it("independently rejects an ineligible hall assignment", () => {
    const result = {
      algorithmVersion: "test",
      requiredHallsByCentre: { c1: 1 },
      standbyByCentre: { c1: 0 },
      assignments: [
        {
          centreId: "c1",
          examDate: "2027-03-15",
          sessionCode: "MORNING" as const,
          roleCode: "HALL_INVIGILATOR" as const,
          slotIndex: 1,
          teacherId: "t1",
          employeeCode: "E1",
          score: 0,
        },
      ],
      shortages: [],
      feasible: true,
    };
    const validated = validateHallAllocation(
      result,
      [{ centreId: "c1", totalStudents: 20 }],
      DEFAULT_RULE_PARAMETERS,
      {
        teachers: [
          {
            teacherId: "t1",
            employeeCode: "E1",
            name: "Office helper",
            schoolId: "s2",
            designation: "LAB ASST",
            staffCategory: "NON_TEACHING",
            isActive: true,
            dataQuality: "Imported",
          },
        ],
        schools: [
          { schoolId: "s2", schoolCode: "", schoolName: "School", blockId: "b1", latitude: 11.31, longitude: 77.71, active: true },
        ],
        centres: [
          { centreId: "c1", centreCode: "C1", centreName: "Centre", blockId: "b1", latitude: 11.3, longitude: 77.7, active: true },
        ],
        exemptions: [],
        history: [],
        calendar: [],
        academicYear: "2027",
        centreSchoolIds: new Map(),
      },
    );
    expect(validated.status).toBe("INVALID");
    expect(validated.issues.some((issue) => issue.ruleCode === "RULE-HALL-STAFF-CATEGORY")).toBe(true);
  });

  it("independently rejects an unrelated teaching post for hall duty", () => {
    const result = {
      algorithmVersion: "test", requiredHallsByCentre: { c1: 1 }, standbyByCentre: { c1: 0 }, shortages: [], feasible: true,
      assignments: [{ centreId: "c1", examDate: "2027-03-15", sessionCode: "MORNING" as const, roleCode: "HALL_INVIGILATOR" as const, slotIndex: 1, teacherId: "t1", employeeCode: "E1", score: 0 }],
    };
    const validated = validateHallAllocation(
      result,
      [{ centreId: "c1", totalStudents: 20 }],
      { ...DEFAULT_RULE_PARAMETERS, hall_designation_allowlist: [] },
      {
        teachers: [{ teacherId: "t1", employeeCode: "E1", name: "Computer instructor", schoolId: "s2", designation: "COMPUTER INSTRUCTOR", staffCategory: "TEACHING", isActive: true, dataQuality: "Imported" }],
        schools: [{ schoolId: "s2", schoolCode: "", schoolName: "School", blockId: "b1", latitude: 11.31, longitude: 77.71, active: true }],
        centres: [{ centreId: "c1", centreCode: "C1", centreName: "Centre", blockId: "b1", latitude: 11.3, longitude: 77.7, active: true }],
        exemptions: [], history: [], calendar: [], academicYear: "2027", centreSchoolIds: new Map(),
      },
    );
    expect(validated.status).toBe("INVALID");
    expect(validated.issues.some((issue) => issue.ruleCode === "RULE-HALL-POST")).toBe(true);
  });
});
