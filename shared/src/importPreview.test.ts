import { describe, expect, it } from "vitest";
import { previewTeacherImport } from "../src/importPreview.js";

describe("import preview", () => {
  const existing = [
    {
      employeeCode: "A1",
      name: "Ann",
      schoolCode: "S1",
      designation: "HM",
      isActive: true,
    },
    {
      employeeCode: "B1",
      name: "Bob",
      schoolCode: "S2",
      designation: "PG",
      isActive: true,
    },
  ];

  it("detects new updated unchanged duplicate missing", () => {
    const preview = previewTeacherImport(
      [
        {
          employeeCode: "A1",
          name: "Ann Updated",
          schoolCode: "S1",
          designation: "HM",
        },
        {
          employeeCode: "C1",
          name: "Cat",
          schoolCode: "S3",
          designation: "PG",
        },
        {
          employeeCode: "A1",
          name: "Dup",
          schoolCode: "S1",
          designation: "HM",
        },
        { name: "", schoolCode: "S1", designation: "HM" },
      ],
      existing,
    );
    expect(preview.updatedTeachers).toBe(1);
    expect(preview.newTeachers).toBe(1);
    expect(preview.duplicates).toBe(1);
    expect(preview.invalidRows).toBe(1);
    expect(preview.missingFromFile).toBe(1);
  });
});
