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
      failed: "Allocation runs unavailable",
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
          ? "Exam cycle could not be loaded from the API"
          : "Waiting for the exam cycle from the API",
      );
      return;
    }
    if (!centresReady) {
      setText(
        centresOutcome === "failed"
          ? "Centres could not be loaded from the API"
          : "Waiting for centres from the API",
      );
      return;
    }
    if (!relationshipsReady) {
      setText(
        relationshipsOutcome === "failed"
          ? "Clubbing relationships could not be loaded from the API"
          : "Waiting for clubbing relationships from the API",
      );
      return;
    }
    if (!rulesReady) {
      setText(
        rulesOutcome === "failed"
          ? "Rule parameters could not be loaded from the API"
          : "Waiting for rule parameters from the API",
      );
      return;
    }
    if (!exemptionsReady) {
      setText(
        exemptionsOutcome === "failed"
          ? "Exemptions could not be loaded from the API"
          : "Waiting for exemptions from the API",
      );
      return;
    }
    if (!teachersReady) {
      setText(
        teachersOutcome === "failed"
          ? "Teachers could not be loaded from the API"
          : "Waiting for teachers from the API",
      );
      return;
    }
    if (!schoolsReady) {
      setText(
        schoolsOutcome === "failed"
          ? "Schools could not be loaded from the API"
          : "Waiting for schools from the API",
      );
      return;
    }
    if (!historyReady) {
      setText(
        historyOutcome === "failed"
          ? "Duty history could not be loaded from the API"
          : "Waiting for duty history from the API",
      );
      return;
    }
    if (!runsReady) {
      setText(
        runsOutcome === "failed"
          ? "Allocation runs could not be loaded from the API"
          : "Waiting for allocation runs from the API",
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
    ).map((c, i) => ({
      centreId: c.centreId,
      totalStudents:
        typeof c.capacity === "number" && c.capacity > 0
          ? c.capacity
          : Math.min(c.capacity ?? 200, 80 + ((i * 23) % 140)),
      examDate: slot.examDate,
      sessionCode: slot.sessionCode,
    })));
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
      setText("Persist failed");
      setBusy(false);
    });
  }

  return (
    <Bento>
      <Tile span={6}>
        <TileHeader
          title="Hall invigilation"
          hint="Hall and standby counts derive from versioned rule parameters, and centre capacity is used whenever a strength import has set it."
        />
        <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
          required_halls = ceil(students / students_per_hall); standby =
          ceil(halls × standby%). Defaults provisional:{" "}
          {rules.students_per_hall} / {rules.standby_percentage}% (example 200
          students → {demo.requiredHalls} halls, {demo.standby} standby). Uses
          centre <code>capacity</code> when set (e.g. from HSE booklet strength
          import); otherwise synthetic student counts.
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
              ? "Exam cycle unavailable — generate stays disabled so a miss is not treated as the session seed cycle."
              : "Waiting for the exam cycle from the API…"}
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
              ? "Centres unavailable — generate stays disabled so a miss is not treated as seed centres."
              : "Waiting for centres from the API…"}
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
              ? "Clubbing unavailable — generate stays disabled so a miss is not treated as seed relationships."
              : "Waiting for clubbing relationships from the API…"}
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
              ? "Rule parameters unavailable — generate stays disabled so a miss is not treated as seed defaults."
              : "Waiting for rule parameters from the API…"}
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
              ? "Exemptions unavailable — generate stays disabled so a miss is not treated as an empty catalog."
              : "Waiting for exemptions from the API…"}
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
              ? "Teachers unavailable — generate stays disabled so a miss is not treated as seed teachers."
              : "Waiting for teachers from the API…"}
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
              ? "Schools unavailable — generate stays disabled so a miss is not treated as seed schools."
              : "Waiting for schools from the API…"}
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
              ? "Duty history unavailable — generate stays disabled so a miss is not treated as seed history."
              : "Waiting for duty history from the API…"}
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
              ? "Allocation runs unavailable — generate stays disabled so a miss is not treated as an empty calendar."
              : "Waiting for allocation runs from the API…"}
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
                      {a.employeeCode} ({a.teacherId})
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
