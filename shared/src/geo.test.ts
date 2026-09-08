import { describe, expect, it } from "vitest";
import { haversineKm, validateCoordinates, teacherImportRowSchema } from "../src/index.js";

describe("haversine", () => {
  it("returns ~0 for same point", () => {
    expect(haversineKm(11.34, 77.72, 11.34, 77.72)).toBeCloseTo(0, 5);
  });
});

describe("import validation", () => {
  it("rejects missing employee code", () => {
    const r = teacherImportRowSchema.safeParse({
      employeeCode: "",
      name: "X",
      schoolCode: "S1",
      designation: "HM",
    });
    expect(r.success).toBe(false);
  });

  it("flags impossible coordinates", () => {
    expect(validateCoordinates(100, 10)).toMatch(/latitude/i);
  });
});
