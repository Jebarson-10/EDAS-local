import type { ExamWorkspace, WorkspaceAssignment, WorkspaceRun } from "@exam-duty/shared";
import { validateWorkspaceRun } from "./workspace.js";

export interface WorkspaceManualCandidate {
  staffId: string;
  name: string;
  post: string;
  school: string;
  distanceKm: number;
  distanceException: boolean;
}

/** A manual choice never bypasses qualification, history or availability checks. */
export function workspaceManualCandidates(
  w: ExamWorkspace,
  run: WorkspaceRun,
  shortageKey: string,
  other: WorkspaceAssignment[] = [],
): WorkspaceManualCandidate[] {
  const shortage = run.shortages.find((s) => s.key === shortageKey);
  if (run.module !== "THEORY" || !shortage?.vacancy?.length)
    throw new Error("Generate a new theory list first, then select an unfilled post.");
  const vacancies = shortage.vacancy;
  const a = vacancies[0]!;
  const assistant = run.standard === "10" ? "BT" : "PG";
  const hm = ["HM", "HM_HS", "HM_HSS", "PRINCIPAL"];
  const posts: Record<string, string[]> = {
    CHIEF: [...hm, assistant], DEPARTMENT: [assistant], ROUTE: [assistant],
    INVIGILATOR: [assistant], BACKUP: [assistant],
    JUNIOR_ASSISTANT: ["JA"], OFFICE_ASSISTANT: ["OA", "RC"],
    CUSTODIAN: run.standard === "10" ? hm : [w.settings.custodianPost12],
    SECONDARY_CUSTODIAN: run.standard === "10" ? ["BT"] : hm,
    LIAISON: hm, SECONDARY_LIAISON: [assistant],
    SQUAD: run.standard === "10" ? ["BT"] : ["PD1", "PD2", "VOCATIONAL", "PG"],
  };
  const schools = new Map(w.schools.map((s) => [s.udise, s]));
  const taken = new Set([...run.assignments, ...other].map((x) => `${x.staffId}|${x.date}|${x.session}`));
  const vocational = w.staff.filter((t) => t.post === "VOCATIONAL" && t.postDate)
    .sort((x, y) => x.postDate!.localeCompare(y.postDate!) || x.staffId.localeCompare(y.staffId, "en", { numeric: true })).slice(0, 4);
  const result: WorkspaceManualCandidate[] = [];
  for (const t of w.staff) {
    if (!posts[a.role]?.includes(t.post) || vacancies.some((x) => taken.has(`${t.staffId}|${x.date}|${x.session}`))) continue;
    if (t.post === "VOCATIONAL" && !vocational.some((v) => v.staffId === t.staffId)) continue;
    const assignments = vacancies.map((x) => ({ ...x, staffId: t.staffId }));
    // Only this person's assignment-level issues are relevant to a candidate.
    // The complete list is independently checked again before a change is saved.
    const keys = new Set(assignments.map((x) => `${x.key}: `));
    const checks = validateWorkspaceRun({ ...w, staff: [t, ...vocational.filter((v) => v.staffId !== t.staffId)] },
      { ...run, assignments }, other).filter((issue) => [...keys].some((key) => issue.startsWith(key)));
    if (checks.some((issue) => !issue.endsWith("Duty is outside the 10 km school radius."))) continue;
    const home = schools.get(t.udise)!;
    const targets = [a.centreUdise];
    if (a.role === "ROUTE") {
      const route = w.routes.find((r) => r.standard === run.standard && r.id === a.targetId);
      for (const code of route?.centreCodes ?? []) targets.push(w.centres.find((c) => c.standard === run.standard && c.code === code)!.udise);
    }
    let distanceKm = 0;
    for (const udise of targets) {
      const target = schools.get(udise)!;
      const r = Math.PI / 180;
      const d = Math.sin((target.latitude! - home.latitude!) * r / 2) ** 2
        + Math.cos(home.latitude! * r) * Math.cos(target.latitude! * r) * Math.sin((target.longitude! - home.longitude!) * r / 2) ** 2;
      distanceKm = Math.max(distanceKm, 12742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, d)))));
    }
    result.push({ staffId: t.staffId, name: t.name, post: t.originalPost || t.post,
      school: home.name, distanceKm, distanceException: checks.length > 0 });
  }
  return result.sort((x, y) => x.distanceKm - y.distanceKm || x.name.localeCompare(y.name) || x.staffId.localeCompare(y.staffId));
}

export function fillWorkspaceShortage(
  w: ExamWorkspace,
  run: WorkspaceRun,
  choice: { shortageKey: string; staffId: string; reason: string; distanceException: boolean },
  other: WorkspaceAssignment[] = [],
  identity = { id: crypto.randomUUID(), at: new Date().toISOString() },
): WorkspaceRun {
  if (run.errors.length) throw new Error("Resolve checking errors before assigning staff manually.");
  if (typeof choice.reason !== "string" || choice.reason.trim().length < 3 || choice.reason.length > 2000)
    throw new Error("Enter a short reason for this manual assignment (3–2000 characters).");
  const candidate = workspaceManualCandidates(w, run, choice.shortageKey, other).find((c) => c.staffId === choice.staffId);
  if (!candidate) throw new Error("This staff member is not eligible or is already on duty. Refresh the available list.");
  if (candidate.distanceException && choice.distanceException !== true)
    throw new Error("Approve the distance exception before selecting someone beyond 10 km.");
  const gap = run.shortages.find((s) => s.key === choice.shortageKey)!;
  const next: WorkspaceRun = { ...run, id: identity.id, createdAt: identity.at, published: false, parentRunId: run.id,
    shortages: run.shortages.filter((s) => s.key !== gap.key),
    assignments: [...run.assignments, ...gap.vacancy!.map((a) => ({ ...a, staffId: choice.staffId,
      manual: { parentRunId: run.id, reason: choice.reason.trim(), distanceException: candidate.distanceException,
        approvedAt: identity.at, policyVersion: "ERODE-MANUAL-2026-10-18" as const } }))] };
  const checks = validateWorkspaceRun(w, next, other);
  if (checks.length) throw new Error(`Manual assignment failed checks: ${checks.slice(0, 5).join("; ")}`);
  return next;
}
