import { describe, it, expect } from "vitest";
import {
  examWindowDates,
  examWindowDraftInputs,
  examWindowDraftWouldClearStored,
  examWindowStart,
} from "./examWindow.js";

describe("exam window", () => {
  it("falls back to the caller default when no window is configured", () => {
    expect(examWindowStart({}, "2027-03-15")).toBe("2027-03-15");
    expect(
      examWindowStart({ startDate: null, endDate: null }, "2027-03-15"),
    ).toBe("2027-03-15");
    expect(examWindowDates({}, 3, "2027-03-01")).toEqual([
      "2027-03-01",
      "2027-03-02",
      "2027-03-03",
    ]);
  });

  it("prefers the configured start over the fallback", () => {
    expect(examWindowStart({ startDate: "2028-04-02" }, "2027-03-15")).toBe(
      "2028-04-02",
    );
    expect(
      examWindowDates({ startDate: "2028-04-02" }, 2, "2027-03-01"),
    ).toEqual(["2028-04-02", "2028-04-03"]);
  });

  it("clips the run to the configured end date", () => {
    expect(
      examWindowDates(
        { startDate: "2027-03-01", endDate: "2027-03-02" },
        4,
        "2027-03-01",
      ),
    ).toEqual(["2027-03-01", "2027-03-02"]);
  });

  it("always yields at least one day even for a single-day window", () => {
    expect(
      examWindowDates(
        { startDate: "2027-03-01", endDate: "2027-03-01" },
        4,
        "2027-03-01",
      ),
    ).toEqual(["2027-03-01"]);
    expect(examWindowDates({}, 0, "2027-03-01")).toEqual(["2027-03-01"]);
  });

  it("crosses month and year boundaries in UTC", () => {
    expect(
      examWindowDates({ startDate: "2027-12-30" }, 4, "2027-03-01"),
    ).toEqual(["2027-12-30", "2027-12-31", "2028-01-01", "2028-01-02"]);
  });

  it("ignores a malformed stored date rather than emitting junk", () => {
    expect(examWindowStart({ startDate: "March 2027" }, "2027-03-15")).toBe(
      "2027-03-15",
    );
  });
});

describe("examWindowDraftInputs", () => {
  it("treats a missing stored window as empty date inputs", () => {
    expect(examWindowDraftInputs({ startDate: null, endDate: null })).toEqual({
      start: "",
      end: "",
    });
  });

  it("mirrors a hydrated window so Save cannot POST a wipe", () => {
    const stored = { startDate: "2027-04-05", endDate: "2027-04-09" };
    const mountDraft = examWindowDraftInputs({
      startDate: null,
      endDate: null,
    });
    expect(examWindowDraftWouldClearStored(mountDraft, stored)).toBe(true);
    expect(
      examWindowDraftWouldClearStored(examWindowDraftInputs(stored), stored),
    ).toBe(false);
  });
});
