import type { ExamWorkspace, WorkspaceAssignment, WorkspaceRun } from "@exam-duty/shared";

const roleLabels: Record<string, string> = {
  CHIEF: "Chief superintendent", DEPARTMENT: "Departmental officer",
  INVIGILATOR: "Hall invigilator", BACKUP: "Hall invigilator",
  JUNIOR_ASSISTANT: "Junior assistant", OFFICE_ASSISTANT: "Office assistant",
  CUSTODIAN: "Custodian", SECONDARY_CUSTODIAN: "Secondary custodian",
  LIAISON: "Liaison officer", SECONDARY_LIAISON: "Secondary liaison officer",
  ROUTE: "Route officer", SQUAD: "Squad", INTERNAL: "Internal examiner", EXTERNAL: "External examiner",
};
export const workspaceRoleLabel = (role: string) => roleLabels[role] ?? role;
export interface WorkspaceReportSheet {
  name: string;
  title: string;
  subtitle: string;
  headers: string[];
  widths: number[];
  rows: (string | number | null)[][];
  /** Zero-based columns whose ISO strings should be written as Excel dates. */
  dateColumns?: number[];
}
export function workspaceReportFilename(run: WorkspaceRun, chiefsOnly = false) {
  const draft = !run.published || run.shortages.length || run.errors.length;
  return `${run.standard}th-${run.module === "THEORY" ? "Theory" : "Practical"}-${chiefsOnly ? "Chief-and-Department" : "Duties"}-${draft ? "DRAFT-" : ""}${run.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12)}.xlsx`;
}

