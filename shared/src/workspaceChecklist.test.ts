import { describe, it, expect } from "vitest";
import {
  prepareWorkspaceChecklist,
  reviewedWorkspaceCentres,
} from "./workspaceChecklist.js";
import type { WorkspaceSchool } from "./examWorkspace.js";
const school = (udise: string, name: string): WorkspaceSchool => ({
  udise,
  name,
  block: "B",
  educationalDistrict: "D",
  level: "HIGHER_SECONDARY",
  management: "GOVERNMENT",
  latitude: 11.3,
  longitude: 77.7,
  raw: {},
});
describe("workspace checklist review", () => {
  const rows = [
    {
      centreCode: "990001",
      centreName: "GOVT HR SEC SCHOOL SYNTHETIC",
      sourceSchoolCode: "990ABCD0001",
      schoolName: "GOVT HR SEC SCHOOL SYNTHETIC",
      studentCount: 101,
      page: 1,
      sourceLine: "official row",
    },
    {
      centreCode: "990001",
      centreName: "GOVT HR SEC SCHOOL SYNTHETIC",
      sourceSchoolCode: "990ABCD0002",
      schoolName: "SECOND SCHOOL",
      studentCount: 99,
      page: 1,
      sourceLine: "second row",
    },
  ];
  it("joins unique equivalent names to UDISE and sums linked school strengths", () => {
    const schools = [
      school("33100000001", "GHSS SYNTHETIC"),
      school("33100000002", "SECOND SCHOOL"),
    ];
    const p = prepareWorkspaceChecklist(rows, schools);
    expect(reviewedWorkspaceCentres(p.rows, p.hosts, "10", schools)).toEqual([
      {
        standard: "10",
        code: "990001",
        udise: "33100000001",
        students: 200,
        clubbedUdise: ["33100000002"],
      },
    ]);
  });
  it("requires review for ambiguous names and never substitutes PDF school code for UDISE", () => {
    const schools = [
      school("33100000001", "GHSS SYNTHETIC"),
      school("33100000002", "GHSS SYNTHETIC"),
    ];
    const p = prepareWorkspaceChecklist(rows, schools);
    expect(p.hosts["990001"]).toBe("");
    expect(p.rows[0]?.udise).toBe("");
    expect(() =>
      reviewedWorkspaceCentres(p.rows, p.hosts, "10", schools),
    ).toThrow("select the host");
  });
});
