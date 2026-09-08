import { useEffect, useRef, useState } from "react";
import {
  examWindowDraftInputs,
  latestRunForModuleInCycle,
  publishBackupSuffix,
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
    null | "status" | "publish" | "amend" | "window"
  >(null);
  const busyRef = useRef(false);
  const busy = busyKind !== null;
  useEffect(() => {
    const draft = examWindowDraftInputs(examCycle);
    setStart(draft.start);
    setEnd(draft.end);
  }, [examCycle.examCycleId, examCycle.startDate, examCycle.endDate]);
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
          hint="Bounds the duty dates this cycle can allocate — the day-by-day subject timetable is not modelled (OQ-020)"
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
          Until this is set, theory and hall allocate on a synthetic placeholder
          date and practical uses a placeholder start.
        </p>
      </Tile>
    </Bento>
  );
}
