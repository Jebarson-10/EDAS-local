import { describe, expect, it } from "vitest";
import { timetableDateProblem } from "./timetableChecks";

const entry = (examDate: string) => ({ timetableEntryId: "t1", schoolId: null, examDate, sessionCode: "MORNING" as const, subjectLabel: "Tamil", requiresChief: true, requiresHall: true, notes: null });

describe("timetableDateProblem", () => {
  it("stops a timetable date before today", () => {
    expect(timetableDateProblem([entry("2026-09-17")], "2026-09-18")).toContain("2026-09-17");
  });
  it("accepts today", () => {
    expect(timetableDateProblem([entry("2026-09-18")], "2026-09-18")).toBeNull();
  });
  it("accepts any future date without comparing the academic year", () => {
    expect(timetableDateProblem([entry("2026-09-21")], "2026-09-18")).toBeNull();
    expect(timetableDateProblem([entry("2027-03-02")], "2026-09-18")).toBeNull();
  });
});
