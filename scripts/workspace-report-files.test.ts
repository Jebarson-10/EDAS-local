import { describe, expect, it } from "vitest";
import { emptyExamWorkspace, type WorkspaceAssignment, type WorkspaceRun } from "../shared/src/index";
import { workspaceReportFilename, workspaceReportSheets, workspaceRoleLabel } from "../frontend/src/lib/workspaceReportData";
import { buildWorkspaceReportWorkbook } from "../frontend/src/lib/workspaceReportWorkbook";

function fixture(standard: "10" | "12" = "12", module: "THEORY" | "PRACTICAL" = "THEORY") {
  const w = emptyExamWorkspace("report", "Synthetic report cycle");
  w.schools = ["a", "b", "source"].map((udise) => ({ udise, name: `Synthetic school ${udise}`, block: "B", educationalDistrict: "D", level: "HIGHER_SECONDARY", management: "GOVERNMENT", latitude: 11.3, longitude: 77.7, raw: {} }));
  w.centres = [{ standard: "10", code: "010", udise: "a", students: 200, clubbedUdise: [] }, { standard: "12", code: "120", udise: "a", students: 200, clubbedUdise: [] }, { standard: "12", code: "121", udise: "b", students: 100, clubbedUdise: [] }];
  w.staff = ["chief", "department", "hall", "internal", "external"].map((staffId) => ({ staffId, name: `Synthetic ${staffId}`, udise: "source", post: "PG", originalPost: "PG Assistant", category: "TEACHING", appointedSubject: "PHY", handlingSubjects: ["PHY"], standards: [standard], serviceDate: "2000-01-01", postDate: "2000-01-01", raw: {} }));
  const make = (key: string, role: WorkspaceAssignment["role"], staffId: string, date = "2026-10-19"): WorkspaceAssignment => ({ key, standard, role, staffId, date, session: "MORNING", targetId: "120", centreCode: standard === "10" ? "010" : "120", centreUdise: "a", subject: "PHY" });
  const run: WorkspaceRun = { id: "report-run", standard, module, ruleVersion: w.ruleVersion, seed: "s", inputRevision: 1, createdAt: "2026-10-18", published: false, errors: [], shortages: [], assignments: [make("chief", "CHIEF", "chief"), make("department", "DEPARTMENT", "department"), make("hall1", "INVIGILATOR", "hall"), make("hall2", "BACKUP", "hall", "2026-10-20")] };
  return { w, run, make };
}
describe("four separate examination report files", () => {
  it("uses distinct filenames for the four combinations and marks drafts", () => {
    const names = ["10", "12"].flatMap((s) => ["THEORY", "PRACTICAL"].map((m) => workspaceReportFilename(fixture(s as "10" | "12", m as "THEORY" | "PRACTICAL").run)));
    expect(new Set(names).size).toBe(4);
    expect(names.every((name) => name.includes("DRAFT"))).toBe(true);
  });
  it.each(["10", "12"] as const)("makes one tab per %s centre, with full school names", (standard) => {
    const { w, run } = fixture(standard);
    const sheets = workspaceReportSheets(w, run);
    expect(sheets.map((s) => s.name)).toEqual(standard === "10" ? ["010"] : ["120", "121"]);
    expect(sheets[0]!.title).toContain(`Centre ${standard === "10" ? "010" : "120"}`);
    expect(sheets[0]!.subtitle).toContain("Synthetic school a");
  });
  it("displays all reserve staff as hall invigilators, merging alternating roles without losing dates", () => {
    const { w, run } = fixture(); const before = JSON.stringify(run);
    const sheet = workspaceReportSheets(w, run)[0]!;
    const halls = sheet.rows.filter((r) => r[1] === "Hall invigilator");
    expect(halls).toHaveLength(1);
    expect(halls[0]![5]).toBe("2026-10-19, 2026-10-20");
    expect(JSON.stringify(sheet)).not.toMatch(/backup|reserve|additional staff/i);
    expect(workspaceRoleLabel("BACKUP")).toBe("Hall invigilator");
    expect(JSON.stringify(run)).toBe(before);
  });
  it("keeps centres with only shortages visible and labels unfilled hall duties simply", () => {
    const { w, run } = fixture();
    run.shortages.push({ key: "missing", target: "121", role: "BACKUP", date: "2026-10-19", missing: 3, reasons: { "Beyond 10 km": 2 } });
    const sheets = workspaceReportSheets(w, run);
    expect(sheets.find((s) => s.name === "121")!.rows[0]).toContain("Unfilled (3)");
    expect(sheets.find((s) => s.name === "Unfilled duties")!.rows[0]![1]).toBe("Hall invigilator");
  });
  it("retains the optional consolidated chief and department report", () => {
    const { w, run } = fixture(); const sheets = workspaceReportSheets(w, run, true);
    expect(sheets).toHaveLength(1);expect(sheets[0]!.name).toBe("Chief and department");expect(sheets[0]!.rows).toHaveLength(2);
  });
  it("sanitises long, forbidden, reserved and case-colliding centre tab names without losing centre codes", () => {
    const { w, run } = fixture();run.assignments = [];
    const codes = ["History", "Other officers", "A/B", "A:B", "case", "CASE", "x".repeat(60), "x".repeat(59) + "y"];
    w.centres = codes.map((code) => ({ standard: "12", code, udise: "a", students: 20, clubbedUdise: [] }));
    const sheets = workspaceReportSheets(w, run);
    expect(new Set(sheets.map((s) => s.name.toLowerCase())).size).toBe(codes.length);
    expect(sheets.every((s) => s.name.length <= 31 && !/[\\/?*\[\]:]/.test(s.name) && s.name.toLowerCase() !== "history")).toBe(true);
    expect(codes.every((code) => sheets.some((s) => s.title.endsWith(`Centre ${code}`)))).toBe(true);
  });
  it.each(["10", "12"] as const)("keeps %s practical in its own sheet with both examiners and batch information", (standard) => {
    const { w, run, make } = fixture(standard, "PRACTICAL");
    w.practical = [{ id: "p", standard, udise: "b", subject: "PHY", students: 30, cohort: "A", centreUdise: "a", allowedCentreUdise: [], halls: 1, dates: ["2026-10-19"] }];
    run.assignments = [make("i", "INTERNAL", "internal"), make("e", "EXTERNAL", "external")].map((a) => ({ ...a, demandId: "p", batch: 1, students: 30 }));
    const sheets = workspaceReportSheets(w, run);
    expect(sheets).toHaveLength(1);expect(sheets[0]!.name).toBe("Practical duties");
    expect(sheets[0]!.rows[0]!.slice(3, 6)).toEqual(["PHY", 1, 30]);
    expect(sheets[0]!.rows[0]!.slice(8, 10)).toEqual(["Synthetic internal", "Synthetic external"]);
  });
  it("creates real XLSX tabs with frozen print headings and no backup designation", async () => {
    const { w, run } = fixture();const book = buildWorkspaceReportWorkbook(w, run);
    const buffer = await book.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(book.worksheets.map((s) => s.name)).toEqual(["120", "121"]);
    expect(book.getWorksheet("120")!.getCell("A1").value).toContain("Centre 120");
    expect(book.getWorksheet("120")!.getCell("B7").value).toBe("Hall invigilator");
    expect(book.getWorksheet("120")!.pageSetup.printTitlesRow).toBe("1:4");
  });
  it("rejects a mixed-standard result rather than silently combining files", () => {
    const { w, run } = fixture();run.assignments[0]!.standard = "10";
    expect(() => workspaceReportSheets(w, run)).toThrow("another standard");
  });
});
