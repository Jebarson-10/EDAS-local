import { useEffect, useState } from "react";
import { assertMutable, calculateCustodianRequirementCount } from "@exam-duty/shared";
import { custodianPlanApi, type CustodianPoint } from "../lib/api";
import { useApp } from "../state/AppContext";
import { Panel } from "./ui";

export function CustodianSetup({onChange}: {onChange: (state: {rows: CustodianPoint[]; ready: boolean}) => void}) {
  const {dataset, examCycle, role, rules} = useApp();
  const [rows, setRows] = useState<CustodianPoint[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setReady(false); onChange({rows: [], ready: false});
    custodianPlanApi(role, examCycle.examCycleId).then(saved => {
      if (!active) return;
      setRows(saved); setReady(true); setMessage(""); onChange({rows: saved, ready: true});
    }).catch(e => { if (active) setMessage(String(e)); });
    return () => { active = false; };
  }, [role, examCycle.examCycleId, onChange, retry]);
  if (!dataset) return null;
  const schools = dataset.schools.filter(s => s.active);
  const mutable = assertMutable(examCycle.status, "save custodian points").ok;
  function edit(next: CustodianPoint[]) { setRows(next); onChange({rows: next, ready: false}); }
  async function save() {
    setBusy(true);
    try {
      const saved = await custodianPlanApi(role, examCycle.examCycleId, {rows, reason});
      setRows(saved); onChange({rows: saved, ready: true}); setMessage("Custodian points saved."); setReason("");
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const covered = new Set(rows.flatMap(r => r.schoolIds));
  return <Panel title="Custodian points">
    <p className="text-sm mb-3">Choose the centres where custodians will work and the schools each point serves. Only PG and BT Assistants are eligible. The starting count is one for every {rules.custodian_schools_per_custodian} schools; you can change it with a reason.</p>
    <p className="text-sm mb-3">{covered.size} of {schools.length} active schools covered. Only saved points will receive custodian duties, on the theory timetable dates. No points means no custodian allotment.</p>
    {!ready && <button type="button" onClick={() => setRetry(n => n + 1)}>Retry loading</button>}
    <fieldset disabled={!ready || !mutable || busy} className="space-y-3">
      {rows.map((row, index) => <div key={index} className="border rounded p-3 space-y-2">
        <label className="block">Duty location <select aria-label={`Custodian location ${index + 1}`} value={row.centreId} onChange={e => edit(rows.map((r, i) => i === index ? {...r, centreId: e.target.value} : r))}>
          <option value="">Choose a centre</option>{dataset.centres.filter(c => c.active).map(c => <option key={c.centreId} value={c.centreId}>{c.centreName}</option>)}
        </select></label>
        <details><summary>Schools served ({row.schoolIds.length})</summary><div className="max-h-48 overflow-auto">
          {schools.map(s => <label key={s.schoolId} className="block text-sm"><input type="checkbox" checked={row.schoolIds.includes(s.schoolId)} disabled={!row.schoolIds.includes(s.schoolId) && covered.has(s.schoolId)} onChange={e => {
            const ids = e.target.checked ? [...row.schoolIds, s.schoolId] : row.schoolIds.filter(id => id !== s.schoolId);
            edit(rows.map((r, i) => i === index ? {...r, schoolIds: ids, count: Math.max(1, calculateCustodianRequirementCount(ids.length, rules.custodian_schools_per_custodian))} : r));
          }}/>{s.schoolName}</label>)}
        </div></details>
        <label>Custodians needed <input type="number" min={1} max={1000} value={row.count} onChange={e => edit(rows.map((r, i) => i === index ? {...r, count: Number(e.target.value)} : r))}/></label>
        <button type="button" className="ml-3 underline" onClick={() => edit(rows.filter((_, i) => i !== index))}>Remove point</button>
      </div>)}
      <button type="button" className="border rounded px-3 py-2" onClick={() => edit([...rows, {centreId: "", schoolIds: [], count: 1}])}>Add custodian point</button>
      <label className="block">Reason for this setup or change <input className="border rounded ml-2" value={reason} onChange={e => setReason(e.target.value)}/></label>
      <button type="button" className="border rounded px-3 py-2" disabled={!reason.trim() || rows.some(r => !r.centreId || !r.schoolIds.length || !Number.isInteger(r.count) || r.count < 1)} onClick={() => void save()}>{busy ? "Saving…" : "Save custodian points"}</button>
    </fieldset>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </Panel>;
}
