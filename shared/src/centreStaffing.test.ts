import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS } from "./types.js";
import {
  buildCentreStaffingRequirements,
  calculateCustodianRequirementCount,
  buildCustodianRequirements,
  buildHallDemands,
} from "./centreStaffing.js";

const entry = (subjectLabel: string) => ({
  timetableEntryId: subjectLabel,
  examDate: "2026-09-25",
  sessionCode: "MORNING" as const,
  subjectLabel,
  requiresChief: true,
  requiresHall: true,
});

describe("centre staffing requirements", () => {
  it("creates custodians once per point/session with PG and BT eligibility", () => {
    const result = buildCustodianRequirements([{centreId: "c1", schoolIds: ["s1", "s2"], count: 2}], [entry("Tamil"), entry("English")]);
    expect(result).toHaveLength(2);
    expect(new Set(result.map(r => r.requirementKey)).size).toBe(2);
    expect(result[0]).toMatchObject({roleCode: "CUSTODIAN", preferredDesignations: ["PG", "SENIOR_PG", "BT"], fallbackDesignations: []});
    expect(buildCustodianRequirements([], [entry("Tamil")])).toEqual([]);
  });
  it("does not duplicate hall staff when subjects share a session", () => {
    expect(buildHallDemands({timetable: [entry("Tamil"), entry("English")], centres: [{centreId: "c1", centreCode: "1", centreName: "Synthetic", blockId: "b1", capacity: 101, active: true}], relationships: []})).toHaveLength(1);
  });
  it("creates one chief, one department officer and two office staff through 500 students", () => {
    const plan = buildCentreStaffingRequirements({
      timetable: [entry("Tamil"), entry("English")],
      centres: [{ centreId: "c1", centreCode: "1", centreName: "One", blockId: "b1", capacity: 500, active: true }],
      relationships: [],
      rules: DEFAULT_RULE_PARAMETERS,
    });
    expect(plan.requirements.map((requirement) => requirement.roleCode)).toEqual([
      "CHIEF_EXAMINATION", "DEPARTMENT_OFFICER", "OFFICE_STAFF", "OFFICE_STAFF",
    ]);
  });

  it("creates a second department officer above 500 students", () => {
    const plan = buildCentreStaffingRequirements({
      timetable: [entry("Tamil")],
      centres: [{ centreId: "c1", centreCode: "1", centreName: "One", blockId: "b1", capacity: 501, active: true }],
      relationships: [],
      rules: DEFAULT_RULE_PARAMETERS,
    });
    expect(plan.requirements.filter((requirement) => requirement.roleCode === "DEPARTMENT_OFFICER")).toHaveLength(2);
    expect(plan.requirements.find((requirement) => requirement.roleCode === "DEPARTMENT_OFFICER")?.preferredDesignations).toEqual(["SENIOR_PG", "PG"]);
  });

  it("allows the official PG roster as the configured senior-PG fallback pool", () => {
    const plan = buildCentreStaffingRequirements({
      timetable: [entry("Tamil")],
      centres: [{ centreId: "c1", centreCode: "1", centreName: "One", blockId: "b1", capacity: 20, active: true }],
      relationships: [],
      rules: DEFAULT_RULE_PARAMETERS,
    });
    expect(plan.requirements.find((requirement) => requirement.roleCode === "CHIEF_EXAMINATION")?.fallbackDesignations).toEqual(["SENIOR_PG", "PG"]);
  });

  it("requires a student count and calculates the custodian planning count", () => {
    const plan = buildCentreStaffingRequirements({
      timetable: [entry("Tamil")],
      centres: [{ centreId: "c1", centreCode: "1", centreName: "One", blockId: "b1", active: true }],
      relationships: [],
      rules: DEFAULT_RULE_PARAMETERS,
    });
    expect(plan.missingStudentStrengthCentreIds).toEqual(["c1"]);
    expect(calculateCustodianRequirementCount(21, 10)).toBe(3);
  });
});
