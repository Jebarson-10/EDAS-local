import { describe, expect, it } from "vitest";
import {
  emptyExamWorkspace,
  WORKSPACE_IMPORT_HEADERS,
} from "./examWorkspace.js";
import {
  importWorkspaceSheet,
  workspaceSubject,
  workspacePost,
  inspectWorkspaceSheet,
} from "./workspaceImport.js";

describe("School and Teacher Master inputs", () => {
  it("recognizes every heading in the downloadable multi-sheet template", () => {
    for (const [kind, headers] of Object.entries(WORKSPACE_IMPORT_HEADERS)) {
      expect(inspectWorkspaceSheet([[...headers]]).kind).toBe(kind);
    }
  });
  const schools = [
    ["SCHOOL DETAILS"],
    [
      "Sl.No.",
      "Block",
      "Educational District",
      "UDISE CODE",
      "School Name",
      "Category",
      "Management Type",
      "Latitude",
      "Longitude",
    ],
    [
      1,
      "B",
      "E",
      12345678901,
      "Sample HSS",
      "5 - Up. Pr. Secondary and Higher Sec",
      "Un-Aided",
      11.3,
      77.7,
    ],
  ];
  it("detects the actual heading row and keeps UDISE separate from centre codes", () => {
    const result = importWorkspaceSheet(
      emptyExamWorkspace("c", "Cycle"),
      schools,
    );
    expect(result.errors).toEqual([]);
    expect(result.workspace.schools[0]).toMatchObject({
      udise: "12345678901",
      level: "HIGHER_SECONDARY",
      management: "PRIVATE",
      latitude: 11.3,
    });
    expect(result.workspace.centres).toEqual([]);
  });
  it("keeps handling subjects and present-post date, not service date, for seniority", () => {
    const workspace = importWorkspaceSheet(
      emptyExamWorkspace("c", "Cycle"),
      schools,
    ).workspace;
    const result = importWorkspaceSheet(workspace, [
      ["TEACHERS"],
      [
        "UDISE Code",
        "Staff ID",
        "Staff NAME",
        "Designation",
        "Type of Staff",
        "Appointed Subject",
        "Handling Subject1",
        "Handling Subject2",
        "Class Taught",
        "Date Of Join",
        "Date of present post",
      ],
      [
        12345678901,
        456,
        "Example",
        "P.G. TEACHER",
        "TEACHING",
        "Physics",
        "Physics",
        "Null",
        "Higher Secondary only",
        new Date("2005-01-01Z"),
        new Date("2015-01-01Z"),
      ],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.workspace.staff[0]).toMatchObject({
      staffId: "456",
      post: "PG",
      standards: ["12"],
      handlingSubjects: ["PHY"],
      postDate: "2015-01-01",
      serviceDate: "2005-01-01",
    });
  });
  it("rejects unmatched schools and duplicate staff without applying a partial file", () => {
    const empty = emptyExamWorkspace("c", "Cycle");
    const result = importWorkspaceSheet(empty, [
      ["UDISE Code", "Staff ID", "Staff NAME"],
      [123, 1, "Example"],
    ]);
    expect(result.errors[0]).toContain("Import School Master first");
    expect(result.workspace).toBe(empty);
    const duplicate = importWorkspaceSheet(empty, [...schools, schools[2]!]);
    expect(duplicate.errors[0]).toContain("Repeated record");
    expect(duplicate.workspace.schools).toEqual([]);
  });
  it("keeps distinct biology and computer papers and unrecognised posts", () => {
    expect(
      ["Botany", "Zoology", "Computer Science", "Computer Applications"].map(
        workspaceSubject,
      ),
    ).toEqual(["BOT", "ZOO", "CS", "CA"]);
    expect(workspacePost("SPECIAL GRADUATE TEACHER (BT ASSISTANT)")).not.toBe(
      "BT",
    );
    expect(workspacePost("PHYSICAL DIRECTOR - GRADE-1")).toBe("PD1");
    expect(workspacePost("LAB ASSISTANT")).not.toBe("OA");
  });
  it("new cycles have no shared mutable input arrays", () => {
    const a = importWorkspaceSheet(
      emptyExamWorkspace("a", "A"),
      schools,
    ).workspace;
    a.history.push({
      staffId: "s",
      centreUdise: "u",
      date: "2025-03-01",
      role: "CHIEF",
    });
    const b = emptyExamWorkspace("b", "B");
    expect(b.settings.radiusKm).toBe(10);
    expect(b.settings.custodianPost12).toBe("DEO");
    expect(b.settings.practical10SameRules).toBe(true);
    expect(b.settings.retainHistory).toBe(false);
    expect(b.schools).toEqual([]);
    expect(b.history).toEqual([]);
    expect(b.imports).toEqual([]);
  });
  it("matches spelling variants of practical papers without guessing a different qualification", () => {
    expect(workspaceSubject("Micro-Biology")).toBe(workspaceSubject("Microbiology"));
    expect(workspaceSubject("Nursing (General)")).toBe(workspaceSubject("General Nursing"));
    expect(workspaceSubject("Agriculture Science")).toBe(workspaceSubject("Agricultural Science"));
    expect(workspaceSubject("Nutrition")).not.toBe(workspaceSubject("Nutrition and Dietetics"));
    expect(workspaceSubject("Computer Technology")).not.toBe(workspaceSubject("Computer Science"));
  });
});