/** Presentation only: never changes assignments, duties, shortages or rule checks. */
export function workspaceReportSheets(w: ExamWorkspace, run: WorkspaceRun, chiefsOnly = false): WorkspaceReportSheet[] {
  if (run.assignments.some((a) => a.standard !== run.standard))
    throw new Error("This duty list contains another standard. Check the list before downloading.");
  const sheets: WorkspaceReportSheet[] = [];
  const staff = new Map(w.staff.map((t) => [t.staffId, t]));
  const schools = new Map(w.schools.map((s) => [s.udise, s]));
  const title = `${run.standard}th standard ${run.module.toLowerCase()} duties`;
  const status = !run.published || run.shortages.length || run.errors.length ? "Draft - not a confirmed duty order" : "Confirmed duty list";
  const core = ["CHIEF", "DEPARTMENT", "INVIGILATOR", "BACKUP", "JUNIOR_ASSISTANT", "OFFICE_ASSISTANT"];
  const displayRole = (a: WorkspaceAssignment) => a.role === "BACKUP" ? "INVIGILATOR" : a.role;
  const grouped = new Map<string, WorkspaceAssignment[]>();
  for (const a of run.assignments.filter((a) => core.includes(a.role))) {
    // The same person may alternate between ordinary and reserve duties.
    // Display them once with all their hall-invigilation dates, not twice.
    const key = `${a.centreCode}|${displayRole(a)}|${a.staffId}|${a.session}`;
    const group = grouped.get(key) ?? [];
    group.push(a); grouped.set(key, group);
  }
  const groups = [...grouped.values()].sort((x, y) => {
    const a = x[0]!, b = y[0]!;
    return a.centreCode.localeCompare(b.centreCode, "en", { numeric: true })
      || core.indexOf(displayRole(a)) - core.indexOf(displayRole(b))
      || (staff.get(a.staffId)?.name ?? a.staffId).localeCompare(staff.get(b.staffId)?.name ?? b.staffId)
      || a.staffId.localeCompare(b.staffId) || a.session.localeCompare(b.session);
  });
  const personRow = (group: WorkspaceAssignment[]) => {
    const a = group[0]!, t = staff.get(a.staffId);
    return [workspaceRoleLabel(a.role), t?.name ?? a.staffId, t?.originalPost ?? "", schools.get(t?.udise ?? "")?.name ?? t?.udise ?? "",
      [...new Set(group.map((g) => g.date))].sort().join(", "), a.session === "MORNING" ? "Morning" : "Afternoon"];
  };
  if (run.module === "PRACTICAL") {
    const sheet: WorkspaceReportSheet = { name: "Practical duties", title, subtitle: status,
      headers: ["Centre code", "Receiving school", "Student school", "Subject", "Batch", "Students", "Date", "Session", "Internal examiner", "External examiner", "External school"],
      widths: [16, 48, 48, 28, 10, 12, 16, 16, 30, 30, 48], rows: [], dateColumns: [6] };
    const pairs = new Map(run.assignments.filter((a) => a.role === "INTERNAL").map((a) => [`${a.demandId}|${a.batch}|${a.date}|${a.session}`, a]));
    const demands = new Map(w.practical.filter((p) => p.standard === run.standard).map((p) => [p.id, p]));
    for (const a of run.assignments.filter((a) => a.role === "EXTERNAL").sort((a, b) => a.centreUdise.localeCompare(b.centreUdise) || a.date.localeCompare(b.date) || a.session.localeCompare(b.session) || a.subject.localeCompare(b.subject) || (a.batch ?? 0) - (b.batch ?? 0))) {
      const internal = pairs.get(`${a.demandId}|${a.batch}|${a.date}|${a.session}`);
      sheet.rows.push([a.centreCode, schools.get(a.centreUdise)?.name ?? a.centreUdise, schools.get(demands.get(a.demandId ?? "")?.udise ?? "")?.name ?? "",
        a.subject, a.batch ?? null, a.students ?? null, a.date, a.session === "MORNING" ? "Morning" : "Afternoon",
        staff.get(internal?.staffId ?? "")?.name ?? internal?.staffId ?? "", staff.get(a.staffId)?.name ?? a.staffId,
        schools.get(staff.get(a.staffId)?.udise ?? "")?.name ?? ""]);
    }
    sheets.push(sheet);
  } else if (chiefsOnly) {
    sheets.push({ name: "Chief and department", title: `${run.standard}th standard chief and departmental officers`, subtitle: status,
      headers: ["Centre code", "Centre school", "Duty", "Staff name", "Staff post", "From school", "Dates", "Session"], widths: [16, 48, 26, 30, 32, 48, 45, 16],
      rows: groups.filter((g) => ["CHIEF", "DEPARTMENT"].includes(g[0]!.role)).map((g) => [g[0]!.centreCode, schools.get(g[0]!.centreUdise)?.name ?? g[0]!.centreUdise, ...personRow(g)]) });
  } else {
    const reserved = new Set(["other officers", "manual changes", "unfilled duties", "history"]);
    const nameFor = (code: string) => {
      let base = Array.from(code)
        .map((character) => character.charCodeAt(0) < 32 || "\\/?*[]:".includes(character) ? " " : character)
        .join("").replace(/^'+|'+$/g, "").trim() || "Centre";
      if (base.toLowerCase() === "history") base = "Centre History";
      base = base.slice(0, 31);
      let name = base, n = 2;
      while (reserved.has(name.toLowerCase())) { const suffix = ` (${n++})`; name = base.slice(0, 31 - suffix.length) + suffix; }
      reserved.add(name.toLowerCase()); return name;
    };
    const centres = new Map(w.centres.filter((c) => c.standard === run.standard).map((c) => [c.code, c.udise]));
    for (const group of groups) centres.set(group[0]!.centreCode, group[0]!.centreUdise);
    for (const [code, udise] of [...centres].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))) {
      const rows = groups.filter((g) => g[0]!.centreCode === code).map((g, i) => [i + 1, ...personRow(g)]);
      for (const gap of run.shortages.filter((s) => s.target === code && core.includes(s.role)))
        rows.push([rows.length + 1, workspaceRoleLabel(gap.role), `Unfilled (${gap.missing})`, "", "", gap.date, ""]);
      sheets.push({ name: nameFor(code), title: `${title} - Centre ${code}`, subtitle: `${schools.get(udise)?.name ?? udise}\n${status}`,
        headers: ["No.", "Duty", "Staff name", "Staff post", "From school", "Dates", "Session"], widths: [8, 26, 30, 32, 48, 45, 16], rows });
    }
    const other = run.assignments.filter((a) => !core.includes(a.role));
    if (other.length) sheets.push({ name: "Other officers", title, subtitle: status,
      headers: ["Point or centre", "Duty", "Staff", "School", "Date", "Session"], widths: [48, 28, 30, 48, 16, 16], dateColumns: [4],
      rows: other.map((a) => [a.centreCode, workspaceRoleLabel(a.role), staff.get(a.staffId)?.name ?? a.staffId,
        schools.get(staff.get(a.staffId)?.udise ?? "")?.name ?? "", a.date, a.session === "MORNING" ? "Morning" : "Afternoon"]) });
    if (!sheets.length) sheets.push({ name: "Centre duties", title, subtitle: status, headers: ["Status"], widths: [65], rows: [["No centre duties have been assigned in this list."]] });
  }
  const manual = run.assignments.filter((a) => a.manual);
  if (manual.length) sheets.push({ name: "Manual changes", title, subtitle: status,
    headers: ["Centre or point", "Duty", "Staff", "Date", "Session", "Distance exception", "Reason", "Approved at", "Previous list"],
    widths: [24, 26, 30, 16, 16, 22, 65, 28, 38], dateColumns: [3],
    rows: manual.map((a) => [a.centreCode, workspaceRoleLabel(a.role), staff.get(a.staffId)?.name ?? a.staffId, a.date,
      a.session === "MORNING" ? "Morning" : "Afternoon", a.manual!.distanceException ? "Approved" : "No", a.manual!.reason, a.manual!.approvedAt, a.manual!.parentRunId]) });
  if (run.shortages.length || run.errors.length) sheets.push({ name: "Unfilled duties", title, subtitle: status,
    headers: ["Centre or point", "Duty", "Missing", "Dates", "Reason"], widths: [48, 26, 12, 45, 90],
    rows: [...run.shortages.map((gap) => [gap.target, workspaceRoleLabel(gap.role), gap.missing, gap.date,
      Object.entries(gap.reasons).map(([reason, count]) => `${reason}: ${count}`).join("; ")]), ...run.errors.map((error) => ["", "", "", "", error])] });
  return sheets;
}
