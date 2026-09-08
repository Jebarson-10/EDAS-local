import { describe, expect, it } from "vitest";
import {
  assignmentsToCalendarEvents,
  mergeCalendarEvents,
  practicalSchedulesToCalendarEvents,
} from "./dutyCalendar.js";

describe("duty calendar assembly", () => {
  it("maps theory/hall assignments onto their slot", () => {
    const events = assignmentsToCalendarEvents([
      {
        teacherId: "t1",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        roleCode: "CHIEF_EXAMINATION",
        centreId: "c1",
      },
    ]);
    expect(events).toEqual([
      {
        teacherId: "t1",
        date: "2027-03-15",
        session: "MORNING",
        dutyType: "CHIEF_EXAMINATION",
        locationId: "c1",
        role: "CHIEF_EXAMINATION",
      },
    ]);
  });

  it("occupies both examiners of a practical batch", () => {
    const events = practicalSchedulesToCalendarEvents([
      {
        schoolId: "s1",
        examDate: "2027-03-02",
        sessionCode: "AFTERNOON",
        internalExaminerId: "t_int",
        externalExaminerId: "t_ext",
      },
    ]);
    expect(events.map((e) => e.teacherId)).toEqual(["t_int", "t_ext"]);
    expect(events.every((e) => e.session === "AFTERNOON")).toBe(true);
  });

  it("merges modules deterministically and drops duplicates", () => {
    const hall = assignmentsToCalendarEvents([
      {
        teacherId: "t2",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        roleCode: "HALL_INVIGILATOR",
        centreId: "c1",
      },
    ]);
    const theory = assignmentsToCalendarEvents([
      {
        teacherId: "t1",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        roleCode: "CHIEF_EXAMINATION",
        centreId: "c1",
      },
    ]);
    const merged = mergeCalendarEvents(hall, theory, hall);
    expect(merged.map((e) => e.teacherId)).toEqual(["t1", "t2"]);
    expect(mergeCalendarEvents(theory, hall)).toEqual(merged);
  });
});
