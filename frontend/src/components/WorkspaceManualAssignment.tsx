import { useEffect, useState } from "react";
import type { WorkspaceRun } from "@exam-duty/shared";
import { workspaceRoleLabel } from "../lib/workspaceFiles";

interface Candidate { staffId: string; name: string; post: string; school: string; distanceKm: number; distanceException: boolean }
interface Choice { shortageKey: string; staffId: string; reason: string; distanceException: boolean }
const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
export function WorkspaceManualAssignment({ run, busy, candidates, assign }: {
  run: WorkspaceRun; busy: boolean;
  candidates: (key: string) => Promise<Candidate[]>;
  assign: (choice: Choice) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [people, setPeople] = useState<Candidate[]>([]);
  const [staffId, setStaffId] = useState("");
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [exception, setException] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setKey(""); setPeople([]); setReason(""); setError(""); }, [run.id]);
  useEffect(() => {
    setPeople([]); setStaffId(""); setException(false); setError("");
    if (!key) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void candidates(key).then((rows) => { if (!cancelled) setPeople(rows); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load available staff."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // Request callback is recreated by the parent. Only reload for a different saved list or post.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, run.id]);
  if (run.module !== "THEORY" || !run.shortages.length) return null;
  const person = people.find((p) => p.staffId === staffId);
  return <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm" aria-label="Fill unfilled posts">
    <h2 className="text-lg font-semibold text-[#183B4C]">Fill unfilled posts</h2>
    <p className="my-2 text-sm text-slate-600">Choose from staff free for every required date and session. The app checks posts, subjects and previous duties. A person beyond 10 km needs your approval and a reason. Your change is saved as a new list.</p>
    <label className="block text-sm">Unfilled post<select aria-label="Unfilled post" className={field} value={key} disabled={busy} onChange={(e) => setKey(e.target.value)}>
      <option value="">Choose an unfilled post</option>{run.shortages.map((s) => <option key={s.key} value={s.key} disabled={!s.vacancy?.length}>{s.target} — {workspaceRoleLabel(s.role)} — {s.date}{!s.vacancy?.length ? " (generate a new list first)" : ""}</option>)}
    </select></label>
    {loading && <p role="status" className="mt-2 text-sm">Checking available staff...</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {key && !loading && !error && <div className="mt-3 space-y-3">
      <p className="text-sm">{people.length} eligible staff available. Staff already on duty in these sessions are excluded.</p>
      <input className={field} aria-label="Search available staff" placeholder="Search staff name, post or school" value={search} onChange={(e) => setSearch(e.target.value)} />
      <label className="block text-sm">Available staff<select aria-label="Available staff" className={field} value={staffId} onChange={(e) => { setStaffId(e.target.value); setException(false); }}>
        <option value="">Choose staff</option>{people.filter((p) => `${p.name} ${p.post} ${p.school} ${p.staffId}`.toLowerCase().includes(search.toLowerCase())).map((p) => <option key={p.staffId} value={p.staffId}>{p.name} — {p.post} — {p.school} — {p.distanceKm.toFixed(1)} km{p.distanceException ? " (distance exception)" : ""}</option>)}
      </select></label>
      {person?.distanceException && <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm"><input type="checkbox" checked={exception} onChange={(e) => setException(e.target.checked)} />I approve this distance exception ({person.distanceKm.toFixed(1)} km, including all route stops where relevant).</label>}
      <label className="block text-sm">Reason for manual assignment<textarea className={field} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} placeholder="Why you selected this staff member" /></label>
      <button className="rounded-lg bg-[#183B4C] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !person || reason.trim().length < 3 || (person.distanceException && !exception)} onClick={() => void assign({ shortageKey: key, staffId, reason, distanceException: exception })}>Assign staff and save a new list</button>
    </div>}
  </section>;
}
