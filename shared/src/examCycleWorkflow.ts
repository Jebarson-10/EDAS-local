import type { ExamCycleStatus } from "./types.js";

export const EXAM_CYCLE_TRANSITIONS: Record<
  ExamCycleStatus,
  ExamCycleStatus[]
> = {
  DRAFT: ["OPEN"],
  OPEN: ["ALLOCATION_GENERATED", "DRAFT"],
  ALLOCATION_GENERATED: ["UNDER_REVIEW", "OPEN"],
  UNDER_REVIEW: ["APPROVED", "ALLOCATION_GENERATED"],
  APPROVED: ["PUBLISHED"],
  PUBLISHED: ["LOCKED"],
  LOCKED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(
  from: ExamCycleStatus,
  to: ExamCycleStatus,
): boolean {
  return EXAM_CYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Published and locked allocations must not be edited in place. */
export function isFrozenExamCycleStatus(status: unknown): boolean {
  return status === "PUBLISHED" || status === "LOCKED" || status === "ARCHIVED";
}

export function isAllocationImmutable(status: ExamCycleStatus): boolean {
  return isFrozenExamCycleStatus(status);
}

/**
 * Session exam cycle after a full reload. Empty/missing list → undefined so
 * the caller keeps INITIAL_CYCLE (first-boot). When D1 has leftover published
 * `ec_2027_hsc` plus a DRAFT/OPEN amendment, prefer the mutable row —
 * generate/publish must not run on the frozen parent. Newest mutable wins
 * (GET is created_at DESC). No picker.
 */
export function pickHydrateExamCycle<
  T extends { exam_cycle_id?: unknown; status?: unknown },
>(cycles: T[] | null | undefined, leftoverId: string): T | undefined {
  if (!cycles?.length) return undefined;
  const mutable = cycles.filter((c) => !isFrozenExamCycleStatus(c.status));
  if (mutable[0]) return mutable[0];
  return (
    cycles.find((c) => String(c.exam_cycle_id ?? "") === leftoverId) ??
    cycles[0]
  );
}

export function assertMutable(
  status: ExamCycleStatus,
  action: string,
): { ok: true } | { ok: false; error: string; conflict: true } {
  if (isAllocationImmutable(status)) {
    return {
      ok: false,
      conflict: true,
      error: `Cannot ${action} while exam cycle is ${status}. Create an amendment / new version instead.`,
    };
  }
  return { ok: true };
}

/** HTTP 409 when a mutator hit a frozen cycle / published run; otherwise 400. */
export function mutationConflictStatus(result: {
  error: string;
  conflict?: boolean;
}): 409 | 400 {
  return result.conflict === true ? 409 : 400;
}

/**
 * Session mutations wait for the API when it is reachable.
 * Offline (null / throw) may apply locally; any reached non-OK body must not.
 */
export function shouldApplySessionAfterApi(api: {
  ok?: boolean;
  accepted?: boolean;
  error?: string;
} | null): { apply: true; offline: boolean } | { apply: false; error: string } {
  if (api == null) return { apply: true, offline: true };
  if (api.ok === true || api.accepted === true) {
    return { apply: true, offline: false };
  }
  return { apply: false, error: api.error ?? "Request refused by API" };
}

/**
 * Multi-call writes (publish theory + practical + hall) wait for every
 * reached body. A mix of OK + reject / timeout must not apply the full
 * session publish as if every module landed.
 */
export function shouldApplySessionAfterApis(
  apis: Array<{
    ok?: boolean;
    accepted?: boolean;
    error?: string;
  } | null>,
): { apply: true; offline: boolean } | { apply: false; error: string } {
  if (apis.length === 0) return { apply: true, offline: true };
  const reached = apis.filter((api) => api != null);
  if (reached.length === 0) return { apply: true, offline: true };
  if (reached.length !== apis.length) {
    return {
      apply: false,
      error:
        "API reachable but a write call did not return — refuse local apply",
    };
  }
  for (const api of reached) {
    const one = shouldApplySessionAfterApi(api);
    if (!one.apply) return one;
  }
  return { apply: true, offline: false };
}

export interface AmendmentResult {
  previousCycleId: string;
  newCycleId: string;
  newStatus: ExamCycleStatus;
  reason: string;
}

/**
 * Correction path for published allocations: new versioned cycle/amendment,
 * previous remains immutable historical input.
 */
export function createAmendmentDescriptor(
  previousCycleId: string,
  newCycleId: string,
  reason: string,
): AmendmentResult {
  if (!reason.trim()) {
    throw new Error("Amendment reason is required");
  }
  return {
    previousCycleId,
    newCycleId,
    newStatus: "DRAFT",
    reason: reason.trim(),
  };
}
