import { describe, expect, it } from "vitest";
import { parseTimetableAoa } from "./excelTimetable.js";

const schools = [
  { schoolId: "school-1", schoolName: "Government Higher Secondary School, Erode", schoolCode: "E101" },
];

describe("parseTimetableAoa", () => {
  it("maps ordinary Excel headings and values", () => {
    const result = parseTimetableAoa([
      ["Date", "Session", "School name", "Subject / paper", "Chief duty", "Hall duty", "Notes"],
      [new Date("2026-03-15T00:00:00.000Z"), "AM", "E101", "Tamil", "Yes", 0, "First paper"],
      ["16/03/2026", "Afternoon", "All schools", "English", "", "", ""],
    ], schools);
    expect(result.errors).toEqual([]);
    expect(result.entries).toMatchObject([
      { examDate: "2026-03-15", sessionCode: "MORNING", schoolId: "school-1", subjectLabel: "Tamil", requiresChief: true, requiresHall: false },
      { examDate: "2026-03-16", sessionCode: "AFTERNOON", schoolId: null, schoolName: "All schools", requiresChief: true, requiresHall: true },
    ]);
  });

  it("shows simple problems before anything is saved", () => {
    const result = parseTimetableAoa([
      ["Date", "Session", "School", "Paper"],
      ["15/03/2026", "Morning", "Unknown school", "Tamil"],
      ["15/03/2026", "Morning", "E101", "English"],
    ], schools);
    expect(result.entries).toHaveLength(1);
    expect(result.errors.join(" ")).toContain("not in your saved school list");
  });

  it("requires the main headings", () => {
    const result = parseTimetableAoa([["School", "Paper"], ["E101", "Tamil"]], schools);
    expect(result.errors).toEqual(expect.arrayContaining(["Add a Date column.", "Add a Session column."]));
  });
});
