import { describe, expect, it } from "vitest";
import {
  parsePracticalClubbingAoa,
  parsePracticalBatchDemandAoa,
  buildDutyInLetterText,
  buildDutyOutLetterText,
  groupDutyInLetters,
  groupDutyOutLetters,
} from "./clientFormats.js";

describe("client sample format parsers", () => {
  it("parses practical clubbing including continuation subject rows", () => {
    const { rows, errors } = parsePracticalClubbingAoa([
      ["HIGHER SECONDARY"],
      ["S.NO", "SCH CODE", "SCHOOL NAME", "SUBJECT", "NAME OF THE PRACTICAL CENTRE"],
      [1, "SCH001", "Synthetic HSS One", "ALL", "Synthetic Centre A"],
      [2, "SCH002", "Synthetic HSS Two", "AGRI", "Synthetic Centre B"],
      ["", "", "", "BEE", "Synthetic Centre C"],
    ]);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[1]?.subject).toBe("AGRI");
    expect(rows[2]?.schoolCode).toBe("SCH002");
    expect(rows[2]?.subject).toBe("BEE");
  });

  it("parses practical batch demand and marks school totals", () => {
    const { rows, errors } = parsePracticalBatchDemandAoa([
      ["HSC-SECOND YEAR - PRACTICAL"],
      ["Sl.No.", "School No.", "Subject", "No. of Batch"],
      [1, "SCH001", "PHYSICS", 4],
      [2, "SCH001", "CHEMISTRY", 2],
      [3, "SCH001 Total", "", 6],
    ]);
    expect(errors).toEqual([]);
    expect(rows.filter((r) => !r.isSchoolTotal)).toHaveLength(2);
    expect(rows.find((r) => r.isSchoolTotal)?.batchCount).toBe(6);
  });
});

describe("Duty-In / Duty-Out builders", () => {
  const schoolById = new Map([
    ["s1", { schoolCode: "SCH001", schoolName: "Synthetic Host", place: "Town A" }],
    ["s2", { schoolCode: "SCH002", schoolName: "Synthetic External", place: "Town B" }],
  ]);
  const teacherById = new Map([
    ["t-int", { name: "Internal Teacher", schoolId: "s1" }],
    ["t-ext", { name: "External Teacher", schoolId: "s2" }],
  ]);
  const schedules = [
    {
      schoolId: "s1",
      subjectId: "PHYSICS",
      examDate: "2027-02-10",
      internalExaminerId: "t-int",
      externalExaminerId: "t-ext",
    },
    {
      schoolId: "s1",
      subjectId: "PHYSICS",
      examDate: "2027-02-11",
      internalExaminerId: "t-int",
      externalExaminerId: "t-ext",
    },
  ];

  it("builds Duty-In letter with appointment and CEO footer", () => {
    const letters = groupDutyInLetters({
      academicYearLabel: "HIGHER SECONDARY PRACTICAL EXAMINATION - 2027",
      districtLabel: "SYNTHETIC DISTRICT",
      signatoryTitle: "CHIEF EDUCATIONAL OFFICER",
      signatoryPlace: "SYNTHETIC",
      schedules,
      schoolById,
      teacherById,
    });
    expect(letters).toHaveLength(1);
    const text = buildDutyInLetterText(letters[0]!);
    expect(text).toContain("APPOINTMENT  OF EXTERNAL EXAMINER");
    expect(text).toContain("School Number : SCH001");
    expect(text).toContain("External Teacher");
    expect(text).toContain("Internal Name:Internal Teacher");
    expect(text).toContain("CHIEF EDUCATIONAL OFFICER");
  });

  it("builds Duty-Out letter keyed by external home school", () => {
    const letters = groupDutyOutLetters({
      academicYearLabel: "HIGHER SECONDARY SECOND YEAR PRACTICAL EXAMINATION - 2027",
      districtLabel: "SYNTHETIC DISTRICT",
      signatoryTitle: "CHIEF EDUCATIONAL OFFICER",
      signatoryPlace: "SYNTHETIC",
      schedules,
      schoolById,
      teacherById,
    });
    expect(letters).toHaveLength(1);
    expect(letters[0]?.schoolNumber).toBe("SCH002");
    const text = buildDutyOutLetterText(letters[0]!);
    expect(text).toContain("EXTERNAL EXAMINER DUTY FOR TEACHERS");
    expect(text).toContain("PHYSICS");
    expect(text).toContain("Synthetic Host");
  });
});

