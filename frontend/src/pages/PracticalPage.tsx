import { useCallback, useEffect, useState } from "react";
import {
  schedulePractical,
  balanceBatches,
  type PracticalResult,
} from "@exam-duty/allocation-engine";
import { validatePracticalAllocation } from "@exam-duty/validator";
import {
  assertMutable,
  catalogUsableForGenerate,
  classifyHydrateList,
  firstUnusableGenerateCatalogLabel,
  examWindowDates,
  latestRunForModuleInCycle,
  mapBatchDemandToPractical,
  normalizeSubject,
  practicalDecisionTraceFromSchedule,
  shouldApplySessionAfterApi,
  type ExaminerPairHistory,
  type HydrateOutcome,
} from "@exam-duty/shared";

/** Synthetic stand-in used only until an officer configures the cycle window. */
const FALLBACK_PRACTICAL_START = "2027-03-01";
import { fetchExaminerPairs } from "../lib/api";
import { crossModuleCalendar } from "../lib/crossModuleCalendar";
import { useApp } from "../state/AppContext";
import {
  Badge,
  Bento,
  EmptyState,
  Panel,
  Stat as UiStat,
  Tile,
  TileHeader,
} from "../components/ui";

type ExaminerPairRow = {
  teacher_a_id: string;
  teacher_b_id: string;
  subject_id: string;
  subject_code?: string | null;
  school_id: string;
  academic_year: string;
  internal_teacher_id: string;
  external_teacher_id: string;
  exam_cycle_id: string | null;
};

/**
 * Persisted pairs carry the canonical subject code; the engine matches on the
 * subject identifier that came in with the demand, so map codes back onto the
 * demand ids before handing the history to the scheduler.
 *
 * Pairs recorded by the cycle being generated are skipped: the documented rule
 * is a switch on the *next* cycle (docs/practical-engine.md, OQ-008).
 */
function toPairHistory(
  rows: ExaminerPairRow[],
  demands: Array<{ subjectId: string }>,
  currentExamCycleId: string,
): ExaminerPairHistory[] {
  const subjectIdByCode = new Map<string, string>();
  for (const d of demands) {
    subjectIdByCode.set(normalizeSubject(d.subjectId).code, d.subjectId);
  }
  return rows
    .filter((r) => r.exam_cycle_id !== currentExamCycleId)
    .map((r) => {
      const code = r.subject_code ?? "";
      return {
        teacherAId: r.teacher_a_id,
        teacherBId: r.teacher_b_id,
        subjectId: subjectIdByCode.get(code) ?? code ?? r.subject_id,
        schoolId: r.school_id,
        academicYear: r.academic_year,
        internalTeacherId: r.internal_teacher_id,
        externalTeacherId: r.external_teacher_id,
      };
    });
}

function demoDemands(
  schools: Array<{ schoolId: string; schoolCode: string }>,
  batchSize: number,
  imported: Array<{
    schoolCode: string;
    subject: string;
    batchCount: number;
  }> | null,
) {
  if (imported?.length) {
    const { demands } = mapBatchDemandToPractical({
      rows: imported.map((r, i) => ({
        serialNo: i + 1,
        schoolCode: r.schoolCode,
        subject: r.subject,
        batchCount: r.batchCount,
        isSchoolTotal: false,
      })),
      schools,
      batchSize,
    });
    if (demands.length) return demands;
  }
  return schools.slice(0, Math.min(8, schools.length)).map((s, i) => ({
    schoolId: s.schoolId,
    subjectId: "PHYSICS",
    studentCount: 40 + ((i * 17) % 80),
  }));
}

