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

  it("keeps the complete official row and skips the form's second header row", () => {
    const parsed = parseOfficialStaffWorkbook([
      {
        name: "PG",
        lines: [
          ["PG TEACHERS LIST"],
          ["S.NO", "SCHOOL CODE", "NAME OF THE SCHOOL", "TYPE (GOVT/AIDED)", "TEACHERS NAME", "SEX M/F", "DESIGNATION", "MOBILE NO", "QUALIFICATION", "MAJOR SUBJECT", "11,12TH HANDLING SUBJECT", "ADDITIONAL HANDLING SUBJECTS", "DATE OF APPOINTMENT AS PG ASST", "DATE OF APPOINTMENT AS PG ASST", "DATE OF APPOINTMENT AS PG ASST", "DATE OF RETIREMENT", "DATE OF RETIREMENT", "DATE OF RETIREMENT", "RESIDENTIAL UNION/BLOCK", "PREVIOUS EXAM DUTY", "PREVIOUS CAMP DUTY", "HEALTH / LEAVE / REMARKS", "BLOCK"],
          ["S.NO", "SCHOOL CODE", "NAME OF THE SCHOOL", "", "TEACHERS NAME", "", "", "", "", "", "", "", "DD", "MM", "YYYY", "DD", "MM", "YYYY"],
          [1, "220TEST0001", "Example School", "GOVT", "P. Teacher", "F", "PG ASST", "9876543210", "M.Sc., B.Ed.", "CHEMISTRY", "PHYSICS", "CHEMISTRY", 15, 6, 2010, 31, 5, 2035, "ERODE", "CHIEF", "CE", "NO", "ERODE"],
        ],
      },
    ]);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual(expect.objectContaining({
      name: "P. Teacher",
      schoolCode: "",
      sourceSchoolCode: "220TEST0001",
      subject: "PHYSICS",
      joiningDate: "2010-06-15",
      officialDetails: expect.objectContaining({
        "School type": "GOVT",
        "Mobile number": "9876543210",
        "Qualification": "M.Sc., B.Ed.",
        "Retirement date": "2035-05-31",
        "Previous exam duty": "CHIEF",
        "Reporting block": "ERODE",
      }),
    }));
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

  it("uses the standard-specific handling subject from the PG and BT forms", () => {
    const parsed = parseOfficialStaffWorkbook([
      {
        name: "PG",
        lines: [
          ["HSC STAFF LIST"],
          ["S.NO", "SCHOOL CODE", "NAME OF THE SCHOOL", "TEACHERS NAME", "MAJOR SUBJECT", "11,12TH HANDLING SUBJECT"],
          [1, "1001", "Example School", "PG Teacher", "CHEMISTRY", "PHYSICS"],
        ],
      },
      {
        name: "BT",
        lines: [
          ["SSLC STAFF LIST"],
          ["S.NO", "SCHOOL CODE", "NAME OF THE SCHOOL", "TEACHERS NAME", "MAJOR SUBJECT", "10TH HANDLING SUBJECT"],
          [1, "1002", "Other School", "BT Teacher", "HISTORY", "TAMIL"],
        ],
      },
    ]);
    expect(parsed.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "PG Teacher", designation: "PG", subject: "PHYSICS" }),
        expect.objectContaining({ name: "BT Teacher", designation: "BT", subject: "TAMIL" }),
      ]),
    );
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
  it("keeps a named teacher when the school reference cell is blank", () => {
    const parsed = parseOfficialStaffWorkbook([{name:"HM",lines:[
      ["SCHOOL CODE","NAME OF THE SCHOOL","HEADMASTER NAME"],
      [null,"Synthetic school without centre code","Synthetic HM"],
    ]}]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({name:"Synthetic HM",schoolName:"Synthetic school without centre code",designation:"HM"});
  });
});
