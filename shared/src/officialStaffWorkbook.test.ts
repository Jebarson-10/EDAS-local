import { describe, expect, it } from "vitest";
import { parseOfficialStaffWorkbook } from "./officialStaffWorkbook.js";
import { previewTeacherImport } from "./importPreview.js";

describe("official staff workbook import", () => {
  it("reads the CEO workbook layout and keeps office staff separate", () => {
    const parsed = parseOfficialStaffWorkbook([
      {
        name: "HM",
        lines: [
          ["HSC STAFF LIST"],
          ["S.NO", "SCHOOL CODE", "NAME OF THE SCHOOL", "HEADMASTER NAME", "DATE OF APPOINTMENT"],
          [1, "1001", "Example School", "A. Headmaster", "15/06/2010"],
        ],
      },
      {
        name: "NON TEACHING",
        lines: [
          ["HSC STAFF LIST"],
          ["S.NO", "SCHOOL CODE", "NAME OF THE SCHOOL", "NAME OF THE EMPLOYEE", "DESIGNATION"],
          [1, "1001", "Example School", "B. Clerk", "Junior Assistant"],
        ],
      },
    ]);

    expect(parsed.detectedSheetNames).toEqual(["HM", "NON TEACHING"]);
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        name: "A. Headmaster",
        schoolName: "Example School",
        designation: "HM",
        joiningDate: "2010-06-15",
        staffCategory: "TEACHING",
      }),
      expect.objectContaining({
        name: "B. Clerk",
        designation: "Junior Assistant",
        staffCategory: "NON_TEACHING",
      }),
    ]);

    const review = previewTeacherImport(
      [parsed.rows[1]!],
      [],
      [
        {
          schoolId: "school-1",
          schoolCode: "",
          schoolName: "Example School",
        },
      ],
    );
    expect(review.newTeachers).toBe(1);
    expect(review.rows[0]?.payload?.staffCategory).toBe("NON_TEACHING");
  });

  it("does not treat a numeric marker row as a teacher", () => {
    const parsed = parseOfficialStaffWorkbook([
      {
        name: "PG",
        lines: [
          ["HSC STAFF LIST"],
          ["S.NO", "SCHOOL CODE", "NAME OF THE SCHOOL", "TEACHERS NAME", "DESIGNATION"],
          [1, 2, 3, 4, 5],
          [1, "1001", "Example School", "C. Teacher", "P.G. ASSISTANT"],
        ],
      },
    ]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual(
      expect.objectContaining({ name: "C. Teacher", designation: "PG" }),
    );
  });

  it("derives PG seniority from appointment date rather than the sheet serial number", () => {
    const parsed = parseOfficialStaffWorkbook([
      {
        name: "PG",
        lines: [
          ["HSC STAFF LIST"],
          ["S.NO", "SCHOOL CODE", "NAME OF THE SCHOOL", "TEACHERS NAME", "DESIGNATION", "DATE OF APPOINTMENT AS PG ASST", "DATE OF APPOINTMENT AS PG ASST", "DATE OF APPOINTMENT AS PG ASST"],
          [90, "1001", "Example School", "Later PG", "PG ASSISTANT", "15", "06", "2015"],
          [1, "1002", "Other School", "Earlier PG", "PG ASSISTANT", "15", "06", "2010"],
        ],
      },
    ]);
    expect(parsed.rows.map((row) => [row.name, row.seniorityRank])).toEqual([
      ["Later PG", 2],
      ["Earlier PG", 1],
    ]);
  });

  it("reads rich-text headings produced by the official workbook", () => {
    const parsed = parseOfficialStaffWorkbook([
      {
        name: "HM",
        lines: [
          ["HSC STAFF LIST"],
          [
            { richText: [{ text: "SCHOOL " }, { text: "CODE" }] },
            { richText: [{ text: "NAME OF THE SCHOOL" }] },
            { richText: [{ text: "HEADMASTER NAME" }] },
          ],
          ["1001", "Example School", "D. Headmaster"],
        ],
      },
    ]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual(
      expect.objectContaining({ name: "D. Headmaster", designation: "HM" }),
    );
  });
});