export function PracticalPage() {
  const {
    dataset,
    rules,
    role,
    logAudit,
    addRun,
    examCycle,
    runs,
    practicalBatchDemand,
    exemptions,
    hydrateReady,
    hydrateReport,
  } = useApp();
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pairRows, setPairRows] = useState<ExaminerPairRow[]>([]);
  const [pairsOutcome, setPairsOutcome] = useState<HydrateOutcome | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [pairsApplied, setPairsApplied] = useState<{
    considered: number;
    switched: number;
  } | null>(null);

  const loadPairs = useCallback(async () => {
    const res = await fetchExaminerPairs(role);
    const outcome = classifyHydrateList(res, res?.pairs);
    setPairsOutcome(outcome);
    if (outcome === "failed" || !res) {
      return;
    }
    setPairRows(res.pairs);
  }, [role]);

  useEffect(() => {
    void loadPairs();
  }, [loadPairs]);

  if (!dataset) return <Panel title="Practical">Loading…</Panel>;

  const canRun = role === "ADMIN" || role === "OFFICER";
  const cycleMutable = assertMutable(examCycle.status, "generate allocation").ok;
  const latest = latestRunForModuleInCycle(
    runs,
    "PRACTICAL",
    examCycle.examCycleId,
  );
  const practicalResult = latest?.result as PracticalResult | null | undefined;
  const storedPairs = pairRows;
  const pairsReady = pairsOutcome === "ok" || pairsOutcome === "empty";
  const cyclesOutcome = hydrateReport.sources.exam_cycles;
  const cyclesReady = catalogUsableForGenerate(hydrateReady, cyclesOutcome);
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
  const runsOutcome = hydrateReport.sources.allocation_runs;
  const runsReady = catalogUsableForGenerate(hydrateReady, runsOutcome);
  const catalogBlock = firstUnusableGenerateCatalogLabel(hydrateReady, [
    { outcome: cyclesOutcome, failed: "Cycle unavailable", loading: "Loading cycle…" },
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
  const usablePairs = storedPairs.filter(
    (p) => p.exam_cycle_id !== examCycle.examCycleId,
  );

  function run() {
    if (!dataset || busy) return;
    const gate = assertMutable(examCycle.status, "generate allocation");
    if (!gate.ok) {
      setPersistError(gate.error);
      setMessage(gate.error);
      setSummary(null);
      logAudit("GENERATE_ALLOCATION", gate.error);
      return;
    }
    if (!pairsReady) {
      setMessage(
        pairsOutcome === "failed"
          ? "Pair memory could not be loaded from the API"
          : "Waiting for examiner pair memory from the API",
      );
      setSummary(null);
      return;
    }
    if (!cyclesReady) {
      setMessage(
        cyclesOutcome === "failed"
          ? "Exam cycle could not be loaded from the API"
          : "Waiting for the exam cycle from the API",
      );
      setSummary(null);
      return;
    }
    if (!rulesReady) {
      setMessage(
        rulesOutcome === "failed"
          ? "Rule parameters could not be loaded from the API"
          : "Waiting for rule parameters from the API",
      );
      setSummary(null);
      return;
    }
    if (!exemptionsReady) {
      setMessage(
        exemptionsOutcome === "failed"
          ? "Exemptions could not be loaded from the API"
          : "Waiting for exemptions from the API",
      );
      setSummary(null);
      return;
    }
    if (!teachersReady) {
      setMessage(
        teachersOutcome === "failed"
          ? "Teachers could not be loaded from the API"
          : "Waiting for teachers from the API",
      );
      setSummary(null);
      return;
    }
    if (!schoolsReady) {
      setMessage(
        schoolsOutcome === "failed"
          ? "Schools could not be loaded from the API"
          : "Waiting for schools from the API",
      );
      setSummary(null);
      return;
    }
    if (!runsReady) {
      setMessage(
        runsOutcome === "failed"
          ? "Allocation runs could not be loaded from the API"
          : "Waiting for allocation runs from the API",
      );
      setSummary(null);
      return;
    }
    setBusy(true);
    const demand = demoDemands(
      dataset.schools.map((s) => ({
        schoolId: s.schoolId,
        schoolCode: s.schoolCode,
      })),
      rules.practical_batch_size,
      practicalBatchDemand,
    );
    const dates = examWindowDates(
      examCycle,
      rules.practical_completion_days,
      FALLBACK_PRACTICAL_START,
    );
    const pairHistory = toPairHistory(
      pairRows,
      demand,
      examCycle.examCycleId,
    );
    const result = schedulePractical(
      demand,
      {
        teachers: dataset.teachers,
        exemptions,
        calendar: crossModuleCalendar(runs, "PRACTICAL", examCycle.examCycleId),
        pairHistory,
        availableDates: dates,
        asOfDate: dates[0]!,
        academicYear: examCycle.academicYear,
        internalEligible: (t, schoolId) =>
          t.schoolId === schoolId && t.isActive,
        externalEligible: (t, schoolId) =>
          t.schoolId !== schoolId && t.isActive,
      },
      rules,
    );
    const validation = validatePracticalAllocation(result, rules);
    const runId = `run_${crypto.randomUUID()}`;
    void import("../lib/api")
      .then(async ({ persistRun, persistPracticalBatchesApi }) => {
        try {
        // The run row must exist first: practical_schedules.run_id references
        // allocation_runs, so firing both together loses the schedules.
        const persist = await persistRun(role, {
          runId,
          examCycleId: examCycle.examCycleId,
          ruleVersionId: examCycle.ruleVersionId,
          algorithmVersion: result.algorithmVersion,
          module: "PRACTICAL",
          validationStatus: validation.status,
          summary: {
            schedules: result.schedules.length,
            batches: result.batches.length,
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
            module: "PRACTICAL",
            teacherCount: dataset.teachers.length,
            schoolCount: dataset.schools.length,
            scheduleCount: result.schedules.length,
            batchCount: result.batches.length,
          },
          results: result.schedules.flatMap((s) => {
            const batch = result.batches.find((b) => b.batchKey === s.batchKey);
            const decisionTrace = practicalDecisionTraceFromSchedule({
              batchKey: s.batchKey,
              schoolId: s.schoolId,
              subjectId: s.subjectId,
              externalExaminerId: s.externalExaminerId,
              decisionNotes: s.decisionNotes,
              roleSwitchApplied: s.roleSwitchApplied,
              batchIndex: batch?.batchIndex,
              studentCount: batch?.studentCount,
            });
            const base = {
              centreId: s.schoolId,
              examDate: s.examDate,
              sessionCode: s.sessionCode,
              score: 0,
              decisionTrace,
              usedFallback: s.roleSwitchApplied,
            };
            return [
              {
                ...base,
                teacherId: s.internalExaminerId,
                dutyTypeCode: "PRACTICAL_INTERNAL",
                roleCode: "PRACTICAL_INTERNAL",
              },
              {
                ...base,
                teacherId: s.externalExaminerId,
                dutyTypeCode: "PRACTICAL_EXTERNAL",
                roleCode: "PRACTICAL_EXTERNAL",
              },
            ];
          }),
        });
        const decision = shouldApplySessionAfterApi(persist);
        if (!decision.apply) {
          setPersistError(decision.error);
          setMessage(decision.error);
          setSummary(null);
          logAudit(
            "GENERATE_ALLOCATION",
            `Persist refused for ${runId}: ${decision.error}`,
          );
          return;
        }
        addRun({
          runId,
          examCycleId: examCycle.examCycleId,
          module: "PRACTICAL",
          createdAt: new Date().toISOString(),
          algorithmVersion: result.algorithmVersion,
          validationStatus: validation.status,
          result,
          validation,
        });
        logAudit(
          "GENERATE_ALLOCATION",
          `Practical ${runId}: feasible=${result.feasible} schedules=${result.schedules.length} validation=${validation.status}`,
        );
        setPairsApplied({
          considered: pairHistory.length,
          switched: result.schedules.filter((s) => s.roleSwitchApplied).length,
        });
        const sampleBatches = balanceBatches(
          demand[0]?.studentCount ?? 0,
          rules.practical_batch_size,
        );
        setMessage(
          result.message ?? (result.feasible ? "Schedule generated" : "Infeasible"),
        );
        setSummary(
          `Schools=${demand.length} · batch example [${sampleBatches.join(", ")}] · schedules=${result.schedules.length} · status=${validation.status}`,
        );
        if (!persist?.accepted) {
          // Offline: session may keep the run; pair rows are not written.
          return;
        }
        const scheduleByBatch = new Map(
          result.schedules.map((s) => [s.batchKey, s]),
        );
        const persisted = await persistPracticalBatchesApi(role, {
          examCycleId: examCycle.examCycleId,
          runId,
          academicYear: examCycle.academicYear,
          batches: result.batches.map((b) => {
            const s = scheduleByBatch.get(b.batchKey);
            return {
              batchId: b.batchKey,
              schoolId: b.schoolId,
              subjectCode: b.subjectId,
              studentCount: b.studentCount,
              batchIndex: b.batchIndex,
              examDate: s?.examDate,
              sessionCode: s?.sessionCode,
              internalExaminerId: s?.internalExaminerId,
              externalExaminerId: s?.externalExaminerId,
            };
          }),
        });
        if (!persisted || persisted.ok !== true) {
          const detail = persisted?.error ?? "API unreachable";
          setPersistError(detail);
          logAudit(
            "GENERATE_ALLOCATION",
            `Practical ${runId}: batch/pair persistence failed — ${detail}`,
          );
          return;
        }
        setPersistError(null);
        await loadPairs();
        } finally {
          setBusy(false);
        }
      })
      .catch(() => {
        setPersistError("Persist failed");
        setBusy(false);
      });
  }

  return (
    <Bento>
      <Tile span={6}>
        <TileHeader
          title="Practical examination scheduling"
          hint="Batching balances group sizes (never a silent 50 + remainder). The completion window is hard: infeasible schedules return NO VALID SCHEDULE, and pair role-switch remains provisional (OQ-008)."
        />
        <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
          Demand source:{" "}
          {practicalBatchDemand?.length
            ? `${practicalBatchDemand.length} imported batch row(s) by school code`
            : "synthetic Physics for up to 8 schools (import a batch sheet to override)"}
          .
        </p>
        <button
          type="button"
          disabled={
            !canRun ||
            !cycleMutable ||
            busy ||
            !pairsReady ||
            !cyclesReady ||
            !rulesReady ||
            !exemptionsReady ||
            !teachersReady ||
            !schoolsReady ||
            !runsReady
          }
          onClick={run}
          data-testid="generate-practical"
          className="rounded bg-[var(--color-brand)] text-white px-4 py-2 text-sm disabled:opacity-40"
        >
          {busy
            ? "Generating…"
            : pairsOutcome === null
              ? "Loading pair memory…"
              : pairsOutcome === "failed"
                ? "Pair memory unavailable"
                : (catalogBlock ?? "Generate practical schedule")}
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
        {summary && <p className="mt-3 text-sm">{summary}</p>}
        {message && (
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
            {message}
          </p>
        )}
        {practicalResult ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Batches" value={practicalResult.batches.length} />
            <Stat label="Schedules" value={practicalResult.schedules.length} />
            <Stat
              label="Feasible"
              value={practicalResult.feasible ? "Yes" : "No"}
            />
            <Stat label="Validation" value={latest?.validationStatus ?? "—"} />
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="No practical schedule yet"
              body="Generate to build balanced batches and internal/external examiner pairs, then persist them so reports and publish can use them after a reload."
            />
          </div>
        )}
      </Tile>
      <Tile span={6}>
        <TileHeader
          title="Examiner pair memory"
          hint="Pairs persisted by earlier cycles feed the annual internal/external role switch. Pairs from this cycle are excluded — the documented rule switches on the next cycle (OQ-008)."
          action={
            persistError ? (
              <Badge tone="err" testId="pair-persist-error">
                Not persisted
              </Badge>
            ) : pairsApplied ? (
              <Badge
                tone={pairsApplied.switched > 0 ? "ok" : "neutral"}
                testId="pair-switch-badge"
              >
                {pairsApplied.switched > 0
                  ? `${pairsApplied.switched} role switch(es) applied`
                  : "No role switch applied"}
              </Badge>
            ) : undefined
          }
        />
        {persistError ? (
          <p className="mb-3 text-xs text-[var(--color-err)]">
            Last run was not written to the database ({persistError}); pair
            memory for it does not exist yet.
          </p>
        ) : null}
        {pairsOutcome === null ? (
          <p
            className="text-sm text-[var(--color-ink-muted)]"
            data-testid="pair-memory-loading"
          >
            Loading examiner pair memory from the API…
          </p>
        ) : pairsOutcome === "failed" ? (
          <EmptyState
            testId="pair-memory-failed"
            title="Pair memory unavailable"
            body="GET examiner pairs did not return a list. This is not an empty catalog — generate stays disabled so a schedule is not persisted as if there was no history."
          />
        ) : usablePairs.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Pair rows stored" value={storedPairs.length} />
              <Stat label="From earlier cycles" value={usablePairs.length} />
              <Stat
                label="Fed into last run"
                value={pairsApplied ? pairsApplied.considered : "—"}
              />
              <Stat
                label="Switches applied"
                value={pairsApplied ? pairsApplied.switched : "—"}
              />
            </div>
            {pairsApplied &&
            pairsApplied.considered > 0 &&
            pairsApplied.switched === 0 ? (
              <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
                Pair history was read but no swap was possible: a stored pair
                only switches when both teachers are eligible for both roles at
                that school, which the same-school internal / other-school
                external reading forbids. Pending the client answer on OQ-008.
              </p>
            ) : null}
            <div className="mt-4 overflow-auto max-h-[30vh] border border-[var(--color-line)] rounded text-sm">
              <table className="min-w-full">
                <thead className="bg-[var(--color-sky-wash)] sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1">Year</th>
                    <th className="text-left px-2 py-1">School</th>
                    <th className="text-left px-2 py-1">Subject</th>
                    <th className="text-left px-2 py-1">Internal</th>
                    <th className="text-left px-2 py-1">External</th>
                  </tr>
                </thead>
                <tbody data-testid="pair-memory-rows">
                  {usablePairs.map((p) => (
                    <tr
                      key={`${p.school_id}|${p.subject_id}|${p.teacher_a_id}|${p.teacher_b_id}|${p.academic_year}`}
                      className="border-t border-[var(--color-line)]"
                    >
                      <td className="px-2 py-1">{p.academic_year}</td>
                      <td className="px-2 py-1">{p.school_id}</td>
                      <td className="px-2 py-1">
                        {p.subject_code ?? p.subject_id}
                      </td>
                      <td className="px-2 py-1">{p.internal_teacher_id}</td>
                      <td className="px-2 py-1">{p.external_teacher_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState
            testId="pair-memory-empty"
            title="No pair history from earlier cycles yet"
            body={
              storedPairs.length > 0
                ? `${storedPairs.length} pair row(s) recorded for this cycle. They become role-switch input for the next cycle.`
                : "Generating and persisting a practical schedule records each internal/external pairing, which the next cycle uses to switch roles."
            }
          />
        )}
      </Tile>
      {practicalResult && practicalResult.schedules.length > 0 && (
        <Tile span={6}>
          <TileHeader title="Schedules" />
          <div className="overflow-auto max-h-[40vh] border border-[var(--color-line)] rounded text-sm">
            <table className="min-w-full">
              <thead className="bg-[var(--color-sky-wash)] sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">School</th>
                  <th className="text-left px-2 py-1">Date</th>
                  <th className="text-left px-2 py-1">Internal</th>
                  <th className="text-left px-2 py-1">External</th>
                  <th className="text-left px-2 py-1">Role switch</th>
                </tr>
              </thead>
              <tbody>
                {practicalResult.schedules.map((s) => (
                  <tr
                    key={`${s.batchKey}|${s.examDate}|${s.sessionCode}|${s.internalExaminerId}`}
                    className="border-t border-[var(--color-line)]"
                  >
                    <td className="px-2 py-1">{s.schoolId}</td>
                    <td className="px-2 py-1">{s.examDate}</td>
                    <td className="px-2 py-1">{s.internalExaminerId}</td>
                    <td className="px-2 py-1">{s.externalExaminerId}</td>
                    <td className="px-2 py-1">
                      {s.roleSwitchApplied ? "Yes" : "No"}
                    </td>
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
