import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS } from "@exam-duty/shared";
import {
  allocateHall,
  calculateHallRequirements,
} from "@exam-duty/allocation-engine";
import { validateHallAllocation } from "../hall/validate.js";

const rules = { ...DEFAULT_RULE_PARAMETERS };

describe("hall allocate + validate", () => {
  it("calculates halls and standby with ceil", () => {
    const c = calculateHallRequirements(200, 20, 10);
    expect(c.requiredHalls).toBe(10);
    expect(c.standby).toBe(1);
  });

  it("allocates and validates for one centre", () => {
    const teachers = Array.from({ length: 30 }, (_, i) => ({
      teacherId: `t${i}`,
      employeeCode: `E${i}`,
      name: `T${i}`,
      schoolId: i < 5 ? "s1" : "s2",
      designation: "PG" as const,
      isActive: true,
      dataQuality: "Confirmed" as const,
      homeLatitude: 11.34 + i * 0.001,
      homeLongitude: 77.72,
      seniorityRank: i + 1,
    }));
    const centreSchoolIds = new Map<string, Set<string>>([["c1", new Set(["s1"])]]);
    const demands = [
      {
        centreId: "c1",
        totalStudents: 40,
        examDate: "2027-03-15",
        sessionCode: "MORNING" as const,
      },
    ];
    const result = allocateHall(
      demands,
      {
        teachers,
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
            capacity: 200,
          },
        ],
        exemptions: [],
        history: [],
        calendar: [],
        academicYear: "2027",
        asOfDate: "2027-03-01",
        centreSchoolIds,
      },
      rules,
    );
    expect(result.requiredHallsByCentre.c1).toBe(2);
    const v = validateHallAllocation(
      result,
      demands.map((d) => ({ centreId: d.centreId, totalStudents: d.totalStudents })),
      rules,
    );
    expect(v.errors).toBe(0);
  });
});
