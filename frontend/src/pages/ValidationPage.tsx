import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/AppContext";
import {
  Badge,
  Bento,
  EmptyState,
  Stat,
  Tile,
  TileHeader,
} from "../components/ui";
import {
  conflictsFromPersistedReasons,
  latestRunInCycle,
} from "@exam-duty/shared";
import { fetchAllocationRunReasons, type ApiRole } from "../lib/api";

export function ValidationPage() {
  const { runs, role, examCycle } = useApp();
  const latest = latestRunInCycle(runs, examCycle.examCycleId);
  const [persistedReasons, setPersistedReasons] = useState<
    Array<{
      rule_code: string;
      severity: string;
      message: string;
      teacher_id: string;
      exam_date: string;
      session_code: string;
      details_json: string | null;
    }>
  >([]);
  const [persistNote, setPersistNote] = useState<string | null>(null);

  useEffect(() => {
    if (!latest?.runId) {
      setPersistedReasons([]);
      setPersistNote(null);
      return;
    }
    let cancelled = false;
    void fetchAllocationRunReasons(role as ApiRole, latest.runId).then((r) => {
      if (cancelled) return;
      if (!r) {
        setPersistedReasons([]);
        setPersistNote("API unavailable — session validation only (in memory)");
        return;
      }
      setPersistedReasons(r.reasons);
      setPersistNote(
        r.reasons.length === 0
          ? "No rows in allocation_decision_reasons for this run yet (re-generate to persist)"
          : `Loaded ${r.reasons.length} persisted reason(s) from D1/SQLite`,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [latest?.runId, role]);

  const issueRows = useMemo(() => {
    const live = latest?.validation?.issues ?? [];
    if (live.length > 0) return live;
    // Hydrated runs often have empty in-memory issues — surface persisted rows
    return persistedReasons
      .filter((r) => r.severity === "ERROR" || r.severity === "WARNING")
      .map((r) => ({
        severity: r.severity as "ERROR" | "WARNING" | "INFO",
        ruleCode: r.rule_code,
        message: r.message,
      }));
  }, [latest?.validation?.issues, persistedReasons]);

  const conflicts = useMemo(() => {
    const live = latest?.validation?.conflicts ?? [];
    if (live.length > 0) return live;
    return conflictsFromPersistedReasons(persistedReasons);
  }, [latest?.validation?.conflicts, persistedReasons]);

  const statusLabel =
    latest?.validation?.status ?? latest?.validationStatus ?? "PENDING";
  const assignmentCount =
    latest?.validation?.assignments ??
    (latest?.result && "assignments" in latest.result
      ? latest.result.assignments.length
      : persistedReasons.length > 0
        ? "—"
        : 0);

  return (
    <Bento>
      <Tile span={6}>
        <TileHeader
          title="Validation"
          hint="The validator is independent of the allocator and recalculates hard rules. Runs with ERROR cannot be published; issues and conflicts persist to allocation_decision_reasons."
          action={
            latest ? (
              <Badge
                tone={
                  statusLabel === "VALID"
                    ? "ok"
                    : statusLabel === "INVALID"
                      ? "err"
                      : "warn"
                }
              >
                {statusLabel}
              </Badge>
            ) : null
          }
        />
        {!latest && (
          <EmptyState
            title="No validation yet"
            body="Generate a theory, practical, or hall run — the validator then re-derives every hard rule from master data and published history."
          />
        )}
        {latest && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-ink-muted)]">
              Latest run: <code>{latest.module}</code> · {latest.runId}
              {latest.validation == null ||
              (latest.validation.issues.length === 0 &&
                persistedReasons.length > 0)
                ? " · hydrated from API"
                : ""}
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Box label="Status" value={statusLabel} />
              <Box label="Assignments" value={assignmentCount} />
              <Box label="Valid" value={latest.validation?.valid ?? "—"} />
              <Box label="Errors" value={latest.validation?.errors ?? "—"} />
            </div>
            <div className="overflow-auto max-h-[55vh] border border-[var(--color-line)] rounded text-sm">
              <table className="min-w-full">
                <thead className="bg-[var(--color-sky-wash)]">
                  <tr>
                    <th className="text-left px-2 py-1">Severity</th>
                    <th className="text-left px-2 py-1">Rule</th>
                    <th className="text-left px-2 py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {issueRows.map((i, idx) => (
                    <tr
                      key={idx}
                      className="border-t border-[var(--color-line)]"
                    >
                      <td className="px-2 py-1">{i.severity}</td>
                      <td className="px-2 py-1 font-mono text-xs">
                        {i.ruleCode}
                      </td>
                      <td className="px-2 py-1">{i.message}</td>
                    </tr>
                  ))}
                  {issueRows.length === 0 && (
                    <tr>
                      <td
                        className="px-2 py-2 text-[var(--color-ink-muted)]"
                        colSpan={3}
                      >
                        No ERROR/WARNING issues
                        {persistedReasons.length > 0
                          ? ` (${persistedReasons.length} INFO reasons in persisted panel)`
                          : ""}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Tile>

      {latest && (
        <Tile span={6}>
          <TileHeader
            title="Session conflicts"
            hint="Cross-module same-session conflicts from the independent conflict engine"
          />
          {conflicts.length === 0 ? (
            <p
              className="text-sm text-[var(--color-ok)]"
              data-testid="conflicts-none"
            >
              No session conflicts detected.
            </p>
          ) : (
            <div className="overflow-auto max-h-64 border border-[var(--color-line)] rounded text-sm">
              <table className="min-w-full" data-testid="conflicts-table">
                <thead className="bg-[var(--color-sky-wash)]">
                  <tr>
                    <th className="text-left px-2 py-1">Severity</th>
                    <th className="text-left px-2 py-1">Teacher</th>
                    <th className="text-left px-2 py-1">Date / Session</th>
                    <th className="text-left px-2 py-1">Duties</th>
                    <th className="text-left px-2 py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((c, idx) => (
                    <tr
                      key={idx}
                      className="border-t border-[var(--color-line)]"
                    >
                      <td className="px-2 py-1">{c.severity}</td>
                      <td className="px-2 py-1 font-mono text-xs">
                        {c.teacherId}
                      </td>
                      <td className="px-2 py-1">
                        {c.date} · {c.session}
                      </td>
                      <td className="px-2 py-1">{c.duties.join(", ")}</td>
                      <td className="px-2 py-1">{c.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Tile>
      )}

      {latest?.runId && (
        <Tile span={6}>
          <TileHeader title="Persisted decision reasons" />
          <p
            className="mb-2 text-sm text-[var(--color-ink-muted)]"
            data-testid="persisted-reasons-note"
          >
            {persistNote ?? "Loading…"}
          </p>
          {persistedReasons.length > 0 && (
            <div className="overflow-auto max-h-64 border border-[var(--color-line)] rounded text-sm">
              <table
                className="min-w-full"
                data-testid="persisted-reasons-table"
              >
                <thead className="bg-[var(--color-sky-wash)]">
                  <tr>
                    <th className="text-left px-2 py-1">Severity</th>
                    <th className="text-left px-2 py-1">Rule</th>
                    <th className="text-left px-2 py-1">Teacher</th>
                    <th className="text-left px-2 py-1">When</th>
                    <th className="text-left px-2 py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {persistedReasons.map((r, idx) => (
                    <tr
                      key={idx}
                      className="border-t border-[var(--color-line)]"
                    >
                      <td className="px-2 py-1">{r.severity}</td>
                      <td className="px-2 py-1 font-mono text-xs">
                        {r.rule_code}
                      </td>
                      <td className="px-2 py-1 font-mono text-xs">
                        {r.teacher_id || "—"}
                      </td>
                      <td className="px-2 py-1">
                        {r.exam_date || r.session_code
                          ? [r.exam_date, r.session_code]
                              .filter(Boolean)
                              .join(" · ")
                          : "—"}
                      </td>
                      <td className="px-2 py-1">{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Tile>
      )}
    </Bento>
  );
}

function Box({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-white px-3 py-2.5">
      <Stat label={label} value={value} />
    </div>
  );
}
