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
  const [bindings, setBindings] = useState<{
    dbOk?: boolean;
    r2Ok?: boolean | null;
    ok?: boolean;
    accessRoleMapConfigured?: boolean;
    accessRoleMapEntries?: number;
  }>({});
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
        "API offline — run npm run api:local (UI still works in-memory)",
      );
      setBindings({});
      return;
    }
    setBindings({
      ok: h.ok,
      dbOk: h.dbOk,
      r2Ok: h.r2Ok,
      accessRoleMapConfigured: h.accessRoleMapConfigured,
      accessRoleMapEntries: h.accessRoleMapEntries,
    });
    const bindingBit =
      h.dbOk === false ? " · D1 FAIL" : h.dbOk ? " · D1 OK" : "";
    const r2Bit =
      h.r2Ok === true
        ? " · R2 OK"
        : h.r2Ok === false
          ? " · R2 unbound/fail"
          : h.r2Ok === null
            ? " · R2 n/a (local filesystem)"
            : "";
    setHealth(
      `${h.ok ? "OK" : "DEGRADED"} · ${h.environment ?? "unknown"}${bindingBit}${r2Bit} · teachers=${h.counts?.teachers ?? "?"} centres=${h.counts?.centres ?? "?"}`,
    );
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
        setErr(api?.error ?? "API unavailable");
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
        setErr(api?.error ?? "API unavailable");
        return;
      }
      await setActiveRuleVersion(ruleVersionId, api.versionLabel ?? versionLabel);
      logAudit(
        "UPDATE",
        `Activated rule version ${ruleVersionId} (${api.versionLabel ?? versionLabel})`,
      );
      setMsg(
        `Activated ${ruleVersionId} — this is now the active catalog row; the cycle's stored rule id is unchanged until the client answers OQ-021`,
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
          title="Settings & connectivity"
          hint="Live binding truth — nothing here is assumed"
        />
        <dl className="text-sm space-y-2">
          <div>
            <dt className="text-[var(--color-ink-muted)]">API / D1 mirror</dt>
            <dd data-testid="api-health">{health}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-ink-muted)]">
              Binding probe (§107)
            </dt>
            <dd data-testid="binding-probe" className="font-mono text-xs">
              ok={String(bindings.ok ?? "—")} · dbOk=
              {String(bindings.dbOk ?? "—")} · r2Ok=
              {String(bindings.r2Ok ?? "—")} · accessRoleMap=
              {bindings.accessRoleMapConfigured
                ? `configured(${bindings.accessRoleMapEntries ?? 0})`
                : "empty (OQ-010 pending)"}
              {bindings.r2Ok === false
                ? " — staging/production needs R2 FILES binding"
                : ""}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-ink-muted)]">Exam cycles (API)</dt>
            <dd>{cycles}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-ink-muted)]">
              Cycle stored rule version (UI)
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
                ? "Rule parameters unavailable — values shown elsewhere are seed defaults, not the stored catalog. Generate stays disabled."
                : !hydrateReady || !rulesOutcome
                  ? "Waiting for rule parameters from the API…"
                  : `${examCycle.ruleVersionLabel} · max distance ${rules.maximum_distance_km} km · repeat ${rules.repeat_years}y · hall ${rules.students_per_hall}/${rules.standby_percentage}%`}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-ink-muted)]">Auth mode</dt>
            <dd>
              AuthAdapter: Access in staging/production; role from{" "}
              <code>ACCESS_EMAIL_ROLE_MAP</code> (OQ-010) or{" "}
              <code>X-Access-Role</code>; X-Dev-* only in development. Current
              UI role: {role}
            </dd>
          </div>
        </dl>
      </Tile>

      <Tile span={3} rowSpan={2}>
        <TileHeader
          title="Rule versions"
          hint="Changing parameters requires a new cloned version — the active version is never silently edited. Provisional OQ defaults hold until the client confirms."
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
              : "Clone new rule version (ADMIN)"}
          </button>
          {msg && <p className="text-sm text-[var(--color-ok)]">{msg}</p>}
          {err && <p className="text-sm text-[var(--color-err)]">{err}</p>}
        </div>
      </Tile>

      <Tile span={6}>
        <TileHeader
          title="Rule parameters (this session)"
          hint="Hydrated from the cycle's stored rule version in D1. Unknown or invalid keys stay at the documented seed default — they are never invented."
        />
        <pre
          data-testid="rule-parameters-json"
          className="max-h-80 overflow-auto rounded-xl bg-[var(--color-sky-wash)] p-3 text-xs"
        >
          {JSON.stringify(rules, null, 2)}
        </pre>
      </Tile>
    </Bento>
  );
}