describe("clubbing apply / FORM-01 / centre strength", () => {
  it("applies clubbing by school code and centre name", async () => {
    const { applyPracticalClubbing } = await import("./clientFormats.js");
    const result = applyPracticalClubbing({
      rows: [
        {
          serialNo: 1,
          schoolCode: "S1",
          schoolName: "School 1",
          subject: "ALL",
          practicalCentreName: "Centre Alpha",
        },
      ],
      schools: [{ schoolId: "sch1", schoolCode: "S1", schoolName: "School 1" }],
      centres: [
        { centreId: "c1", centreCode: "C1", centreName: "Centre Alpha" },
      ],
      existing: [
        {
          centreId: "c0",
          schoolId: "sch1",
          relationshipType: "CLUBBED",
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
        },
      ],
      asOfDate: "2027-02-01",
    });
    expect(result.applied).toBe(1);
    expect(result.relationships.some((r) => r.effectiveTo === "2027-02-01")).toBe(
      true,
    );
    expect(
      result.relationships.some(
        (r) => r.centreId === "c1" && r.relationshipType === "CLUBBED" && !r.effectiveTo,
      ),
    ).toBe(true);
  });

  it("parses FORM-01 with synthetic employee codes", async () => {
    const { parseForm01SeniorityAoa } = await import("./clientFormats.js");
    const { rows } = parseForm01SeniorityAoa(
      [
        ["HEADMASTER DETAILS"],
        ["S.NO", "SCHOOL CODE", "NAME OF THE SCHOOL", "TYPE", "HEADMASTER NAME", "SEX", "MAJOR SUBJECT"],
        [1, "S1", "Synthetic School", "GOVT", "Alpha Teacher", "M", "PHYSICS"],
      ],
      "HM",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employeeCode.startsWith("SYN-HM-")).toBe(true);
    expect(rows[0]?.designation).toBe("HM");
  });

  it("applies centre strength to capacity", async () => {
    const { parseCentreStrengthAoa, applyCentreStrengths } = await import(
      "./clientFormats.js"
    );
    const { rows } = parseCentreStrengthAoa([
      ["S.No", "CENTER NO.", "NAME OF THE CENTRE", "STRENGTH OF STUDENTS 12TH", "STRENGTH OF STUDENTS 11TH ARREAR"],
      [1, "220001", "Synthetic Centre", 194, 3],
    ]);
    const applied = applyCentreStrengths({
      rows,
      centres: [
        {
          centreId: "c1",
          centreCode: "220001",
          centreName: "Synthetic Centre",
          capacity: 100,
          blockId: "b1",
          active: true,
        },
      ],
    });
    expect(applied.applied).toBe(1);
    expect(applied.centres[0]?.capacity).toBe(194);
  });

  it("maps batch demand by school code", async () => {
    const { mapBatchDemandToPractical } = await import("./clientFormats.js");
    const { demands, unmatched } = mapBatchDemandToPractical({
      rows: [
        {
          serialNo: 1,
          schoolCode: "S2",
          subject: "CHEMISTRY",
          batchCount: 3,
          isSchoolTotal: false,
        },
      ],
      schools: [
        { schoolId: "sch1", schoolCode: "S1" },
        { schoolId: "sch2", schoolCode: "S2" },
      ],
      batchSize: 50,
    });
    expect(unmatched).toEqual([]);
    expect(demands[0]).toEqual({
      schoolId: "sch2",
      subjectId: "CHEMISTRY",
      studentCount: 150,
    });
  });
});
