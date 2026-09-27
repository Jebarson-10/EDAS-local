import { describe, expect, it } from "vitest";
import { distanceReadiness } from "./allocationReadiness.js";

describe("distance readiness", () => {
  it("accepts either a school or a home location for each active staff member", () => {
    const result = distanceReadiness({
      centres: [
        { centreId: "c1", centreCode: "C1", centreName: "Centre", blockId: "b1", latitude: 11.3, longitude: 77.7, active: true },
        { centreId: "c2", centreCode: "C2", centreName: "Missing", blockId: "b1", active: true },
      ],
      schools: [
        { schoolId: "s1", schoolCode: "", schoolName: "Located", blockId: "b1", latitude: 11.2, longitude: 77.6, active: true },
        { schoolId: "s2", schoolCode: "", schoolName: "Unlocated", blockId: "b1", active: true },
      ],
      teachers: [
        { teacherId: "t1", employeeCode: "T1", name: "School location", schoolId: "s1", designation: "PG", isActive: true, dataQuality: "Imported" },
        { teacherId: "t2", employeeCode: "T2", name: "Home location", schoolId: "s2", designation: "PG", homeLatitude: 11.1, homeLongitude: 77.5, isActive: true, dataQuality: "Imported" },
        { teacherId: "t3", employeeCode: "T3", name: "Missing location", schoolId: "s2", designation: "PG", isActive: true, dataQuality: "Imported" },
      ],
    });

    expect(result.centreIdsMissingCoordinates).toEqual(["c2"]);
    expect(result.schoolIdsMissingCoordinates).toEqual(["s2"]);
    expect(result.teacherIdsWithoutDistanceLocation).toEqual(["t3"]);
  });
});
