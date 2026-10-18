import { describe, it, expect } from "vitest";
import { emptyExamWorkspace, type WorkspaceRole, type WorkspaceRun } from "@exam-duty/shared";
import { fillWorkspaceShortage, workspaceManualCandidates } from "./workspaceManual.js";
import { validateWorkspaceRun } from "./workspace.js";

function fixture(standard: "10" | "12" = "12", role: WorkspaceRole = "OFFICE_ASSISTANT") {
  const w = emptyExamWorkspace("manual", "Synthetic cycle");
  w.settings.confirmed = true;
  w.schools = ["source", "centre", "far"].map((udise) => ({ udise, name: udise, block: "B", educationalDistrict: "D",
    level: standard === "10" ? "HIGH" : "HIGHER_SECONDARY", management: "GOVERNMENT", latitude: udise === "far" ? 11.5 : 11.3, longitude: 77.7, raw: {} }));
  w.centres = [{ standard, code: "100", udise: "centre", students: 20, clubbedUdise: [] }];
  w.timetable = ["2027-03-01", "2027-03-02"].map((date) => ({ standard, date, session: "MORNING", subject: "MAT", centreCode: "" }));
  const roles: WorkspaceRole[] = ["CHIEF", "DEPARTMENT", "JUNIOR_ASSISTANT", "OFFICE_ASSISTANT", "SQUAD", ...Array<WorkspaceRole>(3).fill("INVIGILATOR"), ...Array<WorkspaceRole>(3).fill("BACKUP")];
  w.staff = roles.map((r, i) => ({ staffId: `s${i}`, name: `Synthetic ${i}`, udise: r === role ? "far" : "source",
    post: r === "CHIEF" ? standard === "10" ? "HM_HS" : "HM_HSS" : r === "JUNIOR_ASSISTANT" ? "JA" : r === "OFFICE_ASSISTANT" ? "OA" : standard === "10" ? "BT" : "PG",
    originalPost: r, category: ["JUNIOR_ASSISTANT", "OFFICE_ASSISTANT"].includes(r) ? "NON_TEACHING" : "TEACHING",
    appointedSubject: "PHY", handlingSubjects: ["PHY"], standards: [standard], postDate: "2000-01-01", serviceDate: "2000-01-01", raw: {} }));
  const all = w.timetable.flatMap((t) => roles.map((r, i) => ({ key: `${i}|${t.date}`, standard, date: t.date, session: t.session,
    targetId: "100", centreCode: "100", centreUdise: "centre", role: r, staffId: `s${i}`, subject: "MAT" })));
  const vacancy = all.filter((a) => a.role === role).map(({ staffId: _staffId, ...a }) => a);
  const run: WorkspaceRun = { id: "original", createdAt: "2026-10-18", standard, module: "THEORY", inputRevision: 0, seed: "s", ruleVersion: w.ruleVersion,
    published: false, errors: [], assignments: all.filter((a) => a.role !== role),
    shortages: [{ key: "gap", target: "100", role, date: "2027-03-01, 2027-03-02", missing: 1, reasons: { "Beyond 10 km": 1 }, vacancy }] };
  return { w, run, staffId: all.find((a) => a.role === role)!.staffId };
}
describe("manual shortage choices", () => {
  it("offers only eligible available non-teaching staff and reports distance exceptions", () => {
    const { w, run, staffId } = fixture();
    expect(validateWorkspaceRun(w, run)).toEqual([]);
    const list = workspaceManualCandidates(w, run, "gap");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ staffId, distanceException: true });
    expect(list[0]!.distanceKm).toBeGreaterThan(10);
  });
  it("requires approval and a reason, preserves the original and records all fixed dates", () => {
    const { w, run, staffId } = fixture();
    const before = JSON.stringify(run);
    const choice = { shortageKey: "gap", staffId, reason: "Approved shortage coverage", distanceException: false };
    expect(() => fillWorkspaceShortage(w, run, choice)).toThrow("distance exception");
    expect(() => fillWorkspaceShortage(w, run, { ...choice, distanceException: true, reason: "" })).toThrow("reason");
    const next = fillWorkspaceShortage(w, run, { ...choice, distanceException: true });
    expect(next.shortages).toEqual([]);
    expect(next.published).toBe(false);
    expect(next.assignments.filter((a) => a.manual)).toHaveLength(2);
    expect(validateWorkspaceRun(w, next)).toEqual([]);
    expect(JSON.stringify(run)).toBe(before);
  });
  it("excludes staff occupied on even one fixed-duty session, including other standards", () => {
    const { w, run, staffId } = fixture();
    const other = [{ ...run.shortages[0]!.vacancy![1]!, staffId, standard: "10" as const }];
    expect(workspaceManualCandidates(w, run, "gap", other)).toEqual([]);
    expect(() => fillWorkspaceShortage(w, run, { shortageKey: "gap", staffId, reason: "Shortage", distanceException: true }, other)).toThrow("already on duty");
  });
  it.each(["10", "12"] as const)("keeps %s departmental duty on its own assistant post", (standard) => {
    const { w, run, staffId } = fixture(standard, "DEPARTMENT");
    w.staff.push({ ...w.staff.find((t) => t.staffId === staffId)!, staffId: "wrong", post: standard === "10" ? "PG" : "BT" });
    expect(workspaceManualCandidates(w, run, "gap").map((c) => c.staffId)).toEqual([staffId]);
  });
  it("does not override missing coordinates or the two-year restriction", () => {
    const { w, run, staffId } = fixture();
    w.schools[2]!.latitude = null;
    expect(workspaceManualCandidates(w, run, "gap")).toEqual([]);
    w.schools[2]!.latitude = 11.5;
    w.history.push({ staffId, centreUdise: "centre", date: "2026-03-01", role: "OFFICE_ASSISTANT" });
    expect(workspaceManualCandidates(w, run, "gap")).toEqual([]);
  });
  it("allows Record Clerk cover, but not a teaching-category OA or a PG office helper", () => {
    const { w, run, staffId } = fixture();
    const office = w.staff.find((t) => t.staffId === staffId)!;
    w.staff.push({ ...office, staffId: "rc", post: "RC" }, { ...office, staffId: "wrong-category", category: "TEACHING" },
      { ...office, staffId: "pg-office", post: "PG", category: "TEACHING" });
    expect(workspaceManualCandidates(w, run, "gap").map((c) => c.staffId).sort()).toEqual([staffId, "rc"].sort());
  });
});
