import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS } from "@exam-duty/shared";
import { allocateHall } from "@exam-duty/allocation-engine";
import { validateHallAllocation } from "./validate.js";

describe("hall validator", () => {
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
});
