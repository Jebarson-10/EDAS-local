import { describe, expect, it } from "vitest";
import { parseHistoricalDutyRows, resolveHistoricalDutyRows } from "./historicalDutyImport.js";

describe("historical duty import", () => {
  it("reads flexible Excel values and resolves only one saved teacher and centre", () => {
    const parsed = parseHistoricalDutyRows([
      ["Teacher name", "School reference", "Centre code", "Exam date", "Session", "Duty group", "Role", "Academic year"],
      ["KALA", 1234, 5001, new Date("2025-03-10T00:00:00Z"), "AM", "Theory / Hall", "Hall invigilator", "2025-26"],
    ]);
    expect(parsed.errors).toEqual([]);
    const resolved = resolveHistoricalDutyRows(parsed.rows, {
      teachers: [{ teacherId: "t1", name: "Kala", schoolId: "s1" }],
      schools: [{ schoolId: "s1", schoolName: "Example school", sourceSchoolCode: "1234" }],
      centres: [{ centreId: "c1", centreCode: "5001" }],
    });
    expect(resolved.errors).toEqual([]);
    expect(resolved.rows).toEqual([expect.objectContaining({ teacherId: "t1", centreId: "c1", dutyTypeCode: "THEORY_HISTORICAL", examDate: "2025-03-10", academicYear: "2025" })]);
  });

  it("does not guess an ambiguous teacher", () => {
    const parsed = parseHistoricalDutyRows([
      ["Teacher name", "Centre code", "Exam date", "Session", "Duty group", "Role", "Academic year"],
      ["Kala", "5001", "10/03/2025", "Morning", "Theory", "Chief", "2025"],
    ]);
    const resolved = resolveHistoricalDutyRows(parsed.rows, {
      teachers: [{ teacherId: "t1", name: "Kala", schoolId: "s1" }, { teacherId: "t2", name: "Kala", schoolId: "s2" }],
      schools: [{ schoolId: "s1", schoolName: "A" }, { schoolId: "s2", schoolName: "B" }],
      centres: [{ centreId: "c1", centreCode: "5001" }],
    });
    expect(resolved.rows).toEqual([]);
    expect(resolved.errors[0]).toMatch(/more than one/);
  });

  it("requires a complete practical examiner pair with its school and subject", () => {
    const parsed = parseHistoricalDutyRows([
      ["Teacher name", "School reference", "Exam date", "Session", "Duty group", "Role", "Academic year", "Exam school reference", "Subject"],
      ["Kala", "1001", "10/03/2025", "Morning", "Practical", "Internal examiner", "2025", "2001", "Physics"],
      ["Malar", "1002", "10/03/2025", "Morning", "Practical", "External examiner", "2025", "2001", "Physics"],
    ]);
    expect(parsed.errors).toEqual([]);
    const resolved = resolveHistoricalDutyRows(parsed.rows, {
      teachers: [{ teacherId: "t1", name: "Kala", schoolId: "s1" }, { teacherId: "t2", name: "Malar", schoolId: "s2" }],
      schools: [{ schoolId: "s1", schoolName: "A", sourceSchoolCode: "1001" }, { schoolId: "s2", schoolName: "B", sourceSchoolCode: "1002" }, { schoolId: "s3", schoolName: "C", sourceSchoolCode: "2001" }],
      centres: [],
    });
    expect(resolved.errors).toEqual([]);
    expect(resolved.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ teacherId: "t1", schoolId: "s3", subjectId: "Physics", roleCode: "PRACTICAL_INTERNAL" }),
      expect.objectContaining({ teacherId: "t2", schoolId: "s3", subjectId: "Physics", roleCode: "PRACTICAL_EXTERNAL" }),
    ]));
  });
});
