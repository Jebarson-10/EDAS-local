import { useMemo, useRef, useState } from "react";
import type { TheoryAllocationResult } from "@exam-duty/allocation-engine";
import { validateTheoryAllocation } from "@exam-duty/validator";
import type {
  TheoryDataset,
  TheoryRequirement,
} from "@exam-duty/allocation-engine";
import type { ValidationResult } from "@exam-duty/validator";
import { useApp, isTheoryRun } from "../state/AppContext";
import { crossModuleCalendar } from "../lib/crossModuleCalendar";
import {
  Bento,
  EmptyState,
  Panel,
  Stat as UiStat,
  Tile,
  TileHeader,
} from "../components/ui";
import AllocationWorker from "../workers/allocation.worker.ts?worker";
import {
  assertMutable,
  catalogUsableForGenerate,
  firstUnusableGenerateCatalogLabel,
  latestRunForModuleInCycle,
  mergeOverrideIntoDecisionTrace,
  shouldApplySessionAfterApi,
} from "@exam-duty/shared";

export function TheoryPage() {
  const {
    dataset,
    rules,
    role,
    addRun,
    updateRun,
    logAudit,
    runs,
    examCycle,
    exemptions,
    hydrateReady,
    hydrateReport,
    timetable,
    timetableState,
  } = useApp();
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedWhy, setSelectedWhy] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideReq, setOverrideReq] = useState("");
  const [overrideTeacherId, setOverrideTeacherId] = useState("");
  const [overrideMsg, setOverrideMsg] = useState<string | null>(null);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const overrideBusyRef = useRef(false);

  const canGenerate = role === "ADMIN" || role === "OFFICER";
  const latestPicked = latestRunForModuleInCycle(
    runs,
    "THEORY",
    examCycle.examCycleId,
  );
  const latest = latestPicked && isTheoryRun(latestPicked) ? latestPicked : undefined;
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
  const canOverride =
    canGenerate &&
    cycleMutable &&
    latest?.publishedIntoHistory !== true;
  const chiefSessions = useMemo(
    () => timetable.filter((entry) => entry.requiresChief),
    [timetable],
  );
  const examDate = chiefSessions.map((entry) => entry.examDate).sort()[0] ?? "";

  const theoryDataset: TheoryDataset | null = useMemo(() => {
    if (!dataset || !examDate) return null;
    return {
      teachers: dataset.teachers,
      schools: dataset.schools,
      centres: dataset.centres,
      relationships: dataset.relationships,
      exemptions,
      history: dataset.history,
      calendar: crossModuleCalendar(runs, "THEORY", examCycle.examCycleId),
      academicYear: examCycle.academicYear,
      asOfDate: examDate,
    };
  }, [
    dataset,
    exemptions,
    runs,
    examCycle.academicYear,
    examCycle.examCycleId,
    examDate,
  ]);

  const requirements: TheoryRequirement[] = useMemo(() => {
    if (!dataset) return [];
    return chiefSessions.flatMap((slot) => dataset.centres.filter((c) =>
      c.active && (!slot.schoolId || dataset.relationships.some((relationship) =>
        relationship.centreId === c.centreId && relationship.schoolId === slot.schoolId &&
        relationship.effectiveFrom <= slot.examDate &&
        (!relationship.effectiveTo || relationship.effectiveTo >= slot.examDate),
      )),
    ).map((c) => ({
      requirementKey: `${c.centreId}-CHIEF-${slot.examDate}-${slot.sessionCode}`,
      centreId: c.centreId,
      roleCode: "CHIEF_EXAMINATION",
      examDate: slot.examDate,
      sessionCode: slot.sessionCode,
      preferredDesignations: rules.chief_preferred_designations.includes("HM")
        ? ["HM", "PRINCIPAL"]
        : rules.chief_preferred_designations,
      fallbackDesignations: rules.chief_fallback_designations,
    })));
  }, [dataset, rules, chiefSessions]);

  async function generate() {
    if (!dataset || !canGenerate || !theoryDataset) return;
    if (timetableState !== "ready" || chiefSessions.length === 0) {
      setProgress("Add at least one timetable session marked Chief duty before allocating theory duties.");
      return;
    }
    const gate = assertMutable(examCycle.status, "generate allocation");
    if (!gate.ok) {
      setProgress(gate.error);
      logAudit("GENERATE_ALLOCATION", gate.error);
      return;
    }
    if (!cyclesReady) {
      setProgress(
        cyclesOutcome === "failed"
          ? "Exam cycle could not be loaded from the API"
          : "Waiting for the exam cycle from the API",
      );
      return;
    }
    if (!centresReady) {
      setProgress(
        centresOutcome === "failed"
          ? "Centres could not be loaded from the API"
          : "Waiting for centres from the API",
      );
      return;
    }
    if (!relationshipsReady) {
      setProgress(
        relationshipsOutcome === "failed"
          ? "Clubbing relationships could not be loaded from the API"
          : "Waiting for clubbing relationships from the API",
      );
      return;
    }
    if (!rulesReady) {
      setProgress(
        rulesOutcome === "failed"
          ? "Rule parameters could not be loaded from the API"
          : "Waiting for rule parameters from the API",
      );
      return;
    }
    if (!exemptionsReady) {
      setProgress(
        exemptionsOutcome === "failed"
          ? "Exemptions could not be loaded from the API"
          : "Waiting for exemptions from the API",
      );
      return;
    }
    if (!teachersReady) {
      setProgress(
        teachersOutcome === "failed"
          ? "Teachers could not be loaded from the API"
          : "Waiting for teachers from the API",
      );
      return;
    }
    if (!schoolsReady) {
      setProgress(
        schoolsOutcome === "failed"
          ? "Schools could not be loaded from the API"
          : "Waiting for schools from the API",
      );
      return;
    }
    if (!historyReady) {
      setProgress(
        historyOutcome === "failed"
          ? "Duty history could not be loaded from the API"
          : "Waiting for duty history from the API",
      );
      return;
    }
    if (!runsReady) {
      setProgress(
        runsOutcome === "failed"
          ? "Allocation runs could not be loaded from the API"
          : "Waiting for allocation runs from the API",
      );
      return;
    }
    setBusy(true);
    setProgress("Preparing data...");
    logAudit("GENERATE_ALLOCATION", "Theory allocation started");

    const worker = new AllocationWorker();
    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data as
        | { type: "progress"; stage: string }
        | {
            type: "result";
            allocation: { module: "THEORY"; result: TheoryAllocationResult };
            validation: ValidationResult;
          };
      if (data.type === "progress") {
        setProgress(data.stage);
        return;
      }
      const runId = `run_${crypto.randomUUID()}`;
      void import("../lib/api").then(async ({ persistRun }) => {
        const persist = await persistRun(role, {
          runId,
          examCycleId: examCycle.examCycleId,
          ruleVersionId: examCycle.ruleVersionId,
          algorithmVersion: data.allocation.result.algorithmVersion,
          module: "THEORY",
          validationStatus: data.validation.status,
          summary: {
            assignments: data.allocation.result.assignments.length,
            shortages: data.allocation.result.shortages,
            shortageCount: data.allocation.result.shortages.length,
            feasible: data.allocation.result.feasible,
            valid: data.validation.valid,
            warnings: data.validation.warnings,
            errors: data.validation.errors,
            issues: data.validation.issues,
          },
          validationIssues: data.validation.issues,
          conflicts: data.validation.conflicts,
          snapshot: {
            examCycleId: examCycle.examCycleId,
            ruleVersionId: examCycle.ruleVersionId,
            ruleVersionLabel: examCycle.ruleVersionLabel,
            algorithmVersion: data.allocation.result.algorithmVersion,
            module: "THEORY",
            teacherCount: dataset.teachers.length,
            centreCount: dataset.centres.length,
            relationshipCount: dataset.relationships.length,
            historyCount: dataset.history.length,
            exemptionCount: exemptions.length,
            requirementCount: requirements.length,
          },
          results: data.allocation.result.assignments.map((a) => ({
            teacherId: a.teacherId,
            centreId: a.centreId,
            dutyTypeCode: a.roleCode,
            roleCode: a.roleCode,
            examDate: a.examDate,
            sessionCode: a.sessionCode,
            score: a.score,
            decisionTrace: {
              ...a.decisionTrace,
              requirementKey: a.requirementKey,
            },
            usedFallback: a.usedFallbackBand,
          })),
        });
        const decision = shouldApplySessionAfterApi(persist);
        if (!decision.apply) {
          logAudit(
            "GENERATE_ALLOCATION",
            `Persist refused for ${runId}: ${decision.error}`,
          );
          setProgress(decision.error);
          setBusy(false);
          worker.terminate();
          return;
        }
        addRun({
          runId,
          examCycleId: examCycle.examCycleId,
          module: "THEORY",
          createdAt: new Date().toISOString(),
          algorithmVersion: data.allocation.result.algorithmVersion,
          validationStatus: data.validation.status,
          result: data.allocation.result,
          validation: data.validation,
        });
        logAudit(
          "VALIDATE_ALLOCATION",
          `Theory run ${runId} → ${data.validation.status} (assignments=${data.allocation.result.assignments.length})`,
        );
        if (persist?.accepted) {
          logAudit("GENERATE_ALLOCATION", `Persisted run ${runId} to API/DB`);
        }
        setProgress(null);
        setBusy(false);
        worker.terminate();
      }).catch(() => {
        setProgress("Persist failed");
        setBusy(false);
        worker.terminate();
      });
    };
    worker.onerror = (err) => {
      console.error(err);
      setProgress("Worker failed");
      setBusy(false);
      worker.terminate();
    };
    worker.postMessage({
      type: "THEORY",
      requirements,
      dataset: theoryDataset,
      rules,
    });
  }

  function applyOverride() {
    if (!latest?.result || !theoryDataset || !canGenerate) return;
    if (overrideBusyRef.current) return;
    const gate = assertMutable(examCycle.status, "override");
    if (!gate.ok || latest.publishedIntoHistory) {
      setOverrideMsg(
        gate.ok
          ? "Cannot override a published run — create an amendment"
          : gate.error,
      );
      return;
    }
    if (!overrideReq || !overrideTeacherId.trim() || !overrideReason.trim()) {
      setOverrideMsg("Requirement, teacher id, and reason are required");
      return;
    }
    const teacher = dataset?.teachers.find(
      (t) =>
        t.teacherId === overrideTeacherId.trim() ||
        t.employeeCode === overrideTeacherId.trim(),
    );
    if (!teacher) {
      setOverrideMsg("Teacher not found in master data");
      return;
    }
    const assignedElsewhere = latest.result.assignments.find(
      (a) =>
        a.requirementKey !== overrideReq && a.teacherId === teacher.teacherId,
    );
    if (assignedElsewhere) {
      setOverrideMsg(
        `Teacher already assigned to ${assignedElsewhere.requirementKey}`,
      );
      return;
    }
    const nextAssignments = latest.result.assignments.map((a) => {
      if (a.requirementKey !== overrideReq) return a;
      const nextTrace = JSON.parse(
        mergeOverrideIntoDecisionTrace(JSON.stringify(a.decisionTrace), {
          newTeacherId: teacher.teacherId,
          oldTeacherId: a.teacherId,
          requirementKey: overrideReq,
          reason: overrideReason.trim(),
        }),
      ) as {
        teacherId?: string;
        targetId?: string;
        eligibility?: string;
        score?: number;
        selectedBecause?: string;
        reasons?: typeof a.decisionTrace.reasons;
      };
      const eligibility: "PASS" | "FAIL" =
        nextTrace.eligibility === "FAIL" ? "FAIL" : "PASS";
      return {
        ...a,
        teacherId: teacher.teacherId,
        employeeCode: teacher.employeeCode,
        score: a.score,
        usedFallbackBand: true,
        decisionTrace: {
          teacherId: nextTrace.teacherId ?? teacher.teacherId,
          targetId: nextTrace.targetId ?? a.decisionTrace.targetId,
          eligibility,
          reasons: nextTrace.reasons ?? [],
          score:
            typeof nextTrace.score === "number" ? nextTrace.score : a.score,
          selectedBecause: nextTrace.selectedBecause ?? "manual override",
        },
      };
    });
    const nextResult: TheoryAllocationResult = {
      ...latest.result,
      assignments: nextAssignments,
    };
    const validation = validateTheoryAllocation(
      requirements,
      nextResult,
      theoryDataset,
      rules,
    );
    const reason = overrideReason.trim();
    const centreId = overrideReq.split("-")[0] ?? "";
    const old = latest.result.assignments.find(
      (a) => a.requirementKey === overrideReq,
    );
    overrideBusyRef.current = true;
    setOverrideBusy(true);
    void import("../lib/api")
      .then(async ({ manualOverrideApi }) => {
        const api = await manualOverrideApi(role, {
          runId: latest.runId,
          requirementKey: overrideReq,
          centreId,
          oldTeacherId: old?.teacherId ?? "",
          newTeacherId: teacher.teacherId,
          reason,
        });
        const decision = shouldApplySessionAfterApi(api);
        if (!decision.apply) {
          setOverrideMsg(decision.error);
          return;
        }
        updateRun(latest.runId, {
          result: nextResult,
          validation,
          validationStatus: validation.status,
        });
        logAudit(
          "MANUAL_OVERRIDE",
          `Run ${latest.runId}: ${overrideReq} → ${teacher.teacherId} (${teacher.employeeCode}); validation=${validation.status}`,
          reason,
        );
        const base =
          validation.status === "INVALID"
            ? `Override applied but validation is INVALID — publish blocked until fixed`
            : `Override applied · validation ${validation.status}`;
        setOverrideMsg(
          api?.ok && api.overrideId
            ? `${base} · DB override ${api.overrideId}`
            : base,
        );
        setOverrideReason("");
      })
      .finally(() => {
        overrideBusyRef.current = false;
        setOverrideBusy(false);
      });
  }

  if (!dataset) return <Panel title="Theory duty">Loading…</Panel>;

  return (
    <Bento>
      <Tile span={6}>
        <TileHeader
          title="Theory examination duty"
          hint="Deterministic client-side engine (Web Worker). Historical centre assignments from prior cycles apply automatically — no manual history upload."
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={
              !canGenerate ||
              !cycleMutable ||
              busy ||
              overrideBusy ||
              !cyclesReady ||
              !centresReady ||
              !relationshipsReady ||
              !rulesReady ||
              !exemptionsReady ||
              !teachersReady ||
              !schoolsReady ||
              !historyReady ||
              !runsReady
            }
            onClick={() => void generate()}
            data-testid="generate-theory"
            className="rounded bg-[var(--color-brand-accent)] text-white px-4 py-2 text-sm disabled:opacity-40"
          >
            {busy
              ? "Generating…"
              : (catalogBlock ?? "Generate theory allocation")}
          </button>
          {progress && (
            <span className="text-sm text-[var(--color-ink-muted)]">
              {progress}
            </span>
          )}
        </div>
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
        {latest?.result ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Assignments"
              value={latest.result.assignments.length}
            />
            <Stat label="Shortages" value={latest.result.shortages.length} />
            <Stat
              label="Feasible"
              value={latest.result.feasible ? "Yes" : "No"}
            />
            <Stat label="Validation" value={latest.validationStatus} />
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="No theory run in this session"
              body="Generating builds a versioned allocation run from master data, published history, exemptions and the cycle's stored rule version, then hands it to the independent validator."
            />
          </div>
        )}
      </Tile>

      {latest?.result && (
        <Tile span={6}>
          <TileHeader title="Assignments" />
          <div className="overflow-auto max-h-[50vh] border border-[var(--color-line)] rounded text-sm">
            <table className="min-w-full">
              <thead className="bg-[var(--color-sky-wash)] sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Centre</th>
                  <th className="text-left px-2 py-1">Teacher</th>
                  <th className="text-left px-2 py-1">Role</th>
                  <th className="text-left px-2 py-1">Score</th>
                  <th className="text-left px-2 py-1">Fallback</th>
                  <th className="text-left px-2 py-1">Why</th>
                </tr>
              </thead>
              <tbody>
                {latest.result.assignments.map((a) => (
                  <tr
                    key={a.requirementKey}
                    className="border-t border-[var(--color-line)]"
                  >
                    <td className="px-2 py-1">{a.centreId}</td>
                    <td className="px-2 py-1">
                      {a.employeeCode} ({a.teacherId})
                    </td>
                    <td className="px-2 py-1">{a.roleCode}</td>
                    <td className="px-2 py-1">{a.score.toFixed(2)}</td>
                    <td className="px-2 py-1">
                      {a.usedFallbackBand ? "Yes" : "No"}
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        className="underline text-[var(--color-brand)]"
                        onClick={() => setSelectedWhy(a.requirementKey)}
                      >
                        Why?
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedWhy && (
            <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-sky-wash)] p-3 text-sm">
              <p className="font-medium mb-2">Decision trace — {selectedWhy}</p>
              {(() => {
                const why = latest.result.assignments.find(
                  (a) => a.requirementKey === selectedWhy,
                );
                if (!why) return null;
                return (
                  <>
                    <p className="mb-2" data-testid="why-selected">
                      Selected {why.decisionTrace.teacherId} because{" "}
                      {why.decisionTrace.selectedBecause}
                    </p>
                    <ul className="space-y-1">
                      {why.decisionTrace.reasons.map((r, i) => (
                        <li key={i}>
                          <code className="text-xs">{r.ruleCode}</code> [
                          {r.severity}] {r.message}
                        </li>
                      ))}
                    </ul>
                  </>
                );
              })()}
            </div>
          )}

          {latest.result.shortages.length > 0 && (
            <div className="mt-3">
              <p className="font-medium text-[var(--color-err)] text-sm mb-1">
                Shortages
              </p>
              <ul className="text-sm space-y-1">
                {latest.result.shortages.map((s) => (
                  <li key={s.requirementKey}>
                    {s.requirementKey}: required={s.required} eligible=
                    {s.eligible} shortage={s.shortage} — {s.message}
                    {s.hmRequirementMeta && (
                      <span className="text-[var(--color-warn)]">
                        {" "}
                        (preferred eligible{" "}
                        {s.hmRequirementMeta.preferredEligible}; fallback{" "}
                        {s.hmRequirementMeta.fallbackDesignations.join(", ")})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 border-t border-[var(--color-line)] pt-3 space-y-2">
            <p className="text-sm font-medium">
              Manual override (mutates run + revalidates)
            </p>
            <select
              className="w-full border border-[var(--color-line)] rounded px-2 py-1 text-sm"
              value={overrideReq}
              onChange={(e) => setOverrideReq(e.target.value)}
              data-testid="override-requirement"
            >
              <option value="">Select requirement…</option>
              {latest.result.assignments.map((a) => (
                <option key={a.requirementKey} value={a.requirementKey}>
                  {a.requirementKey} · {a.employeeCode}
                </option>
              ))}
            </select>
            <input
              className="w-full border border-[var(--color-line)] rounded px-2 py-1 text-sm"
              placeholder="Replacement teacherId or employeeCode"
              value={overrideTeacherId}
              onChange={(e) => setOverrideTeacherId(e.target.value)}
              data-testid="override-teacher"
            />
            <input
              className="w-full border border-[var(--color-line)] rounded px-2 py-1 text-sm"
              placeholder="Reason for material change (required)"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              data-testid="override-reason"
            />
            <button
              type="button"
              className="rounded border border-[var(--color-line)] px-3 py-1.5 text-sm disabled:opacity-40"
              disabled={
                !overrideReason.trim() ||
                !overrideReq ||
                !overrideTeacherId.trim() ||
                !canOverride ||
                overrideBusy ||
                busy
              }
              data-testid="apply-override"
              onClick={applyOverride}
            >
              {overrideBusy ? "Applying…" : "Apply override + revalidate"}
            </button>
            {overrideMsg && (
              <p className="text-sm text-[var(--color-ink-muted)]">
                {overrideMsg}
              </p>
            )}
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
