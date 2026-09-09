import { useEffect, useRef, useState } from "react";
import {
  examWindowDraftInputs,
  latestRunForModuleInCycle,
  publishBackupSuffix,
  type ExamTimetableEntry,
  type ExamCycleStatus,
} from "@exam-duty/shared";
import { useApp, isTheoryRun } from "../state/AppContext";
import { Badge, Bento, Tile, TileHeader } from "../components/ui";

const NEXT: Partial<Record<ExamCycleStatus, ExamCycleStatus>> = {
  DRAFT: "OPEN",
  OPEN: "ALLOCATION_GENERATED",
  ALLOCATION_GENERATED: "UNDER_REVIEW",
  UNDER_REVIEW: "APPROVED",
  APPROVED: "PUBLISHED",
  PUBLISHED: "LOCKED",
  LOCKED: "ARCHIVED",
};

export function ExamCyclePage() {
  const {
    examCycle,
    transitionExamCycle,
    setExamWindow,
    publishLatestTheoryRun,
    createAmendment,
    timetable,
    timetableState,
    saveTimetable,
    dataset,
    role,
    runs,
  } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [start, setStart] = useState(
    () => examWindowDraftInputs(examCycle).start,
  );
  const [end, setEnd] = useState(() => examWindowDraftInputs(examCycle).end);
  const [busyKind, setBusyKind] = useState<
    null | "status" | "publish" | "amend" | "window" | "timetable"
  >(null);
  const [timetableDraft, setTimetableDraft] = useState<ExamTimetableEntry[]>([]);
  const busyRef = useRef(false);
  const busy = busyKind !== null;
  useEffect(() => {
    const draft = examWindowDraftInputs(examCycle);
    setStart(draft.start);
    setEnd(draft.end);
  }, [examCycle.examCycleId, examCycle.startDate, examCycle.endDate]);
  useEffect(() => setTimetableDraft(timetable), [timetable]);
  const canManage = role === "ADMIN" || role === "OFFICER";
  const latestPicked = latestRunForModuleInCycle(
    runs,
    "THEORY",
    examCycle.examCycleId,
  );
  const latest =
    latestPicked && isTheoryRun(latestPicked) ? latestPicked : undefined;

  function startBusy(kind: NonNullable<typeof busyKind>) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusyKind(kind);
    return true;
  }
  function stopBusy() {
    busyRef.current = false;
    setBusyKind(null);
  }

  return (
    <Bento>
      <Tile span={4}>
        <TileHeader
          title="Exam cycle workflow"
          hint="Published allocations are immutable — corrections require an audited amendment cycle"
          action={
            <Badge
              tone={
                examCycle.status === "PUBLISHED" ||
                examCycle.status === "LOCKED"
                  ? "ok"
                  : "neutral"
              }
            >
              {examCycle.status}
            </Badge>
          }
        />
        <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
          Rule {examCycle.ruleVersionLabel} · {examCycle.examCycleId}
          {examCycle.amendedFromId ? ` (from ${examCycle.amendedFromId})` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {NEXT[examCycle.status] &&
            examCycle.status !== "APPROVED" &&
            examCycle.status !== "UNDER_REVIEW" && (
              <button
                type="button"
                disabled={!canManage || busy}
                className="rounded border border-[var(--color-line)] px-3 py-2 text-sm disabled:opacity-40"
                onClick={() => {
                  if (!startBusy("status")) return;
                  const to = NEXT[examCycle.status]!;
                  void (async () => {
                    try {
                      const r = await transitionExamCycle(to);
                      if (!r.ok) setErr(r.error);
                      else {
                        setMsg(`Moved to ${to}`);
                        setErr(null);
                      }
                    } finally {
                      stopBusy();
                    }
                  })();
                }}
              >
                {busyKind === "status"
                  ? "Saving…"
                  : `Advance → ${NEXT[examCycle.status]}`}
              </button>
            )}
          {(examCycle.status === "ALLOCATION_GENERATED" ||
            examCycle.status === "UNDER_REVIEW") && (
            <button
              type="button"
              disabled={!canManage || busy}
              className="rounded border border-[var(--color-line)] px-3 py-2 text-sm disabled:opacity-40"
              onClick={() => {
                if (!startBusy("status")) return;
                const to =
                  examCycle.status === "ALLOCATION_GENERATED"
                    ? "UNDER_REVIEW"
                    : "APPROVED";
                void (async () => {
                  try {
                    const r = await transitionExamCycle(to);
                    if (!r.ok) setErr(r.error);
                    else {
                      setMsg(`Moved to ${to}`);
                      setErr(null);
                    }
                  } finally {
                    stopBusy();
                  }
                })();
              }}
            >
              {busyKind === "status"
                ? "Saving…"
                : examCycle.status === "ALLOCATION_GENERATED"
                  ? "Mark under review"
                  : "Approve"}
            </button>
          )}
          <button
            type="button"
            data-testid="publish-run"
            disabled={!canManage || !latest?.result || busy}
            className="rounded bg-[var(--color-brand)] text-white px-3 py-2 text-sm disabled:opacity-40"
            onClick={() => {
              if (!startBusy("publish")) return;
              void (async () => {
                try {
                  const r = await publishLatestTheoryRun();
                  if (!r.ok) {
                    setErr(r.error);
                    return;
                  }
                  setMsg(r.message);
                  setErr(null);
                  const { backupApi } = await import("../lib/api");
                  const bak = await backupApi(
                    role,
                    null,
                    "post-publish-archival",
                    { fromServer: true },
                  );
                  if (bak?.backupId && !bak.error) {
                    setMsg(`${r.message}${publishBackupSuffix(bak)}`);
                  }
                } finally {
                  stopBusy();
                }
              })();
            }}
          >
            {busyKind === "publish" ? "Publishing…" : "Publish theory (+ practical/hall if generated)"}
          </button>
          {(examCycle.status === "PUBLISHED" ||
            examCycle.status === "LOCKED") && (
            <button
              type="button"
              disabled={!canManage || busy}
              className="rounded border border-[var(--color-line)] px-3 py-2 text-sm disabled:opacity-40"
              onClick={() => {
                const to = NEXT[examCycle.status];
                if (!to) return;
                if (!startBusy("status")) return;
                void (async () => {
                  try {
                    const r = await transitionExamCycle(to);
                    if (!r.ok) setErr(r.error);
                    else {
                      setMsg(`Moved to ${to}`);
                      setErr(null);
                    }
                  } finally {
                    stopBusy();
                  }
                })();
              }}
            >
              {busyKind === "status"
                ? "Saving…"
                : `Advance → ${NEXT[examCycle.status]}`}
            </button>
          )}
        </div>
        {msg && <p className="mt-3 text-sm text-[var(--color-ok)]">{msg}</p>}
        {err && <p className="mt-3 text-sm text-[var(--color-err)]">{err}</p>}
      </Tile>

      <Tile span={2}>
        <TileHeader
          title="Amendment / correction"
          hint="After publish, never edit in place — create a versioned amendment with a mandatory reason"
        />
        <input
          className="w-full border border-[var(--color-line)] rounded px-2 py-1 text-sm mb-2"
          placeholder="Amendment reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          type="button"
          data-testid="create-amendment"
          disabled={!canManage || !reason.trim() || busy}
          className="rounded bg-[var(--color-brand-accent)] text-white px-3 py-2 text-sm disabled:opacity-40"
          onClick={() => {
            if (!startBusy("amend")) return;
            void (async () => {
              try {
                const r = await createAmendment(reason.trim());
                if (!r.ok) setErr(r.error);
                else {
                  setMsg(r.message);
                  setErr(null);
                  setReason("");
                }
              } finally {
                stopBusy();
              }
            })();
          }}
        >
          {busyKind === "amend" ? "Creating…" : "Create amendment cycle"}
        </button>
      </Tile>

      <Tile span={3}>
        <TileHeader
          title="Examination window"
          hint="Set the overall date range; then add the exact dated sessions below."
          action={
            <Badge tone={examCycle.startDate ? "ok" : "warn"}>
              {examCycle.startDate
                ? `${examCycle.startDate} → ${examCycle.endDate ?? "open"}`
                : "Not set"}
            </Badge>
          }
        />
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
            First exam day
            <input
              type="date"
              data-testid="exam-window-start"
              className="rounded border border-[var(--color-line)] px-2 py-1 text-sm"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
            Last exam day
            <input
              type="date"
              data-testid="exam-window-end"
              className="rounded border border-[var(--color-line)] px-2 py-1 text-sm"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          data-testid="save-exam-window"
          disabled={!canManage || busy}
          className="self-start rounded border border-[var(--color-line)] px-3 py-2 text-sm disabled:opacity-40"
          onClick={() => {
            if (!startBusy("window")) return;
            void (async () => {
              try {
                const r = await setExamWindow(start || null, end || null);
                if (!r.ok) setErr(r.error);
                else {
                  setMsg(
                    start
                      ? `Examination window saved (${start} → ${end || "open"})`
                      : "Examination window cleared",
                  );
                  setErr(null);
                }
              } finally {
                stopBusy();
              }
            })();
          }}
        >
          {busyKind === "window" ? "Saving…" : "Save window"}
        </button>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          The timetable controls theory and hall duty dates and sessions. Practical
          scheduling uses this window as its permitted date range.
        </p>
      </Tile>

      <Tile span={6}>
        <TileHeader
          title="Exam timetable"
          hint="Add one row for every examination date and session. Select a school when the session applies only to its linked centre; leave All schools for a district-wide session."
          action={<Badge tone={timetableDraft.length ? "ok" : "warn"}>{timetableDraft.length ? `${timetableDraft.length} session(s)` : "Add sessions"}</Badge>}
        />
        {timetableState === "failed" ? <p className="mb-3 text-sm text-[var(--color-err)]">Timetable could not be read from saved data. Reopen the app before generating duties.</p> : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-sky-wash)]">
              <tr><th className="px-2 py-2 text-left">Date</th><th className="px-2 py-2 text-left">Session</th><th className="px-2 py-2 text-left">School</th><th className="px-2 py-2 text-left">Subject / paper</th><th className="px-2 py-2 text-left">Chief duty</th><th className="px-2 py-2 text-left">Hall duty</th><th className="px-2 py-2 text-left">Notes</th><th className="px-2 py-2" /></tr>
            </thead>
            <tbody>
              {timetableDraft.map((row, index) => (
                <tr key={row.timetableEntryId || `${row.examDate}-${row.sessionCode}-${index}`} className="border-t border-[var(--color-line)]">
                  <td className="p-2"><input type="date" className="rounded border border-[var(--color-line)] px-2 py-1" value={row.examDate} onChange={(e) => setTimetableDraft((rows) => rows.map((r, i) => i === index ? { ...r, examDate: e.target.value } : r))} /></td>
                  <td className="p-2"><select className="rounded border border-[var(--color-line)] px-2 py-1" value={row.sessionCode} onChange={(e) => setTimetableDraft((rows) => rows.map((r, i) => i === index ? { ...r, sessionCode: e.target.value as ExamTimetableEntry["sessionCode"] } : r))}><option value="MORNING">Morning</option><option value="AFTERNOON">Afternoon</option></select></td>
                  <td className="p-2"><select className="min-w-48 rounded border border-[var(--color-line)] px-2 py-1" value={row.schoolId ?? ""} onChange={(e) => setTimetableDraft((rows) => rows.map((r, i) => i === index ? { ...r, schoolId: e.target.value || null } : r))}><option value="">All schools</option>{(dataset?.schools ?? []).filter((school) => school.active).map((school) => <option key={school.schoolId} value={school.schoolId}>{school.schoolCode} · {school.schoolName}</option>)}</select></td>
                  <td className="p-2"><input className="min-w-44 rounded border border-[var(--color-line)] px-2 py-1" placeholder="e.g. Tamil" value={row.subjectLabel} onChange={(e) => setTimetableDraft((rows) => rows.map((r, i) => i === index ? { ...r, subjectLabel: e.target.value } : r))} /></td>
                  <td className="p-2 text-center"><input aria-label="Chief duty required" type="checkbox" checked={row.requiresChief} onChange={(e) => setTimetableDraft((rows) => rows.map((r, i) => i === index ? { ...r, requiresChief: e.target.checked } : r))} /></td>
                  <td className="p-2 text-center"><input aria-label="Hall duty required" type="checkbox" checked={row.requiresHall} onChange={(e) => setTimetableDraft((rows) => rows.map((r, i) => i === index ? { ...r, requiresHall: e.target.checked } : r))} /></td>
                  <td className="p-2"><input className="min-w-40 rounded border border-[var(--color-line)] px-2 py-1" value={row.notes ?? ""} onChange={(e) => setTimetableDraft((rows) => rows.map((r, i) => i === index ? { ...r, notes: e.target.value || null } : r))} /></td>
                  <td className="p-2"><button type="button" className="text-[var(--color-err)] underline" onClick={() => setTimetableDraft((rows) => rows.filter((_, i) => i !== index))}>Remove</button></td>
                </tr>
              ))}
              {!timetableDraft.length ? <tr><td colSpan={8} className="p-3 text-[var(--color-ink-muted)]">No sessions entered. Add the official timetable before generating theory or hall duties.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded border border-[var(--color-line)] px-3 py-2 text-sm" disabled={!canManage || busy} onClick={() => setTimetableDraft((rows) => [...rows, { timetableEntryId: `tmp_${crypto.randomUUID()}`, schoolId: null, examDate: start, sessionCode: "MORNING", subjectLabel: "", requiresChief: true, requiresHall: true, notes: null }])}>Add timetable row</button>
          <button type="button" className="rounded bg-[var(--color-brand)] px-3 py-2 text-sm text-white disabled:opacity-40" disabled={!canManage || busy || timetableState === "loading" || timetableDraft.some((row) => !row.examDate || !row.subjectLabel.trim())} onClick={() => { if (!startBusy("timetable")) return; void (async () => { try { const r = await saveTimetable(timetableDraft.map((row) => ({ ...row, subjectLabel: row.subjectLabel.trim() }))); if (!r.ok) setErr(r.error); else { setMsg(`Saved ${timetableDraft.length} timetable session(s)`); setErr(null); } } finally { stopBusy(); } })(); }}>{busyKind === "timetable" ? "Saving…" : "Save timetable"}</button>
        </div>
      </Tile>
    </Bento>
  );
}
