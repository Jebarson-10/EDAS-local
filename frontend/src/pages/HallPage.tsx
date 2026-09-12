import { useState } from "react";
import {
  allocateHall,
  calculateHallRequirements,
  type HallResult,
} from "@exam-duty/allocation-engine";
import { validateHallAllocation } from "@exam-duty/validator";
import { useApp } from "../state/AppContext";
import { crossModuleCalendar } from "../lib/crossModuleCalendar";
import {
  assertMutable,
  catalogUsableForGenerate,
  firstUnusableGenerateCatalogLabel,
  latestRunForModuleInCycle,
  shouldApplySessionAfterApi,
} from "@exam-duty/shared";
import {
  Bento,
  EmptyState,
  Panel,
  Stat as UiStat,
  Tile,
  TileHeader,
} from "../components/ui";

export function HallPage() {
  const {
    dataset,
    rules,
    role,
    logAudit,
    addRun,
    examCycle,
    runs,
    exemptions,
    hydrateReady,
    hydrateReport,
    timetable,
    timetableState,
  } = useApp();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!dataset) return <Panel title="Hall invigilation">Loading…</Panel>;
  const canRun = role === "ADMIN" || role === "OFFICER";
  const cycleMutable = assertMutable(examCycle.status, "generate allocation").ok;
  const cyclesOutcome = hydrateReport.sources.exam_cycles;
  const cyclesReady = catalogUsableForGenerate(hydrateReady, cyclesOutcome);
  const centresOutcome = hydrateReport.sources.centres;
  const centresReady = catalogUsableForGenerate(hydrateReady, centresOutcome);
  const relationshipsOutcome = hydrateReport.sources.relationships;
  const relationshipsReady = catalogUsableForGenerate(
    hydrateReady,
    relationshipsOutcome,
  );
  const exemptionsOutcome = hydrateReport.sources.exemptions;
  const exemptionsReady = catalogUsableForGenerate(
    hydrateReady,
    exemptionsOutcome,
  );
  const rulesOutcome = hydrateReport.sources.rule_parameters;
  const rulesReady = catalogUsableForGenerate(hydrateReady, rulesOutcome);
  const teachersOutcome = hydrateReport.sources.teachers;
  const teachersReady = catalogUsableForGenerate(hydrateReady, teachersOutcome);
  const schoolsOutcome = hydrateReport.sources.schools;
  const schoolsReady = catalogUsableForGenerate(hydrateReady, schoolsOutcome);
  const historyOutcome = hydrateReport.sources.duty_history;
  const historyReady = catalogUsableForGenerate(hydrateReady, historyOutcome);
  const runsOutcome = hydrateReport.sources.allocation_runs;
  const runsReady = catalogUsableForGenerate(hydrateReady, runsOutcome);
  const catalogBlock = firstUnusableGenerateCatalogLabel(hydrateReady, [
    { outcome: cyclesOutcome, failed: "Cycle unavailable", loading: "Loading cycle…" },
    {
      outcome: centresOutcome,
      failed: "Centres unavailable",
      loading: "Loading centres…",
    },
    {
      outcome: relationshipsOutcome,
      failed: "Clubbing unavailable",
      loading: "Loading clubbing…",
    },
    {
      outcome: teachersOutcome,
      failed: "Teachers unavailable",
      loading: "Loading teachers…",
    },
    {
      outcome: schoolsOutcome,
      failed: "Schools unavailable",
      loading: "Loading schools…",
    },
    {
      outcome: historyOutcome,
      failed: "Duty history unavailable",
      loading: "Loading duty history…",
    },
    {
      outcome: runsOutcome,
      failed: "Duty lists unavailable",
      loading: "Loading allocation runs…",
    },
    { outcome: rulesOutcome, failed: "Rules unavailable", loading: "Loading rules…" },
    {
      outcome: exemptionsOutcome,
      failed: "Exemptions unavailable",
      loading: "Loading exemptions…",
    },
  ]);
  const demo = calculateHallRequirements(
    200,
    rules.students_per_hall,
    rules.standby_percentage,
  );
  const latest = latestRunForModuleInCycle(
    runs,
    "HALL",
    examCycle.examCycleId,
  );
  const hallResult = latest?.result as HallResult | null | undefined;
  const hallSessions = timetable.filter((entry) => entry.requiresHall);
  const examDate = hallSessions.map((entry) => entry.examDate).sort()[0] ?? "";

  function run() {
    if (!dataset || busy) return;
    if (timetableState !== "ready" || hallSessions.length === 0) {
      setText("Add at least one timetable session marked Hall duty before allocating hall duties.");
      return;
    }
    const gate = assertMutable(examCycle.status, "generate allocation");
    if (!gate.ok) {
      setText(gate.error);
      logAudit("GENERATE_ALLOCATION", gate.error);
      return;
    }
    if (!cyclesReady) {
      setText(
        cyclesOutcome === "failed"
          ? "Examination could not be loaded from saved data"
          : "Waiting for the exam cycle from saved data",
      );
      return;
    }
    if (!centresReady) {
      setText(
        centresOutcome === "failed"
          ? "Centres could not be loaded from saved data"
          : "Waiting for centres from saved data",
      );
      return;
    }
    if (!relationshipsReady) {
      setText(
        relationshipsOutcome === "failed"
          ? "Combined schools could not be loaded from saved data"
          : "Waiting for clubbing relationships from saved data",
      );
      return;
    }
    if (!rulesReady) {
      setText(
        rulesOutcome === "failed"
          ? "Allotment rules could not be loaded from saved data"
          : "Waiting for rule parameters from saved data",
      );
      return;
    }
    if (!exemptionsReady) {
      setText(
        exemptionsOutcome === "failed"
          ? "Exemptions could not be loaded from saved data"
          : "Waiting for exemptions from saved data",
      );
      return;
    }
    if (!teachersReady) {
      setText(
        teachersOutcome === "failed"
          ? "Teachers could not be loaded from saved data"
          : "Waiting for teachers from saved data",
      );
      return;
    }
    if (!schoolsReady) {
      setText(
        schoolsOutcome === "failed"
          ? "Schools could not be loaded from saved data"
          : "Waiting for schools from saved data",
      );
      return;
    }
    if (!historyReady) {
      setText(
        historyOutcome === "failed"
          ? "Duty history could not be loaded from saved data"
          : "Waiting for duty history from saved data",
      );
      return;
    }
    if (!runsReady) {
      setText(
        runsOutcome === "failed"
          ? "Duty lists could not be loaded from saved data"
          : "Waiting for allocation runs from saved data",
      );
      return;
    }
    setBusy(true);
    const centreSchoolIds = new Map<string, Set<string>>();
    for (const r of dataset.relationships) {
      const set = centreSchoolIds.get(r.centreId) ?? new Set();
      set.add(r.schoolId);
      centreSchoolIds.set(r.centreId, set);
    }
    const demands = hallSessions.flatMap((slot) => dataset.centres.filter((c) =>
      c.active && (!slot.schoolId || dataset.relationships.some((relationship) =>
        relationship.centreId === c.centreId && relationship.schoolId === slot.schoolId &&
        relationship.effectiveFrom <= slot.examDate &&
        (!relationship.effectiveTo || relationship.effectiveTo >= slot.examDate),
      )),
    ).map((c) => ({
      centreId: c.centreId,
      totalStudents: c.capacity ?? 0,
      examDate: slot.examDate,
      sessionCode: slot.sessionCode,
    })));
    if (!demands.length || demands.some((d) => !Number.isInteger(d.totalStudents) || d.totalStudents <= 0)) {
      setBusy(false);
      setText("Enter student numbers for every selected centre in Schools & teachers before allotting hall duty.");
      return;
    }
    const result = allocateHall(
      demands,
      {
        teachers: dataset.teachers,
        schools: dataset.schools,
        centres: dataset.centres,
        exemptions,
        history: dataset.history,
        calendar: crossModuleCalendar(runs, "HALL", examCycle.examCycleId),
        academicYear: examCycle.academicYear,
        asOfDate: examDate,
        centreSchoolIds,
      },
      rules,
    );
    const validation = validateHallAllocation(
      result,
      demands.map((d) => ({
        centreId: d.centreId,
        totalStudents: d.totalStudents,
      })),
      rules,
    );
    const runId = `run_${crypto.randomUUID()}`;
    void import("../lib/api")
      .then(async ({ persistRun }) => {
      try {
      const persist = await persistRun(role, {
        runId,
        examCycleId: examCycle.examCycleId,
        ruleVersionId: examCycle.ruleVersionId,
        algorithmVersion: result.algorithmVersion,
        module: "HALL",
        validationStatus: validation.status,
        summary: {
          assignments: result.assignments.length,
          shortages: result.shortages,
          shortageCount: result.shortages.length,
          feasible: result.feasible,
          valid: validation.valid,
          warnings: validation.warnings,
          errors: validation.errors,
          issues: validation.issues,
        },
        validationIssues: validation.issues,
        conflicts: validation.conflicts,
        snapshot: {
          examCycleId: examCycle.examCycleId,
          ruleVersionId: examCycle.ruleVersionId,
          algorithmVersion: result.algorithmVersion,
          module: "HALL",
          teacherCount: dataset.teachers.length,
          centreCount: dataset.centres.length,
          assignmentCount: result.assignments.length,
        },
        results: result.assignments.map((a) => ({
          teacherId: a.teacherId,
          centreId: a.centreId,
          dutyTypeCode: a.roleCode,
          roleCode: a.roleCode,
          examDate: a.examDate,
          sessionCode: a.sessionCode,
          score: a.score,
          decisionTrace: { slotIndex: a.slotIndex },
          usedFallback: false,
        })),
      });
      const decision = shouldApplySessionAfterApi(persist);
      if (!decision.apply) {
        setText(decision.error);
        logAudit(
          "GENERATE_ALLOCATION",
          `Persist refused for ${runId}: ${decision.error}`,
        );
        return;
      }
      addRun({
        runId,
        examCycleId: examCycle.examCycleId,
        module: "HALL",
        createdAt: new Date().toISOString(),
        algorithmVersion: result.algorithmVersion,
        validationStatus: validation.status,
        result,
        validation,
      });
      logAudit(
        "GENERATE_ALLOCATION",
        `Hall ${runId}: feasible=${result.feasible} assigned=${result.assignments.length} shortages=${result.shortages.length} validation=${validation.status}`,
      );
      setText(
        `Centres=${demands.length} · assigned=${result.assignments.length} · shortages=${result.shortages.length} · validation=${validation.status}`,
      );
      } finally {
        setBusy(false);
      }
    })
    .catch(() => {
      setText("Could not save");
      setBusy(false);
    });
  }

  return (
    <Bento>
      <Tile span={6}>
        <TileHeader
          title="Hall invigilation"
          hint="Assigns hall and standby teachers using your saved student counts."
        />
        <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
          One teacher per hall of {rules.students_per_hall} students, plus {rules.standby_percentage}% standby.
          For example, 200 students need {demo.requiredHalls} halls and {demo.standby} standby teachers.
          Enter the actual student count for each centre first.
        </p>
        <button
          type="button"
          disabled={
            !canRun ||
            !cycleMutable ||
            busy ||
            !cyclesReady ||
            !centresReady ||
            !relationshipsReady ||
            !rulesReady || !exemptionsReady ||
            !teachersReady || !schoolsReady || !historyReady || !runsReady
          }
          onClick={run}
          data-testid="generate-hall"
          className="rounded bg-[var(--color-brand)] text-white px-4 py-2 text-sm disabled:opacity-40"
        >
          {busy ? "Generating…" : (catalogBlock ?? "Allocate hall duties")}
        </button>
        {!cyclesReady ? (
          <p
            className="mt-2 text-sm text-[var(--color-ink-muted)]"
            data-testid={
              cyclesOutcome === "failed" ? "cycle-failed" : "cycle-loading"
            }
          >
            {cyclesOutcome === "failed"
              ? "Examination unavailable. Allotment is paused until this is available."
              : "Waiting for the exam cycle from saved data…"}
          </p>
        ) : null}
        {!centresReady ? (
          <p
            className="mt-2 text-sm text-[var(--color-ink-muted)]"
            data-testid={
              centresOutcome === "failed" ? "centres-failed" : "centres-loading"
            }
          >
            {centresOutcome === "failed"
              ? "Centres unavailable. Allotment is paused until this is available."
              : "Waiting for centres from saved data…"}
          </p>
        ) : null}
        {!relationshipsReady ? (
          <p
            className="mt-2 text-sm text-[var(--color-ink-muted)]"
            data-testid={
              relationshipsOutcome === "failed"
                ? "clubbing-failed"
                : "clubbing-loading"
            }
          >
            {relationshipsOutcome === "failed"
              ? "Clubbing unavailable. Allotment is paused until this is available."
              : "Waiting for clubbing relationships from saved data…"}
          </p>
        ) : null}
        {!rulesReady ? (
          <p
            className="mt-2 text-sm text-[var(--color-ink-muted)]"
            data-testid={
              rulesOutcome === "failed" ? "rules-failed" : "rules-loading"
            }
          >
            {rulesOutcome === "failed"
              ? "Allotment rules unavailable. Allotment is paused until this is available."
              : "Waiting for rule parameters from saved data…"}
          </p>
        ) : null}
        {!exemptionsReady ? (
          <p
            className="mt-2 text-sm text-[var(--color-ink-muted)]"
            data-testid={
              exemptionsOutcome === "failed"
                ? "exemptions-failed"
                : "exemptions-loading"
            }
          >
            {exemptionsOutcome === "failed"
              ? "Exemptions unavailable. Allotment is paused until this is available."
              : "Waiting for exemptions from saved data…"}
          </p>
        ) : null}
        {!teachersReady ? (
          <p
            className="mt-2 text-sm text-[var(--color-ink-muted)]"
            data-testid={
              teachersOutcome === "failed"
                ? "teachers-failed"
                : "teachers-loading"
            }
          >
            {teachersOutcome === "failed"
              ? "Teachers unavailable. Allotment is paused until this is available."
              : "Waiting for teachers from saved data…"}
          </p>
        ) : null}
        {!schoolsReady ? (
          <p
            className="mt-2 text-sm text-[var(--color-ink-muted)]"
            data-testid={
              schoolsOutcome === "failed" ? "schools-failed" : "schools-loading"
            }
          >
            {schoolsOutcome === "failed"
              ? "Schools unavailable. Allotment is paused until this is available."
              : "Waiting for schools from saved data…"}
          </p>
        ) : null}
        {!historyReady ? (
          <p
            className="mt-2 text-sm text-[var(--color-ink-muted)]"
            data-testid={
              historyOutcome === "failed" ? "history-failed" : "history-loading"
            }
          >
            {historyOutcome === "failed"
              ? "Duty history unavailable. Allotment is paused until this is available."
              : "Waiting for duty history from saved data…"}
          </p>
        ) : null}
        {!runsReady ? (
          <p
            className="mt-2 text-sm text-[var(--color-ink-muted)]"
            data-testid={
              runsOutcome === "failed" ? "runs-failed" : "runs-loading"
            }
          >
            {runsOutcome === "failed"
              ? "Duty lists unavailable. Allotment is paused until this is available."
              : "Waiting for allocation runs from saved data…"}
          </p>
        ) : null}
        {text && <p className="mt-3 text-sm">{text}</p>}
        {hallResult ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Assignments" value={hallResult.assignments.length} />
            <Stat label="Shortages" value={hallResult.shortages.length} />
            <Stat label="Feasible" value={hallResult.feasible ? "Yes" : "No"} />
            <Stat label="Validation" value={latest?.validationStatus ?? "—"} />
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="No hall allocation yet"
              body="Allocate to fill invigilator and standby slots per centre. Shortages are reported instead of force-assigning an ineligible teacher."
            />
          </div>
        )}
      </Tile>
      {hallResult && hallResult.assignments.length > 0 && (
        <Tile span={6}>
          <TileHeader title="Assignments" />
          <div className="overflow-auto max-h-[40vh] border border-[var(--color-line)] rounded text-sm">
            <table className="min-w-full">
              <thead className="bg-[var(--color-sky-wash)] sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Centre</th>
                  <th className="text-left px-2 py-1">Role</th>
                  <th className="text-left px-2 py-1">Slot</th>
                  <th className="text-left px-2 py-1">Teacher</th>
                  <th className="text-left px-2 py-1">Score</th>
                </tr>
              </thead>
              <tbody>
                {hallResult.assignments.map((a) => (
                  <tr
                    key={`${a.centreId}-${a.roleCode}-${a.slotIndex}`}
                    className="border-t border-[var(--color-line)]"
                  >
                    <td className="px-2 py-1">{a.centreId}</td>
                    <td className="px-2 py-1">{a.roleCode}</td>
                    <td className="px-2 py-1">{a.slotIndex}</td>
                    <td className="px-2 py-1">
                      {dataset?.teachers.find((t) => t.teacherId === a.teacherId)?.name ?? "Teacher no longer listed"}
                    </td>
                    <td className="px-2 py-1">{a.score.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tile>
      )}
    </Bento>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-white px-3 py-2.5">
      <UiStat label={label} value={value} />
    </div>
  );
}
