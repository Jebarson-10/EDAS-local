import { useMemo } from "react";
import type {
  ExamWorkspace,
  WorkspaceRun,
  WorkspaceStandard,
} from "@exam-duty/shared";

type Destination =
  | "inputs"
  | "schools"
  | "staff"
  | "exam"
  | "timetable"
  | "theory"
  | "practical"
  | "locations";
export function WorkspaceDashboard({
  workspace,
  standard,
  runs,
  onNavigate,
}: {
  workspace: ExamWorkspace;
  standard: WorkspaceStandard;
  runs: WorkspaceRun[];
  onNavigate: (tab: Destination) => void;
}) {
  const summary = useMemo(() => {
    const centres = workspace.centres.filter((c) => c.standard === standard);
    const teachers = workspace.staff.filter(
      (t) => t.category === "TEACHING",
    ).length;
    const latest = runs.find(
      (r) => r.standard === standard && r.module === "THEORY",
    );
    return {
      centres,
      teachers,
      students: centres.reduce((s, c) => s + c.students, 0),
      dates: new Set(
        workspace.timetable
          .filter((t) => t.standard === standard)
          .map((t) => t.date),
      ).size,
      blocks: new Set(workspace.schools.map((s) => s.block)).size,
      missingDates: workspace.staff.filter((t) => !t.postDate).length,
      missingLocations: workspace.schools.filter(
        (s) => s.latitude == null || s.longitude == null,
      ).length,
      latest,
    };
  }, [workspace, standard, runs]);
  const metrics = [
    ["Schools", workspace.schools.length, "schools"],
    ["Teaching staff", summary.teachers, "staff"],
    ["Non-teaching staff", workspace.staff.length - summary.teachers, "staff"],
    [`${standard}th centres`, summary.centres.length, "exam"],
    [
      `${standard}th students`,
      summary.centres.length
        ? summary.students.toLocaleString("en-IN")
        : "Not entered",
      "exam",
    ],
    ["Exam days", summary.dates, "timetable"],
  ] as const;
  const steps = [
    [
      "Schools and locations",
      workspace.schools.length
        ? `${workspace.schools.length} schools in ${summary.blocks} blocks. ${summary.missingLocations} missing coordinates.`
        : "Upload School Master.",
      "schools",
    ],
    [
      "Staff and seniority",
      workspace.staff.length
        ? `${workspace.staff.length.toLocaleString("en-IN")} staff. ${summary.missingDates} missing present-post dates.`
        : "Upload Teacher Master after schools.",
      "staff",
    ],
    [
      "Centres and students",
      summary.centres.length
        ? `${summary.centres.length} centres; ${summary.students.toLocaleString("en-IN")} students entered.`
        : "Upload centre codes and total student strength.",
      "exam",
    ],
    [
      "Timetable",
      summary.dates
        ? `${summary.dates} exam dates entered for ${standard}th.`
        : "Upload date, session and subject for each exam.",
      "timetable",
    ],
  ] as const;
  return (
    <div className="space-y-5" data-testid="workspace-dashboard">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-[#183B4C]">
          {standard}th standard dashboard
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {workspace.name}. Schools and staff are shared with the other standard
          in this cycle. Student totals come from the centre strengths you
          enter.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
          {metrics.map(([label, value, target]) => (
            <button
              key={label}
              onClick={() => onNavigate(target)}
              className="rounded-xl border border-slate-200 p-4 text-left hover:border-slate-400"
            >
              <span className="block text-sm text-slate-600">{label}</span>
              <strong className="mt-1 block text-2xl text-[#183B4C]">
                {typeof value === "number"
                  ? value.toLocaleString("en-IN")
                  : value}
              </strong>
            </button>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-semibold text-[#183B4C]">
          Prepare this examination
        </h2>
        <div className="space-y-4">
          {steps.map(([title, note, target]) => (
            <button
              key={title}
              onClick={() => onNavigate(target)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span>
                <b className="block text-sm">{title}</b>
                <span className="text-sm text-slate-600">{note}</span>
              </span>
              <span className="text-sm text-teal-800 underline">Open</span>
            </button>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-semibold text-[#183B4C]">
          Duty lists
        </h2>
        <p className="text-sm">
          {summary.latest
            ? `Latest theory list: ${summary.latest.assignments.length} duty entries, ${summary.latest.shortages.reduce((sum, s) => sum + s.missing, 0)} unfilled posts. ${summary.latest.published ? "Confirmed." : "Draft."}`
            : "No theory list generated for this standard yet."}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {[
            ["Theory duties", "theory"],
            ["Practical duties", "practical"],
            ["School map", "locations"],
          ].map(([label, target]) => (
            <button
              key={target}
              onClick={() => onNavigate(target as Destination)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
