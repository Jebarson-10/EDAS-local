import { describe, expect, it } from "vitest";
import { timetableYearProblem } from "./timetableChecks";

const entry = (examDate: string) => ({ timetableEntryId: "t1", schoolId: null, examDate, sessionCode: "MORNING" as const, subjectLabel: "Tamil", requiresChief: true, requiresHall: true, notes: null });

describe("timetableYearProblem", () => {
  it("stops a sample timetable from another academic year", () => {
    expect(timetableYearProblem([entry("2026-03-02")], "2027")).toContain("2026-03-02");
  });
  it("accepts either year when the academic year spans two calendar years", () => {
    expect(timetableYearProblem([entry("2027-03-02")], "2026-2027")).toBeNull();
  });
});
