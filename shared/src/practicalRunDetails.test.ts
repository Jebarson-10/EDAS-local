import { describe, expect, it } from "vitest";
import { practicalRunDetails } from "./practicalRunDetails.js";

describe("recorded practical run details", () => {
  it("keeps unscheduled planned batches and their actual diagnostic after reload", () => {
    const batch = { batchKey: "s|PHY|2", schoolId: "s", subjectId: "PHY", batchIndex: 2, studentCount: 50 };
    const diagnostic = { schoolId: "s", subjectId: "PHY", batchKey: batch.batchKey, message: "No external examiner", exclusionTallies: { "Wrong staff post": 2 } };
    expect(practicalRunDetails(JSON.stringify({ plannedBatches: [batch], diagnostics: [diagnostic], message: "Incomplete" }))).toEqual({ batches: [batch], diagnostics: [diagnostic], message: "Incomplete" });
  });
  it("does not invent counts for old, malformed or invalid summaries", () => {
    for (const input of [undefined, "null", "bad json", JSON.stringify({ diagnostics: [{ message: "bad" }], plannedBatches: [{ studentCount: -1 }] })]) expect(practicalRunDetails(input)).toEqual({ batches: [], diagnostics: [], message: undefined });
  });
});
