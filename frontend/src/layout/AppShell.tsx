import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { apiHealth } from "../lib/api";
import { Badge, Dot } from "../components/ui";
import type { Role } from "@exam-duty/shared";

const groups: Array<{
  label: string;
  links: Array<{ to: string; label: string }>;
}> = [
  {
    label: "Overview",
    links: [
      { to: "/", label: "Dashboard" },
      { to: "/cycles", label: "Exam cycle" },
    ],
  },
  {
    label: "Data",
    links: [
      { to: "/master", label: "Master data" },
      { to: "/imports", label: "Imports" },
    ],
  },
  {
    label: "Allotment",
    links: [
      { to: "/theory", label: "Theory" },
      { to: "/practical", label: "Practical" },
      { to: "/hall", label: "Hall" },
      { to: "/validation", label: "Validation" },
    ],
  },
  {
    label: "Governance",
    links: [
      { to: "/reports", label: "Reports" },
      { to: "/audit", label: "Audit" },
      { to: "/backups", label: "Backups" },
      { to: "/settings", label: "Settings" },
      { to: "/open-questions", label: "Open questions" },
    ],
  },
];

const flatLinks = groups.flatMap((g) => g.links);

const roles: Role[] = ["ADMIN", "OFFICER", "DATA_OPERATOR", "VIEWER"];

export function AppShell() {
  const { role, setRole, examCycleName, examCycle, hydrateReport, hydrateReady } =
    useApp();
  const location = useLocation();
  const [apiUp, setApiUp] = useState<boolean | null>(null);
  const [dbUp, setDbUp] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [hydrateDismissed, setHydrateDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const probe = () =>
      void apiHealth().then((h) => {
        if (cancelled) return;
        setApiUp(Boolean(h));
        setDbUp(h ? Boolean(h.dbOk) : null);
      });
    probe();
    const t = setInterval(probe, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [location.pathname]);

  const currentLabel =
    flatLinks.find((l) =>
      l.to === "/"
        ? location.pathname === "/"
        : location.pathname.startsWith(l.to),
    )?.label ?? "Dashboard";

  const showBanner =
    !dismissed && (apiUp === false || (apiUp === true && dbUp === false));
  const showHydrateBanner =
    !hydrateDismissed &&
    hydrateReady &&
    hydrateReport.failed.length > 0 &&
    apiUp === true &&
    dbUp !== false;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-brand)] text-[var(--color-sky-wash)]">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-3 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid h-10 w-10 place-items-center rounded-xl bg-white/12 font-display text-lg"
            >
              E
            </span>
            <div>
              <p className="font-display text-lg leading-tight tracking-tight">
                Erode Exam Duty
              </p>
              <p className="text-[0.7rem] opacity-75">
                CEO Office · Duty Allotment System
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs opacity-90">{examCycleName}</p>
              <p className="mt-0.5 flex items-center justify-end gap-1.5 text-[0.7rem] opacity-80">
                <Dot
                  tone={apiUp === null ? "idle" : apiUp && dbUp ? "ok" : "err"}
                />
                {examCycle.status} · rules {examCycle.ruleVersionLabel}
              </p>
            </div>
            <div
              className="flex flex-wrap items-center gap-1 rounded-full bg-white/10 p-1"
              role="group"
              aria-label="Role"
            >
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  data-testid={`role-${r}`}
                  aria-pressed={role === r}
                  onClick={() => setRole(r)}
                  className={`rounded-full px-2.5 py-1 text-[0.7rem] transition-colors ${
                    role === r
                      ? "bg-white text-[var(--color-brand)]"
                      : "text-white/80 hover:bg-white/10"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {showBanner ? (
        <div
          data-testid="api-banner"
          className="border-b border-[var(--color-warn)]/30 bg-[var(--color-warn-wash)] text-[var(--color-warn)]"
        >
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs md:px-6">
            <p>
              {apiUp === false
                ? "API unreachable — working on in-memory synthetic data. Runs, publishes and backups will not persist until you start npm run api:local."
                : "API is up but the database probe failed — persistence and publishing are unsafe until the D1/SQLite binding recovers."}
            </p>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-full border border-[var(--color-warn)]/40 px-2.5 py-0.5"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {showHydrateBanner ? (
        <div
          data-testid="hydrate-banner"
          className="border-b border-[var(--color-warn)]/30 bg-[var(--color-warn-wash)] text-[var(--color-warn)]"
        >
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs md:px-6">
            <p>
              Boot hydrate missed D1 for{" "}
              {hydrateReport.failed.join(", ")} — those lists still show the
              in-memory synthetic seed. Refresh after the API recovers; do not
              publish from a mixed demo/D1 view.
            </p>
            <button
              type="button"
              onClick={() => setHydrateDismissed(true)}
              className="rounded-full border border-[var(--color-warn)]/40 px-2.5 py-0.5"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/* Stack on mobile: a full-width nav inside a flex row starves <main> of width. */}
      <div className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-0 px-3 py-4 md:flex-row md:gap-6 md:px-6">
        <nav
          aria-label="Sections"
          className="mb-3 w-full md:mb-0 md:w-56 md:shrink-0"
        >
          <div className="md:sticky md:top-24">
            <ul className="flex gap-1 overflow-x-auto pb-2 md:hidden">
              {flatLinks.map((l) => (
                <li key={l.to}>
                  <NavLink
                    to={l.to}
                    end={l.to === "/"}
                    data-testid={`nav-mobile-${l.to === "/" ? "dashboard" : l.to.slice(1)}`}
                    className={({ isActive }) =>
                      `block whitespace-nowrap rounded-full border px-3 py-1.5 text-xs ${
                        isActive
                          ? "border-transparent bg-[var(--color-brand)] text-white"
                          : "border-[var(--color-line)] bg-white/70 text-[var(--color-ink)]"
                      }`
                    }
                  >
                    {l.label}
                  </NavLink>
                </li>
              ))}
            </ul>

            <div className="hidden space-y-4 md:block">
              {groups.map((g) => (
                <div key={g.label}>
                  <p className="mb-1.5 px-3 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-muted)]">
                    {g.label}
                  </p>
                  <ul className="space-y-0.5">
                    {g.links.map((l) => (
                      <li key={l.to}>
                        <NavLink
                          to={l.to}
                          end={l.to === "/"}
                          data-testid={`nav-${l.to === "/" ? "dashboard" : l.to.slice(1)}`}
                          className={({ isActive }) =>
                            `block rounded-xl px-3 py-2 text-sm transition-colors ${
                              isActive
                                ? "bg-[var(--color-brand)] text-white shadow-sm"
                                : "text-[var(--color-ink)] hover:bg-white/80"
                            }`
                          }
                        >
                          {l.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </nav>

        <main className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl md:text-2xl">{currentLabel}</h1>
            <Badge tone={apiUp ? "ok" : apiUp === false ? "warn" : "neutral"}>
              {apiUp === null
                ? "checking API"
                : apiUp
                  ? "API connected"
                  : "offline mode"}
            </Badge>
            <Badge
              testId="hydrate-status"
              tone={
                !hydrateReady
                  ? "neutral"
                  : hydrateReport.failed.length
                    ? "warn"
                    : "ok"
              }
            >
              {!hydrateReady
                ? "hydrating"
                : hydrateReport.failed.length
                  ? `hydrate missed ${hydrateReport.failed.length}`
                  : "hydrate ok"}
            </Badge>
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
