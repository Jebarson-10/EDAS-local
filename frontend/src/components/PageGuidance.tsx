import { useState, type ReactNode } from "react";
import { useApp, isTheoryRun } from "../state/AppContext";
import { latestRunForModuleInCycle, formatDutyRole, importFields } from "@exam-duty/shared";
import type { PracticalResult, HallResult } from "@exam-duty/allocation-engine";

const fieldHelp: Array<[RegExp, string, string]> = [
  [/generate|allot|allocation/i, "Generate duties", "Generate uses your saved staff, centres, dates, rules, exemptions and earlier duties. Check the saved result and shortages here before approving. Update missing information and generate again if needed."],
  [/13a|centre checklist/i, "13A centre input", "Import the official 13A list for actual centre codes, host and clubbed schools, and student strength. Review the school matches before saving."],
  [/centre code|school code|schoolCode/i, "Centre code", "Enter the official examination centre code only if the school is a centre. Leave it blank for other schools. A school reference from OVER ALL is kept separately; 13A supplies the centre code."],
  [/source school|reference/i, "School reference", "The school reference identifies a school in the staff return. It does not make that school an examination centre."],
  [/staff group|staffCategory/i, "Staff group", "Teaching staff can receive teaching duties. Non-teaching staff such as lab assistants, record clerks and sweepers can receive the two office-helper duties at each centre."],
  [/designation|teacher post|post or|^post$/i, "Staff post", "HM or Principal: chief examiner. PG: departmental officer and 12th practical. BT: hall and relevant-subject 10th practical. Special teachers: hall only. SGT: hall only when other eligible staff are insufficient. Office helpers must be non-teaching staff."],
  [/subject|handling/i, "Handling subject", "Choose the subject the teacher actually handles for this standard. A qualification or major subject alone is not enough for practical duty. Practical student counts must be entered separately for each school and subject."],
  [/latitude|longitude|coordinates|location|address/i, "Location", "Search the offline school/address list and select the correct place to fill in the numbers. Save the record afterward. The 10 km check uses straight-line distance from the teacher’s home OR current school to the centre. Verify the school entrance or campus, rather than a town’s approximate location."],
  [/seniority/i, "Seniority", "A smaller rank means more senior. Seniority helps choose chief and departmental officers; chief selection checks the block first, then the district. Previous duty dates also help give others their turn."],
  [/previous|history|last duty|recent duty/i, "Previous duties", "Enter actual duty dates, centres and staff names. The previous two years’ centre records prevent repeat postings. Recent duties help fair rotation; previous practical pairs help alternate roles when eligible."],
  [/joining|appointment|retirement/i, "Staff dates", "Use the actual appointment or joining date from the staff record. Retirement and leave remarks should be reviewed before duty generation."],
  [/student|strength|capacity|batch/i, "Student strength and batches", "Theory uses total centre strength: one invigilator per 20 students plus 10% standby; above 500 students needs two departmental officers. Practical uses school-and-subject counts, balanced into batches of up to 50."],
  [/clubb|host/i, "Host and clubbed schools", "Link every school whose students attend this centre. Staff from any of these schools must be excluded from theory and hall duty at this centre."],
  [/exempt|health|leave/i, "Exemptions", "Review health and leave remarks and mark excluded staff with the applicable dates. Physically challenged staff and manually exempted staff are not allotted during those dates."],
  [/session|morning|afternoon/i, "Exam session", "Choose Morning or Afternoon. One teacher cannot receive two duties in the same date and session, including across theory, practical and hall."],
  [/date|timetable|window/i, "Exam dates", "Enter official examination dates and sessions. The timetable creates theory and hall slots; the practical date window limits practical scheduling. Dates must be on or after the allowed current date."],
  [/block/i, "Block", "Choose the school’s block from the saved list. The same school and its teachers must use the same block so block-first seniority works correctly."],
  [/teacher code|employee|teacherCode/i, "Teacher code", "Optional official staff or EMIS reference. Names and school details are still needed. Never use a row serial number as the staff name."],
  [/teacher name|^name$/i, "Staff name", "Use the full name from the staff return. Keep the post, school and subject on the same row. Check staff with identical names before saving."],
  [/school/i, "School", "Choose the teacher’s current school from the saved list. The timetable school list comes from these saved schools. OVER ALL can create schools; review matches before saving."],
  [/save|apply/i, "Save changes", "Check the preview and correct highlighted rows before saving. Wait for the saved confirmation. Blank cells keep existing information unchanged; previous published duties are preserved."],
  [/download|template/i, "Excel templates and downloads", "The template shows the expected headings. Imported columns can be in any order. Duty downloads use the latest saved result for this examination."],
];

