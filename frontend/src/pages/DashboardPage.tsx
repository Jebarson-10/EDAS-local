import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  latestRunForModuleInCycle,
  runsForExamCycle,
} from "@exam-duty/shared";
import { useApp } from "../state/AppContext";
import { apiHealth } from "../lib/api";
import {
  Badge,
  Bento,
  Dot,
  EmptyState,
  Stat,
  Tile,
  TileHeader,
} from "../components/ui";

type Health = Awaited<ReturnType<typeof apiHealth>>;

const CYCLE_TONE: Record<string, "neutral" | "ok" | "warn" | "err"> = {
  DRAFT: "neutral",
  OPEN: "neutral",
  ALLOCATION_GENERATED: "warn",
  VALIDATED: "warn",
  APPROVED: "ok",
  PUBLISHED: "ok",
  LOCKED: "ok",
  ARCHIVED: "neutral",
};

export function DashboardPage() {
  const {
    dataset,
    loading,
    runs,
    audit,
    examCycleName,
    examCycle,
    hydrateReport,
    hydrateReady,
  } = useApp();
  const [health, setHealth] = useState<Health>(null);
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    void apiHealth().then((h) => {
      setHealth(h);
      setProbed(true);
    });
  }, [runs.length, dataset?.teachers.length]);

  if (loading || !dataset) {
    return (
      <Bento>
        <Tile span={6}>
          <TileHeader
            title="Loading control room"
            hint="Reading synthetic master data and hydrating from the API"
          />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl bg-[var(--color-paper)]"
              />
            ))}
          </div>
        </Tile>
      </Bento>
    );
  }

  const stats = [
    { label: "Blocks", value: dataset.blocks.length, to: "/master" },
    { label: "Schools", value: dataset.schools.length, to: "/master" },
    { label: "Centres", value: dataset.centres.length, to: "/master" },
    { label: "Teachers", value: dataset.teachers.length, to: "/master" },
    {
      label: "Subjects",
      value: dataset.subjects?.length ?? 0,
      to: "/master",
    },
    { label: "History rows", value: dataset.history.length, to: "/audit" },
    {
      label: "Runs",
      value: runsForExamCycle(runs, examCycle.examCycleId).length,
      to: "/validation",
    },
  ];

  const modules = (["THEORY", "PRACTICAL", "HALL"] as const).map((m) => {
    const latest = latestRunForModuleInCycle(runs, m, examCycle.examCycleId);
    return {
      module: m,
      status: latest?.validationStatus ?? "NOT RUN",
      runId: latest?.runId,
      to:
        m === "THEORY" ? "/theory" : m === "PRACTICAL" ? "/practical" : "/hall",
    };
  });

  const dbTone = !probed ? "idle" : health?.dbOk ? "ok" : "err";
  const r2Tone = !probed
    ? "idle"
    : health?.r2Ok === true
      ? "ok"
      : health?.r2Ok === false
        ? "err"
        : "warn";
  const accessTone = !probed
    ? "idle"
    : health?.accessRoleMapConfigured
      ? "ok"
      : "warn";

  return (
    <Bento>
      <Tile span={4} rowSpan={2} tone="brand">
        <div className="flex flex-1 flex-col justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">Exam cycle</Badge>
              <Badge tone={CYCLE_TONE[examCycle.status] ?? "neutral"}>
                {examCycle.status}
              </Badge>
              <Badge tone="brand">Rules {examCycle.ruleVersionLabel}</Badge>
            </div>
            <h1 className="font-display mt-3 text-2xl leading-tight md:text-3xl">
              {examCycleName}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-white/75">
              Duty lists use the saved school, teacher, centre and previous-duty
              information. The app checks every list again before approval.
            </p>
            <p
              className="mt-2 text-xs text-white/70"
              data-testid="dashboard-hydrate"
            >
              {!hydrateReady
                ? "Loading saved school and teacher lists…"
                : hydrateReport.failed.length
                  ? `These saved lists are unavailable: ${hydrateReport.failed.join(", ")}`
                  : hydrateReport.empty.length
                    ? `Saved lists ready. No entries yet for: ${hydrateReport.empty.join(", ")}`
                    : "Saved lists are ready"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              tone="brand"
              label="Teachers"
              value={dataset.teachers.length}
              sub="active master"
            />
            <Stat
              tone="brand"
              label="Centres"
              value={dataset.centres.length}
              sub="with clubbing"
            />
            <Stat
              tone="brand"
              label="History"
              value={dataset.history.length}
              sub="published duties"
            />
            <Stat
              tone="brand"
              label="Runs"
              value={runsForExamCycle(runs, examCycle.examCycleId).length}
              sub="this cycle"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/theory"
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-[var(--color-brand)] hover:bg-white/90"
            >
              Generate theory duty
            </Link>
            <Link
              to="/cycles"
              className="rounded-full border border-white/30 px-4 py-2 text-sm text-white hover:bg-white/10"
            >
              Cycle & publish
            </Link>
            <Link
              to="/imports"
              className="rounded-full border border-white/30 px-4 py-2 text-sm text-white hover:bg-white/10"
            >
              Import Excel
            </Link>
          </div>
        </div>
      </Tile>

      <Tile span={2} rowSpan={2}>
        <TileHeader
          title="System health"
          hint="Honest binding probe — never assumes Cloudflare is wired"
          action={
            probed ? (
              <Badge tone={health?.ok ? "ok" : "err"}>
                {health?.ok ? "Online" : "Offline"}
              </Badge>
            ) : null
          }
        />
        {!probed ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Checking saved data…</p>
        ) : !health ? (
          <EmptyState
            testId="health-offline"
            title="Saved data is unavailable"
            body="The app cannot save changes or approve lists until the local data service reconnects."
          />
        ) : (
          <div className="space-y-3 text-sm">
            <ul className="space-y-2">
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Dot tone={dbTone} /> Saved data
                </span>
                <span className="text-[var(--color-ink-muted)]">
                  {health.dbOk ? "ready" : "unavailable"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Dot tone={r2Tone} /> Backup storage
                </span>
                <span className="text-[var(--color-ink-muted)]">
                  {health.r2Ok === true
                    ? "ready"
                    : health.r2Ok === false
                      ? "unavailable"
                      : "local files"}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Dot tone={accessTone} /> User access
                </span>
                <span className="text-[var(--color-ink-muted)]">
                  {health.accessRoleMapConfigured
                    ? `${health.accessRoleMapEntries} entries`
                    : "not set up"}
                </span>
              </li>
            </ul>
            <div className="rounded-xl bg-[var(--color-paper)] px-3 py-2">
              <p
                className="text-xs text-[var(--color-ink-muted)]"
                data-testid="api-counts"
              >
                Saved records: teachers={health.counts?.teachers ?? "?"}{" "}
                schools=
                {health.counts?.schools ?? "?"} centres=
                {health.counts?.centres ?? "?"} blocks=
                {health.counts?.blocks ?? "?"} subjects=
                {health.counts?.subjects ?? "?"} history=
                {health.counts?.history ?? "?"}
              </p>
              <p
                className="mt-1 font-mono text-[0.68rem] text-[var(--color-ink-muted)]"
                data-testid="binding-line"
              >
                Bindings: ok={String(health.ok)} dbOk=
                {String(health.dbOk ?? "—")} r2Ok=
                {String(health.r2Ok ?? "—")} ({health.environment ?? "?"})
              </p>
            </div>
          </div>
        )}
      </Tile>

      {stats.map((s) => (
        <Tile key={s.label} span={1} interactive padded={false}>
          <Link to={s.to} className="flex h-full flex-col justify-between p-4">
            <Stat label={s.label} value={s.value} />
            <span className="mt-2 text-[0.7rem] text-[var(--color-ink-muted)]">
              View →
            </span>
          </Link>
        </Tile>
      ))}

      <Tile span={3}>
        <TileHeader
          title="Allocation pipeline"
          hint="Each module keeps its own versioned run and validator verdict"
        />
        <ul className="space-y-2">
          {modules.map((m) => (
            <li
              key={m.module}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {m.module.charAt(0) + m.module.slice(1).toLowerCase()}
                </p>
                <p
                  className="truncate font-mono text-[0.68rem] text-[var(--color-ink-muted)]"
                  data-testid={`pipeline-${m.module.toLowerCase()}-run`}
                >
                  {m.runId ? m.runId.slice(0, 18) : "no run yet"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  testId={`pipeline-${m.module.toLowerCase()}-status`}
                  tone={
                    m.status === "VALID"
                      ? "ok"
                      : m.status === "INVALID"
                        ? "err"
                        : m.status === "NOT RUN"
                          ? "neutral"
                          : "warn"
                  }
                >
                  {m.status}
                </Badge>
                <Link
                  to={m.to}
                  className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs hover:bg-[var(--color-paper)]"
                >
                  Open
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </Tile>

      <Tile span={3}>
        <TileHeader
          title="Recent activity"
          hint="Every override, publish and restore is audited"
          action={
            <Link
              to="/audit"
              className="text-xs text-[var(--color-brand)] underline"
            >
              Full trail
            </Link>
          }
        />
        {audit.length === 0 ? (
          <EmptyState
            title="No activity yet"
            body="Import master data or generate an allocation run to start the audit trail."
          />
        ) : (
          <ul className="max-h-56 space-y-2 overflow-auto pr-1">
            {audit.slice(0, 8).map((a) => (
              <li
                key={a.id}
                className="border-b border-[var(--color-line)] pb-2 last:border-0"
              >
                <p className="text-sm">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-[var(--color-ink-muted)]">
                    {" "}
                    · {a.detail}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Tile>

      <Tile span={6}>
        <TileHeader
          title="Data provenance"
          hint="Where the numbers above came from"
        />
        <p className="text-xs text-[var(--color-ink-muted)]">
          {dataset.meta.note}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to="/open-questions"
            className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs hover:bg-[var(--color-paper)]"
          >
            Open business questions
          </Link>
          <Link
            to="/backups"
            className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs hover:bg-[var(--color-paper)]"
          >
            Backup & restore
          </Link>
          <Link
            to="/settings"
            className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs hover:bg-[var(--color-paper)]"
          >
            Rules & bindings
          </Link>
        </div>
      </Tile>
    </Bento>
  );
}
