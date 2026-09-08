import { describe, expect, it } from "vitest";
import { validateBackupPayload } from "./repos.js";

describe("historyVenueExists via validateBackupPayload", () => {
  const cores = {
    schools: [
      {
        schoolId: "s1",
        schoolCode: "S1",
        schoolName: "School",
        blockId: "b1",
        active: true,
      },
    ],
    centres: [
      {
        centreId: "c1",
        centreCode: "C1",
        centreName: "Centre",
        blockId: "b1",
        active: true,
      },
    ],
    teachers: [
      {
        teacherId: "t1",
        employeeCode: "E1",
        name: "Teacher",
        schoolId: "s1",
        designation: "HM",
        isActive: true,
      },
    ],
    relationships: [],
  };

  it("accepts practical history that stores the school as centre_id", () => {
    expect(
      validateBackupPayload({
        ...cores,
        history: [
          {
            teacherId: "t1",
            centreId: "s1",
            dutyTypeCode: "PRACTICAL_INTERNAL",
            examDate: "2027-03-20",
            sessionCode: "MORNING",
          },
        ],
      }).ok,
    ).toBe(true);
  });

  it("still rejects theory history that points at a missing centre", () => {
    const bogus = validateBackupPayload({
      ...cores,
      history: [
        {
          teacherId: "t1",
          centreId: "missing",
          dutyTypeCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
        },
      ],
    });
    expect(bogus.ok).toBe(false);
    if (!bogus.ok) expect(bogus.error).toMatch(/missing centre/);
  });
});
