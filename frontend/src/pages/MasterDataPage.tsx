import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { Panel } from "../components/ui";
import { MasterEntryPanel } from "../components/MasterEntryPanel";
import {
  apiHealth,
  fetchMasterBlocks,
  fetchMasterCentres,
  fetchMasterSchools,
  fetchMasterSubjects,
  fetchMasterTeachers,
  upsertExemptionApi,
} from "../lib/api";

type Tab =
  | "teachers"
  | "schools"
  | "centres"
  | "blocks"
  | "subjects"
  | "relationships"
  | "exemptions";

export function MasterDataPage() {
  const {
    dataset,
    setDataset,
    loading,
    role,
    exemptions,
    setExemptions,
    logAudit,
    hydrateReady,
    hydrateReport,
  } = useApp();
  const exemptionsOutcome = hydrateReport.sources.exemptions;
  const exemptionsCatalogFailed =
    hydrateReady && exemptionsOutcome === "failed";
  const exemptionsCatalogLoading = !hydrateReady;
  const [tab, setTab] = useState<Tab>("teachers");
  const [q, setQ] = useState("");
  const [apiNote, setApiNote] = useState<string>("Checking API…");
  const [apiCapacityHint, setApiCapacityHint] = useState<string | null>(null);
  const [exTeacherId, setExTeacherId] = useState("");
  const [exReason, setExReason] = useState("");
  const [exMsg, setExMsg] = useState<string | null>(null);
  const [exErr, setExErr] = useState<string | null>(null);
  const [exBusy, setExBusy] = useState(false);
  const exBusyRef = useRef(false);

  useEffect(() => {
    void (async () => {
      const h = await apiHealth();
      if (!h) {
        setApiNote("API offline — showing in-memory demo dataset");
        setApiCapacityHint(null);
        return;
      }
      const [t, s, c, b, sub] = await Promise.all([
        fetchMasterTeachers(role),
        fetchMasterSchools(role),
        fetchMasterCentres(role),
        fetchMasterBlocks(role),
        fetchMasterSubjects(role),
      ]);
      const withCap = (c?.centres ?? []).filter(
        (row) => typeof row.capacity === "number" && row.capacity > 0,
      ).length;
      setApiNote(
        `API mirror · teachers=${t?.teachers?.length ?? h.counts?.teachers ?? "?"} schools=${s?.schools?.length ?? h.counts?.schools ?? "?"} centres=${c?.centres?.length ?? h.counts?.centres ?? "?"} blocks=${b?.blocks?.length ?? h.counts?.blocks ?? "?"} subjects=${sub?.subjects?.length ?? h.counts?.subjects ?? "?"}`,
      );
      setApiCapacityHint(
        withCap > 0
          ? `${withCap} centre(s) have capacity set in SQLite/D1 (strength import)`
          : null,
      );
    })();
  }, [role]);

  const filteredTeachers = useMemo(() => {
    if (!dataset) return [];
    const qq = q.trim().toLowerCase();
    return dataset.teachers.filter(
      (t) =>
        !qq ||
        t.name.toLowerCase().includes(qq) ||
        t.employeeCode.toLowerCase().includes(qq),
    );
  }, [dataset, q]);

  if (loading || !dataset) return <Panel title="Master data">Loading…</Panel>;

  return (
    <Panel title="Master data">
      <p className="text-sm text-[var(--color-ink-muted)] mb-3">
        Current state only. Historical school/designation/location rows are
        preserved separately and never overwritten by imports.{" "}
        <span data-testid="master-api-note">{apiNote}</span>
        {apiCapacityHint ? (
          <>
            {" "}
            · <span data-testid="master-capacity-hint">{apiCapacityHint}</span>
          </>
        ) : null}
      </p>
      <MasterEntryPanel
        dataset={dataset}
        setDataset={setDataset}
        role={role}
        logAudit={logAudit}
      />
      <div className="flex flex-wrap gap-2 mb-3">
        {(
          [
            ["teachers", "Teachers"],
            ["schools", "Schools"],
            ["centres", "Centres"],
            ["blocks", "Blocks"],
            ["subjects", "Subjects"],
            ["relationships", "Clubbing"],
            ["exemptions", "Exemptions"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`master-tab-${id}`}
            onClick={() => setTab(id)}
            className={`rounded px-3 py-1.5 text-sm border ${
              tab === id
                ? "bg-[var(--color-brand)] text-white border-transparent"
                : "bg-white border-[var(--color-line)]"
            }`}
          >
            {label}
          </button>
        ))}
        {tab === "teachers" && (
          <input
            className="ml-auto border border-[var(--color-line)] rounded px-2 py-1 text-sm min-w-[200px]"
            placeholder="Search teachers"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
      </div>

      <div className="overflow-auto max-h-[70vh] border border-[var(--color-line)] rounded">
        {tab === "teachers" && (
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-sky-wash)] sticky top-0">
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Designation</Th>
                <Th>School</Th>
                <Th>Quality</Th>
              </tr>
            </thead>
            <tbody>
              {filteredTeachers.map((t) => (
                <tr
                  key={t.teacherId}
                  className="border-t border-[var(--color-line)]"
                >
                  <Td>{t.employeeCode}</Td>
                  <Td>{t.name}</Td>
                  <Td>{t.designation}</Td>
                  <Td>{t.schoolId}</Td>
                  <Td>{t.dataQuality}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "schools" && (
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-sky-wash)] sticky top-0">
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Block</Th>
              </tr>
            </thead>
            <tbody>
              {dataset.schools.map((s) => {
                const block = dataset.blocks.find(
                  (b) => b.blockId === s.blockId,
                );
                return (
                  <tr
                    key={s.schoolId}
                    className="border-t border-[var(--color-line)]"
                  >
                    <Td>{s.schoolCode}</Td>
                    <Td>{s.schoolName}</Td>
                    <Td>
                      {block
                        ? `${block.blockCode} · ${block.blockName}`
                        : s.blockId}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {tab === "blocks" && (
          <table
            className="min-w-full text-sm"
            data-testid="master-blocks-table"
          >
            <thead className="bg-[var(--color-sky-wash)] sticky top-0">
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
              </tr>
            </thead>
            <tbody>
              {dataset.blocks.map((b) => (
                <tr
                  key={b.blockId}
                  className="border-t border-[var(--color-line)]"
                >
                  <Td>{b.blockCode}</Td>
                  <Td>{b.blockName}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "subjects" && (
          <table
            className="min-w-full text-sm"
            data-testid="master-subjects-table"
          >
            <thead className="bg-[var(--color-sky-wash)] sticky top-0">
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Practical</Th>
              </tr>
            </thead>
            <tbody>
              {(dataset.subjects ?? []).map((s) => (
                <tr
                  key={s.subjectId}
                  className="border-t border-[var(--color-line)]"
                >
                  <Td>{s.code}</Td>
                  <Td>{s.name}</Td>
                  <Td>{s.isPractical ? "yes" : "no"}</Td>
                </tr>
              ))}
              {(dataset.subjects ?? []).length === 0 && (
                <tr>
                  <Td>—</Td>
                  <Td>No subjects hydrated from D1 yet</Td>
                  <Td>—</Td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {tab === "centres" && (
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-sky-wash)] sticky top-0">
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Capacity</Th>
              </tr>
            </thead>
            <tbody>
              {dataset.centres.map((c) => (
                <tr
                  key={c.centreId}
                  className="border-t border-[var(--color-line)]"
                >
                  <Td>{c.centreCode}</Td>
                  <Td>{c.centreName}</Td>
                  <Td>{c.capacity ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "relationships" && (
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--color-sky-wash)] sticky top-0">
              <tr>
                <Th>Centre</Th>
                <Th>School</Th>
                <Th>Type</Th>
                <Th>From</Th>
              </tr>
            </thead>
            <tbody>
              {dataset.relationships.map((r, i) => (
                <tr key={i} className="border-t border-[var(--color-line)]">
                  <Td>{r.centreId}</Td>
                  <Td>{r.schoolId}</Td>
                  <Td>{r.relationshipType}</Td>
                  <Td>{r.effectiveFrom}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "exemptions" && (
          <div className="p-3 space-y-3">
            <p className="text-sm text-[var(--color-ink-muted)]">
              Admin-recorded exemptions (reason required). The Administrator
              decides physical-disability and other exemption cases; every
              decision is retained with audit.
            </p>
            <div className="flex flex-wrap gap-2 items-end">
              <label className="text-sm">
                Teacher id
                <input
                  className="block border border-[var(--color-line)] rounded px-2 py-1 text-sm min-w-[160px]"
                  value={exTeacherId}
                  onChange={(e) => setExTeacherId(e.target.value)}
                  placeholder="tch_00001"
                  data-testid="exemption-teacher-id"
                />
              </label>
              <label className="text-sm grow">
                Reason
                <input
                  className="block w-full border border-[var(--color-line)] rounded px-2 py-1 text-sm"
                  value={exReason}
                  onChange={(e) => setExReason(e.target.value)}
                  data-testid="exemption-reason"
                />
              </label>
              <button
                type="button"
                data-testid="exemption-save"
                disabled={
                  role !== "ADMIN" ||
                  !exTeacherId.trim() ||
                  !exReason.trim() ||
                  exBusy
                }
                className="rounded bg-[var(--color-brand)] text-white px-3 py-1.5 text-sm disabled:opacity-40"
                onClick={() => {
                  if (exBusyRef.current) return;
                  exBusyRef.current = true;
                  setExBusy(true);
                  void (async () => {
                    try {
                      const from = new Date().toISOString().slice(0, 10);
                      const teacherId = exTeacherId.trim();
                      const existing = exemptions.find(
                        (e) =>
                          e.teacherId === teacherId &&
                          e.isExempted !== false &&
                          !e.effectiveTo,
                      );
                      const api = await upsertExemptionApi(role, {
                        id: existing?.id,
                        teacherId,
                        reason: exReason.trim(),
                        effectiveFrom: from,
                      });
                      if (!api?.ok) {
                        setExErr(api?.error ?? "API save failed");
                        setExMsg(null);
                        return;
                      }
                      setExemptions([
                        {
                          id: api.id,
                          teacherId,
                          isExempted: true,
                          reason: exReason.trim(),
                          effectiveFrom: from,
                          effectiveTo: null,
                        },
                        ...exemptions.filter((e) => e.teacherId !== teacherId),
                      ]);
                      logAudit("UPDATE", `Exemption ${exTeacherId}`, exReason);
                      setExMsg(`Saved exemption ${api.id}`);
                      setExErr(null);
                      setExReason("");
                    } finally {
                      exBusyRef.current = false;
                      setExBusy(false);
                    }
                  })();
                }}
              >
                {exBusy ? "Saving…" : "Save exemption"}
              </button>
            </div>
            {exMsg && (
              <p
                className="text-sm text-[var(--color-ok)]"
                data-testid="exemption-ok"
              >
                {exMsg}
              </p>
            )}
            {exErr && (
              <p
                className="text-sm text-[var(--color-err)]"
                data-testid="exemption-error"
              >
                {exErr}
              </p>
            )}
            <table className="min-w-full text-sm border border-[var(--color-line)] rounded">
              <thead className="bg-[var(--color-sky-wash)]">
                <tr>
                  <Th>Teacher</Th>
                  <Th>Reason</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {exemptions.map((e, i) => (
                  <tr
                    key={`${e.teacherId}-${i}`}
                    className="border-t border-[var(--color-line)]"
                  >
                    <Td>{e.teacherId}</Td>
                    <Td>{e.reason}</Td>
                    <Td>{e.effectiveFrom}</Td>
                    <Td>
                      {e.effectiveTo ?? (e.isExempted ? "active" : "ended")}
                    </Td>
                    <Td>
                      {e.isExempted !== false && !e.effectiveTo ? (
                        <button
                          type="button"
                          data-testid={`exemption-end-${e.teacherId}`}
                          disabled={role !== "ADMIN" || exBusy}
                          className="text-sm underline text-[var(--color-brand)] disabled:opacity-40"
                          onClick={() => {
                            if (exBusyRef.current) return;
                            exBusyRef.current = true;
                            setExBusy(true);
                            void (async () => {
                              try {
                                const to = new Date().toISOString().slice(0, 10);
                                const api = await upsertExemptionApi(role, {
                                  id: e.id,
                                  teacherId: e.teacherId,
                                  reason: e.reason || "Ended by officer",
                                  effectiveFrom: e.effectiveFrom,
                                  effectiveTo: to,
                                  isExempted: false,
                                });
                                if (!api?.ok) {
                                  setExErr(api?.error ?? "End exemption failed");
                                  setExMsg(null);
                                  return;
                                }
                                setExemptions(
                                  exemptions.map((row) =>
                                    row.teacherId === e.teacherId
                                      ? {
                                          ...row,
                                          isExempted: false,
                                          effectiveTo: to,
                                        }
                                      : row,
                                  ),
                                );
                                logAudit(
                                  "UPDATE",
                                  `Ended exemption ${e.teacherId}`,
                                  e.reason,
                                );
                                setExMsg(`Ended exemption for ${e.teacherId}`);
                                setExErr(null);
                              } finally {
                                exBusyRef.current = false;
                                setExBusy(false);
                              }
                            })();
                          }}
                        >
                          End
                        </button>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </tr>
                ))}
                {!exemptions.length && (
                  <tr>
                    <Td>—</Td>
                    <Td>
                      {exemptionsCatalogFailed ? (
                        <span
                          className="text-[var(--color-err)]"
                          data-testid="exemptions-failed"
                        >
                          Exemptions unavailable
                        </span>
                      ) : exemptionsCatalogLoading ? (
                        <span data-testid="exemptions-loading">
                          Loading exemptions from the API…
                        </span>
                      ) : (
                        <span data-testid="exemptions-empty">
                          No exemptions loaded
                        </span>
                      )}
                    </Td>
                    <Td>—</Td>
                    <Td>—</Td>
                    <Td>—</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-3 py-2 font-medium">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2">{children}</td>;
}
