/** Private supplied data stays in CLI input/output paths, never in source control. */
import { readFileSync, writeFileSync } from "node:fs";
import { allocateWorkspace } from "../allocation-engine/src/workspace.ts";
import { validateWorkspaceRun } from "../validator/src/workspace.ts";
import { workspaceManualCandidates } from "../validator/src/workspaceManual.ts";
import { WORKSPACE_PRACTICAL_SUBJECTS, WORKSPACE_PRACTICAL_SOURCES, workspaceSubject,
  type ExamWorkspace, type WorkspaceRun } from "../shared/src/index.ts";

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error("Pass the private source review JSON and private output JSON paths.");
const a = JSON.parse(readFileSync(source, "utf8"));
const w: ExamWorkspace = structuredClone(a.workspace);
for (const t of w.staff) {
  t.appointedSubject = workspaceSubject(t.appointedSubject);
  t.handlingSubjects = t.handlingSubjects.map(workspaceSubject);
}
w.name = "October 2026 five-day demo — sample exam details";
w.centres.push(...w.centres.map((c) => ({ ...c, standard: "12" as const })));
w.points.push(...w.points.map((p) => ({ ...p, standard: "12" as const })));
w.routes.push(...w.routes.map((r) => ({ ...r, standard: "12" as const })));
const days = [19, 20, 21, 22, 23].map((day) => `2026-10-${day}`);
w.practical = [];
const coverage: { standard: string; subject: string; code: string; staff: number; groups: number }[] = [];
for (const standard of ["10", "12"] as const) {
  const eligible = w.staff.filter((t) => t.category === "TEACHING" && t.postDate && t.post === (standard === "10" ? "BT" : "PG")
    && (standard === "12" || (t.standards.includes("10") && t.handlingSubjects.includes("SCI"))));
  for (const [subjectIndex, subject] of WORKSPACE_PRACTICAL_SUBJECTS[standard].entries()) {
    const code = workspaceSubject(subject);
    const teachers = eligible.filter((t) => standard === "10" || t.appointedSubject === code || t.handlingSubjects.includes(code));
    const schools = [...new Set(teachers.map((t) => t.udise))].sort().filter((udise) => w.schools.some((s) => s.udise === udise && s.management !== "UNKNOWN"));
    for (const udise of schools) {
      const schoolIndex = w.schools.findIndex((s) => s.udise === udise);
      // Shared science cohort has at most one practical each day. Other papers
      // use separate illustrative cohorts, not assumed official student groups.
      const science = ["PHY", "CHE", "BIO", "CS"].includes(code);
      const offset = science ? ["PHY", "CHE", "BIO", "CS"].indexOf(code) : subjectIndex;
      w.practical.push({ id: `DEMO-${standard}-${udise}-${subjectIndex + 1}`, standard, udise, subject: code,
        students: 30, cohort: science ? "DEMO-SCIENCE" : `DEMO-${code}`, centreUdise: udise,
        allowedCentreUdise: [], halls: 1, dates: [days[(schoolIndex + offset) % 5]!] });
    }
    coverage.push({ standard, subject, code, staff: teachers.length, groups: schools.length });
  }
}
w.timetable = ["TAM", "ENG", "MAT", "SCI", "SOC"].map((subject, i) => ({ standard: "10", date: `2026-10-${26 + i}`, session: "MORNING", subject, centreCode: "" }));
const paperGroups = [
  ["Tamil"], ["English"], ["Chemistry", "Accountancy", "Geography"], ["Physics", "Economics", "Employability Skills"],
  ["Mathematics", "Zoology", "Commerce", "Micro Biology", "Nutrition and Dietetics", "Textiles and Dress Designing", "Food Service Management", "Agricultural Science", "Nursing (General)"],
  ["Biology", "Botany", "History", "Business Mathematics and Statistics", "Basic Electronics Engineering", "Basic Civil Engineering", "Basic Automobile Engineering", "Basic Mechanical Engineering", "Textile Technology", "Office Management and Secretaryship"],
  ["Communicative English", "Ethics and Indian Culture", "Computer Science", "Computer Applications", "Bio Chemistry", "Advanced Language (Tamil)", "Home Science", "Political Science", "Statistics", "Nursing (Vocational)", "Basic Electrical Engineering"],
];
const schedule = [[2, "MORNING"], [2, "AFTERNOON"], [3, "MORNING"], [4, "MORNING"], [5, "MORNING"], [6, "MORNING"], [6, "AFTERNOON"]] as const;
paperGroups.forEach((subjects, i) => { const [day, session] = schedule[i]!; w.timetable.push(...subjects.map((subject) => ({ standard: "12" as const, date: `2026-11-0${day}`, session, subject: workspaceSubject(subject), centreCode: "" }))); });
const runs: WorkspaceRun[] = [];
for (const [standard, module] of [["10", "PRACTICAL"], ["12", "PRACTICAL"], ["10", "THEORY"], ["12", "THEORY"]] as const) {
  const other = runs.flatMap((r) => r.assignments);
  const result = allocateWorkspace(w, standard, module, "OCTOBER-FIVE-DAY-DEMO", other);
  result.errors.push(...validateWorkspaceRun(w, result, other));
  const run = { ...result, id: `DEMO-${standard}-${module}`, createdAt: "2026-10-18T12:00:00Z", published: false };
  runs.push(run);
  console.log(JSON.stringify({ standard, module, assignments: run.assignments.length, gaps: run.shortages.length, errors: run.errors.slice(0, 8) }));
}
const theory = runs.find((r) => r.standard === "10" && r.module === "THEORY")!;
const available = theory.shortages.map((gap) => ({ key: gap.key, role: gap.role, target: gap.target,
  candidates: workspaceManualCandidates(w, theory, gap.key, runs.filter((r) => r !== theory).flatMap((r) => r.assignments)).slice(0, 5) }));
writeFileSync(output, JSON.stringify({ workspace: w, runs, coverage, available, sources: WORKSPACE_PRACTICAL_SOURCES,
  assumptions: ["All supplied school/staff records remain unchanged.", "Only the 29 previously resolved SSLC centres are used for theory, not all 118 PDF centres.",
    "The 12th demo reuses these 10th centre codes, strengths, clubbing, point and route locations. These are not official HSC strengths or officer plans.",
    "Practical student groups are illustrative: 30 students, one room per subject, 19–23 October 2026. They are not enrolment counts supplied by schools.",
    "Only subjects with a matching eligible internal in Teacher Master get illustrative groups. The coverage table lists every reference subject, including those not represented.",
    "10th theory: 26–30 October. 12th theory: 2–6 November, including two sessions on days 1 and 5. All are demo dates, not official examination schedules.",
    "DEO staff have not been supplied. Shortages remain visible. No staff, qualification or coordinates have been invented.",
    "Available staff are suggestions only. No distance exception is approved and no official duty order is issued by this script."] }));