const pageHelp: Record<string, { title: string; steps: string[] }> = {
  "/imports": { title: "Add your input files", steps: ["1. Import OVER ALL for staff and schools; review the matched school, post and handling subject.", "2. Import 13A for centre codes, host/clubbed schools and student strength.", "3. Add practical student counts by school and subject, and previous duty history.", "4. Save corrections, add locations, then set the timetable in Exam & timetable."] },
  "/master": { title: "Schools and staff", steps: ["Choose a record to edit, or add a new school, block or staff member.", "A centre code makes a school a centre. Other schools keep this field blank.", "Use Find location to fill in coordinates from the offline map list, then save."] },
  "/cycles": { title: "Set the examination", steps: ["Choose standard 10 or 12 and the official examination dates.", "Add each date, session, subject and school (or all schools) to the timetable.", "Review and approve saved duty lists before publishing them into history."] },
  "/theory": { title: "Allot theory duties", steps: ["Save staff, centres, clubbed schools, locations, timetable, exemptions and previous duties first.", "Generate chief, departmental officer, office-helper and saved custodian duties here.", "Generate Hall next for invigilators, then download the complete centre-wise list at the top."] },
  "/practical": { title: "Allot practical duties", steps: ["Add actual student counts for each school and subject.", "Standard 10 needs relevant-subject BT staff; standard 12 needs relevant-subject PG staff.", "Set practical dates. Generate, check missing batches and download the examiner list at the top."] },
  "/hall": { title: "Allot hall duties", steps: ["Generate theory first so its staff are not double-booked.", "Hall counts use centre strength: 20 students per hall plus 10% standby.", "Check shortages, then download the combined centre duty order from Theory."] },
};

const reasonHelp: Record<string, string> = {
  "RULE-THEORY-DISTANCE": "Outside the distance limit or missing a usable location",
  "RULE-THEORY-ROLE": "Staff post does not match this duty",
  "RULE-THEORY-STAFF-CATEGORY": "Teaching / non-teaching group does not match",
  "RULE-CUSTODIAN-POST": "Custodian requires PG or BT staff",
  "RULE-THEORY-SPECIAL-TEACHER": "Special teachers are eligible for hall duty only",
  "RULE-THEORY-OWN-SCHOOL": "Belongs to the centre or a clubbed school",
  "RULE-THEORY-002": "Served at this centre in the previous two years",
  "RULE-THEORY-CONFLICT": "Already has a duty in this session",
  "RULE-THEORY-EXEMPT": "Exempt for these dates",
  "RULE-THEORY-INACTIVE": "Staff record is inactive",
  UNKNOWN_CENTRE: "Centre record is missing",
};

function ResultSummary({ path }: { path: string }) {
  const { runs, examCycle, dataset } = useApp();
  const module = path === "/theory" ? "THEORY" : path === "/practical" ? "PRACTICAL" : "HALL";
  const latest = latestRunForModuleInCycle(runs, module, examCycle.examCycleId);
  if (!latest?.result) return <p className="text-sm text-[var(--color-ink-muted)]">The saved result summary will appear here after generation.</p>;
  if (module === "THEORY" && isTheoryRun(latest)) {
    const missing = latest.result.shortages;
    const roles = new Map<string, number>();
    const reasons = new Map<string, { duties: number; checks: number }>();
    for (const item of missing) {
      const role = ["CHIEF_EXAMINATION", "DEPARTMENT_OFFICER", "OFFICE_STAFF", "CUSTODIAN"].find((value) => item.requirementKey.includes(value));
      const label = role ? formatDutyRole(role) : "Other duty";
      roles.set(label, (roles.get(label) ?? 0) + item.shortage);
      for (const [code, count] of Object.entries(item.exclusionTallies ?? {})) {
        if (count <= 0) continue;
        const previous = reasons.get(code) ?? { duties: 0, checks: 0 };
        reasons.set(code, { duties: previous.duties + item.shortage, checks: previous.checks + count });
      }
    }
    return <>
      <p className="text-sm">{latest.result.assignments.length} duties filled · {missing.reduce((sum, item) => sum + item.shortage, 0)} unfilled</p>
      {!!roles.size && <><h3 className="mt-4 text-sm font-semibold">Missing staff by duty</h3><ul className="mt-2 space-y-2 text-sm">{[...roles].map(([label, count]) => <li key={label} className="flex justify-between gap-2"><span>{label}</span><strong>{count}</strong></li>)}</ul></>}
      {!!reasons.size && <><h3 className="mt-4 text-sm font-semibold">Reasons recorded for unfilled duties</h3><ul className="mt-2 space-y-3 text-xs">{[...reasons].sort((a, b) => b[1].duties - a[1].duties).map(([code, value]) => <li key={code}><p>{reasonHelp[code] ?? "Other eligibility check"}</p><p className="mt-1 text-[var(--color-ink-muted)]">Affected {value.duties} unfilled duties · {value.checks} candidate checks</p></li>)}</ul><p className="mt-3 text-xs text-[var(--color-ink-muted)]">Reasons overlap. These are candidate exclusion checks, not separate shortage totals. Location and post counts can apply to the same duty.</p></>}
      {!missing.length && (latest.result.feasible ? <p className="mt-3 text-sm text-[var(--color-ok)]">All requested theory duties are filled.</p> : <p className="mt-3 text-sm">This saved list is incomplete, but has no detailed shortage reasons. Generate again to record them.</p>)}
    </>;
  }
  if (module === "PRACTICAL") {
    const result = latest.result as PracticalResult;
    const scheduled = new Set(result.schedules.map((item) => item.batchKey));
    const missing = result.batches.filter((item) => !scheduled.has(item.batchKey));
    return <>
      <p className="text-sm">{result.schedules.length} batches scheduled · {missing.length} not scheduled</p>
      {result.diagnostics?.map((item, index) => <div key={index} className="mt-4 text-sm"><p className="font-semibold">{dataset?.schools.find(s => s.schoolId === item.schoolId)?.schoolName ?? item.schoolId} · {item.subjectId}</p><p className="mt-1">{item.message}</p><ul className="mt-2 space-y-1 text-xs">{Object.entries(item.exclusionTallies).filter(([, count]) => count > 0).map(([reason, count]) => <li key={reason}>{reason}: {count} staff checks</li>)}</ul></div>)}
      {!result.diagnostics?.length && !result.feasible && <p className="mt-3 text-sm">{result.message && result.message !== "Hydrated from API" ? result.message : "The saved list is incomplete. Generate again to record detailed shortage reasons."}</p>}
      {!!missing.length && <><h3 className="mt-4 text-sm font-semibold">Batches still needed</h3><ul className="mt-2 space-y-2 text-xs">{missing.slice(0, 12).map(item => <li key={item.batchKey}>{dataset?.schools.find(s => s.schoolId === item.schoolId)?.schoolName ?? item.schoolId} · {item.subjectId} · Batch {item.batchIndex}</li>)}</ul>{missing.length > 12 && <p className="mt-2 text-xs">And {missing.length - 12} more batches.</p>}<p className="mt-3 text-xs text-[var(--color-ink-muted)]">Scheduling stops at the first unresolved school/subject. Later unscheduled batches have not all been assessed. Practical duties do not currently use the theory/hall 10 km check.</p></>}
    </>;
  }
  const result = latest.result as HallResult;
  return <><p className="text-sm">{result.assignments.length} hall and standby duties filled · {result.shortages.reduce((sum, item) => sum + item.shortage, 0)} unfilled</p>{result.shortages.map((item, index) => <p key={index} className="mt-3 text-xs">{dataset?.centres.find(c => c.centreId === item.centreId)?.centreName ?? item.centreId}: needs {item.required}, eligible {item.eligible}, missing {item.shortage}.</p>)}<p className="mt-3 text-xs text-[var(--color-ink-muted)]">Hall eligibility checks post, location, own/clubbed school, previous centre duty, exemptions and session conflicts.</p></>;
}

