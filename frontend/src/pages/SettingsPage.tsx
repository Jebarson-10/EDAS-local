import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { Bento, Tile, TileHeader } from "../components/ui";
import {
  apiHealth,
  activateRuleVersionApi,
  createRuleVersionApi,
  fetchExamCycles,
  fetchRuleVersions,
} from "../lib/api";

export function SettingsPage() {
  const {
    role,
    rules,
    examCycle,
    logAudit,
    setActiveRuleVersion,
    hydrateReady,
    hydrateReport,
  } = useApp();
  const rulesOutcome = hydrateReport.sources.rule_parameters;
  const [health, setHealth] = useState<string>("Checking…");
  const [cycles, setCycles] = useState<string>("—");
  const [versions, setVersions] = useState<
    Array<{
      rule_version_id: string;
      version_label: string;
      description: string | null;
      is_active: number;
    }>
  >([]);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<null | "create" | "activate">(null);
  const busyRef = useRef(false);
  const busy = busyKind !== null;

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

  async function refresh() {
    const h = await apiHealth();
    if (!h) {
      setHealth(
        "Saved data is unavailable. Reopen the app to try again.",
      );
      return;
    }
    setHealth(h.ok && h.dbOk !== false ? "Saved data is ready" : "Saved data is unavailable. Reopen the app to try again.");
    const c = await fetchExamCycles(role);
    setCycles(c ? `${c.cycles.length} cycle(s)` : "unavailable");
    const v = await fetchRuleVersions(role);
    setVersions(v?.versions ?? []);
  }

  useEffect(() => {
    void refresh();
  }, [role]);

  async function createVersion() {
    if (role !== "ADMIN") {
      setErr("Only ADMIN may create rule versions (rules.manage)");
      return;
    }
    if (!label.trim() || !description.trim()) {
      setErr("Version label and description required");
      return;
    }
    if (!startBusy("create")) return;
    try {
      const api = await createRuleVersionApi(role, {
        versionLabel: label.trim(),
        description: description.trim(),
        cloneFromId: "rv-2027-1",
        activate: false,
      });
      if (!api?.ok) {
        setErr(api?.error ?? "Saved data is unavailable");
        return;
      }
      logAudit(
        "CREATE",
        `Rule version ${api.ruleVersionId} (${label.trim()}) cloned from rv-2027-1`,
      );
      setMsg(
        `Created ${api.ruleVersionId} — parameters cloned; not auto-activated`,
      );
      setErr(null);
      setLabel("");
      setDescription("");
      void refresh();
    } finally {
      stopBusy();
    }
  }

  async function activateVersion(ruleVersionId: string, versionLabel: string) {
    if (role !== "ADMIN") {
      setErr("Only ADMIN may activate rule versions (rules.manage)");
      return;
    }
    if (!startBusy("activate")) return;
    try {
      const api = await activateRuleVersionApi(role, ruleVersionId);
      if (!api?.ok) {
        setErr(api?.error ?? "Saved data is unavailable");
        return;
      }
      await setActiveRuleVersion(ruleVersionId, api.versionLabel ?? versionLabel);
      logAudit(
        "UPDATE",
        `Activated rule version ${ruleVersionId} (${api.versionLabel ?? versionLabel})`,
      );
      setMsg(
        `Activated ${ruleVersionId} — selected for future examinations. This examination keeps its existing rules.`,
      );
      setErr(null);
      void refresh();
    } finally {
      stopBusy();
    }
  }

  return (
    <Bento>
      <Tile span={3} rowSpan={2}>
        <TileHeader
          title="Settings"
          hint="Check saved data and the rules used for allotment."
        />
        <dl className="text-sm space-y-2">
          <div>
            <dt className="text-[var(--color-ink-muted)]">Saved data</dt>
            <dd data-testid="api-health">{health}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-ink-muted)]">Examinations</dt>
            <dd>{cycles}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-ink-muted)]">
              Rules for this examination
            </dt>
            <dd
              data-testid={
                rulesOutcome === "failed"
                  ? "rules-failed"
                  : !hydrateReady || !rulesOutcome
                    ? "rules-loading"
                    : "rules-catalog"
              }
            >
              {rulesOutcome === "failed"
                ? "Saved rules could not be loaded. Allotment is paused until they are available."
                : !hydrateReady || !rulesOutcome
                  ? "Loading saved rules…"
                  : `${examCycle.ruleVersionLabel} · max distance ${rules.maximum_distance_km} km · repeat ${rules.repeat_years}y · hall ${rules.students_per_hall}/${rules.standby_percentage}%`}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-ink-muted)]">Access</dt>
            <dd>
              This is a single-user desktop app. Full access is enabled for the
              person using this computer.
            </dd>
          </div>
        </dl>
      </Tile>

      <Tile span={3} rowSpan={2}>
        <TileHeader
          title="Rule versions"
          hint="Keep separate sets of rules for different examinations. Previous examinations keep their own rules."
        />
        <div className="overflow-auto max-h-40 border border-[var(--color-line)] rounded text-sm mb-3">
          <table className="min-w-full">
            <thead className="bg-[var(--color-sky-wash)]">
              <tr>
                <th className="text-left px-2 py-1">Id</th>
                <th className="text-left px-2 py-1">Label</th>
                <th className="text-left px-2 py-1">Active</th>
                <th className="text-left px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr
                  key={v.rule_version_id}
                  className="border-t border-[var(--color-line)]"
                >
                  <td className="px-2 py-1 font-mono text-xs">
                    {v.rule_version_id}
                  </td>
                  <td className="px-2 py-1">{v.version_label}</td>
                  <td className="px-2 py-1">{v.is_active ? "Yes" : "No"}</td>
                  <td className="px-2 py-1">
                    {!v.is_active && (
                      <button
                        type="button"
                        disabled={role !== "ADMIN" || busy}
                        data-testid={`activate-rule-${v.rule_version_id}`}
                        onClick={() =>
                          void activateVersion(
                            v.rule_version_id,
                            v.version_label,
                          )
                        }
                        className="rounded border border-[var(--color-line)] px-2 py-0.5 text-xs disabled:opacity-40"
                      >
                        {busyKind === "activate" ? "Activating…" : "Activate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {versions.length === 0 && (
                <tr>
                  <td
                    className="px-2 py-2 text-[var(--color-ink-muted)]"
                    colSpan={4}
                  >
                    No versions from API yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="space-y-2">
          <input
            className="w-full border border-[var(--color-line)] rounded px-2 py-1 text-sm"
            placeholder="New version label (e.g. 2027.2-draft)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            data-testid="rule-version-label"
          />
          <input
            className="w-full border border-[var(--color-line)] rounded px-2 py-1 text-sm"
            placeholder="Description / reason for new version"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="rule-version-description"
          />
          <button
            type="button"
            disabled={role !== "ADMIN" || busy}
            onClick={() => void createVersion()}
            data-testid="create-rule-version"
            className="rounded bg-[var(--color-brand)] text-white px-3 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "create"
              ? "Creating…"
              : "Copy rules to a new set"}
          </button>
          {msg && <p className="text-sm text-[var(--color-ok)]">{msg}</p>}
          {err && <p className="text-sm text-[var(--color-err)]">{err}</p>}
        </div>
      </Tile>


    </Bento>
  );
}
