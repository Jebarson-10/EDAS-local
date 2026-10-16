import { describe, expect, it } from "vitest";
import {
  emptyExamWorkspace,
  type WorkspaceRun,
  type WorkspaceRole,
} from "@exam-duty/shared";
import { validateWorkspaceRun } from "./workspace.js";

function fixture() {
  const w = emptyExamWorkspace("c", "Synthetic cycle");
  w.schools = ["source", "centre"].map((udise) => ({
    udise,
    name: udise,
    block: "b",
    educationalDistrict: "e",
    level: "HIGHER_SECONDARY" as const,
    management: "GOVERNMENT" as const,
    latitude: 11.3,
    longitude: 77.7,
    raw: {},
  }));
  w.centres = [
    {
      standard: "12",
      code: "100",
      udise: "centre",
      students: 20,
      clubbedUdise: [],
    },
  ];
  w.timetable = ["2027-03-01", "2027-03-02"].map((date) => ({
    standard: "12",
    date,
    session: "MORNING",
    subject: "MAT",
    centreCode: "",
  }));
  const roles: WorkspaceRole[] = [
    "CHIEF",
    "DEPARTMENT",
    "JUNIOR_ASSISTANT",
    "OFFICE_ASSISTANT",
    "SQUAD",
    ...Array<WorkspaceRole>(3).fill("INVIGILATOR"),
    ...Array<WorkspaceRole>(3).fill("BACKUP"),
  ];
  w.staff = roles.map((role, i) => ({
    staffId: `s${i}`,
    name: `Synthetic ${i}`,
    udise: "source",
    post:
      role === "CHIEF"
        ? "HM_HSS"
        : role === "JUNIOR_ASSISTANT"
          ? "JA"
          : role === "OFFICE_ASSISTANT"
            ? "OA"
            : "PG",
    originalPost: role,
    category:
      role === "JUNIOR_ASSISTANT" || role === "OFFICE_ASSISTANT"
        ? "NON_TEACHING"
        : "TEACHING",
    appointedSubject: "PHY",
    handlingSubjects: ["PHY"],
    standards: ["12"],
    postDate: "2000-01-01",
    serviceDate: "2000-01-01",
    raw: {},
  }));
  const run: WorkspaceRun = {
    id: "r",
    standard: "12",
    module: "THEORY",
    createdAt: "2026-10-16",
    ruleVersion: w.ruleVersion,
    seed: "x",
    inputRevision: 0,
    published: false,
    errors: [],
    shortages: [],
    assignments: w.timetable.flatMap((t) =>
      roles.map((role, i) => ({
        key: `${i}|${t.date}`,
        standard: "12",
        date: t.date,
        session: t.session,
        targetId: "100",
        centreCode: "100",
        centreUdise: "centre",
        role,
        staffId: `s${i}`,
        subject: "MAT",
      })),
    ),
  };
  return { w, run };
}
describe("independent new-rule validation", () => {
  it.each([9, 10, 10.001])(
    "independently checks the 10 km boundary at %s km",
    (distance) => {
      const { w, run } = fixture();
      w.schools[1]!.latitude =
        w.schools[0]!.latitude! + ((distance / 6371) * 180) / Math.PI;
      const errors = validateWorkspaceRun(w, run);
      if (distance <= 10) expect(errors).toEqual([]);
      else
        expect(
          errors.some((error) => error.includes("outside the 10 km")),
        ).toBe(true);
    },
  );
  it("accepts a literal complete roster constructed independently of the engine", () => {
    const { w, run } = fixture();
    expect(validateWorkspaceRun(w, run)).toEqual([]);
  });
  it("rejects a teaching staff office substitution and a missing hall slot", () => {
    const { w, run } = fixture();
    run.assignments.find((a) => a.role === "OFFICE_ASSISTANT")!.staffId = "s5";
    run.assignments.splice(
      run.assignments.findIndex((a) => a.role === "INVIGILATOR"),
      1,
    );
    const errors = validateWorkspaceRun(w, run);
    expect(errors.some((e) => e.includes("Office Assistant slot"))).toBe(true);
    expect(errors.some((e) => e.includes("INVIGILATOR expected"))).toBe(true);
  });
  it("detects duplicates, wrong subject and broken chief continuity", () => {
    const { w, run } = fixture();
    run.assignments.push({ ...run.assignments[0]! });
    const hall = run.assignments.find((a) => a.role === "BACKUP")!;
    w.staff.find((t) => t.staffId === hall.staffId)!.handlingSubjects = ["MAT"];
    run.assignments.find(
      (a) => a.role === "CHIEF" && a.date === "2027-03-02",
    )!.staffId = "s5";
    const errors = validateWorkspaceRun(w, run);
    expect(errors.some((e) => e.includes("Repeated assignment"))).toBe(true);
    expect(errors.some((e) => e.includes("examined subject"))).toBe(true);
    expect(errors.some((e) => e.includes("Chief changed"))).toBe(true);
  });
});