export function PageGuidance({ path, children }: { path: string; children: ReactNode }) {
  const [selection, setSelection] = useState<{ title: string; body: string } | null>(null);
  const guide = pageHelp[path];
  if (!guide) return <>{children}</>;
  function inspect(target: EventTarget) {
    if (!(target instanceof HTMLElement)) return;
    const element = target.closest<HTMLElement>("[data-help], label, th, h2, h3, button, input, select, textarea");
    if (!element) return;
    const label = element.closest("label");
    const ownLabel = label ? Array.from(label.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(" ") : "";
    const mapping = element instanceof HTMLSelectElement && element.getAttribute("aria-label")?.includes(" field") ? importFields[element.value as keyof typeof importFields] ?? "" : "";
    const text = element.dataset.help ?? (mapping || ownLabel || element.getAttribute("aria-label") || element.textContent || "");
    const match = fieldHelp.find(([pattern]) => pattern.test(text));
    const next = match ? { title: match[1], body: match[2] } : { title: text.trim().slice(0, 70) || "This field", body: "Enter the matching detail from your official file. Keep the school and staff details on the same row, check the preview, and save your changes." };
    setSelection(previous => previous?.title === next.title && previous.body === next.body ? previous : next);
  }
  return <div className="guided-page">
    <div className="min-w-0" onMouseOver={event => inspect(event.target)} onFocusCapture={event => inspect(event.target)}>{children}</div>
    <aside className="guidance-panel" aria-label="Page instructions and duty summary">
      <section><p className="guidance-eyebrow">On this page</p><h2 className="mt-2 text-base font-semibold">{guide.title}</h2><ul className="mt-3 space-y-3 text-sm text-[var(--color-ink-muted)]">{guide.steps.map(step => <li key={step}>{step}</li>)}</ul></section>
      <section className="mt-5 border-t border-[var(--color-line)] pt-4"><p className="guidance-eyebrow">Field instructions</p><div role="status" aria-live="polite" aria-atomic="true"><h3 className="mt-2 text-sm font-semibold">{selection?.title ?? "Point to a field"}</h3><p className="mt-2 text-sm text-[var(--color-ink-muted)]">{selection?.body ?? "Hover over a heading or field, click it, or use the Tab key. Its explanation appears here."}</p></div></section>
      {["/theory", "/practical", "/hall"].includes(path) && <section className="mt-5 border-t border-[var(--color-line)] pt-4" data-testid="duty-summary"><p className="guidance-eyebrow mb-3">Latest saved result</p><ResultSummary path={path} /></section>}
    </aside>
  </div>;
}
