export type HydrateOutcome = "ok" | "empty" | "failed";

export interface HydrateReport {
  sources: Record<string, HydrateOutcome>;
  failed: string[];
  ok: string[];
  empty: string[];
}

/** Classify a list endpoint: null/undefined response is a failure, not an empty list. */
export function classifyHydrateList(
  response: unknown,
  items: unknown[] | null | undefined,
): HydrateOutcome {
  if (response == null) return "failed";
  if (!items || items.length === 0) return "empty";
  return "ok";
}

/**
 * Per-run GET /api/allocation-runs/:id/results.
 * A miss (null body) is not an empty assignment list — empty `results: []`
 * is the authoritative infeasible / no-slot persist.
 */
export function allocationRunResultsFromFetch<T>(
  response: { results?: T[] | null } | null | undefined,
): { missed: true } | { missed: false; results: T[] } {
  if (response == null || !Array.isArray(response.results)) {
    return { missed: true };
  }
  return { missed: false, results: response.results };
}

/**
 * Per-run GET /api/allocation-runs/:id/reasons.
 * A miss (null body) is not an empty reason list — empty `reasons: []`
 * is the authoritative persist with no decision/validator rows.
 */
export function allocationRunReasonsFromFetch<T>(
  response: { reasons?: T[] | null } | null | undefined,
): { missed: true } | { missed: false; reasons: T[] } {
  if (response == null || !Array.isArray(response.reasons)) {
    return { missed: true };
  }
  return { missed: false, reasons: response.reasons };
}

export function buildHydrateReport(
  sources: Record<string, HydrateOutcome>,
): HydrateReport {
  const failed: string[] = [];
  const ok: string[] = [];
  const empty: string[] = [];
  for (const [name, outcome] of Object.entries(sources)) {
    if (outcome === "failed") failed.push(name);
    else if (outcome === "ok") ok.push(name);
    else empty.push(name);
  }
  return { sources, failed, ok, empty };
}

export const EMPTY_HYDRATE_REPORT: HydrateReport = {
  sources: {},
  failed: [],
  ok: [],
  empty: [],
};

/**
 * D1 is authoritative when the list endpoint responded — including an empty
 * array. Keep the in-memory synthetic seed only when the source failed
 * (null/undefined body). Using demo teachers/history after a successful empty
 * GET would invent published duties and master rows the database does not have.
 */
export function pickAuthoritativeList<T>(
  outcome: HydrateOutcome,
  demoFallback: T[],
  apiMapped: T[],
): T[] {
  if (outcome === "failed") return demoFallback;
  return apiMapped;
}

/**
 * Generate may treat a catalog as empty only after GET returned a list.
 * A miss (or hydrate still in flight) is unavailable — not `[]`.
 */
export function catalogUsableForGenerate(
  hydrateReady: boolean,
  outcome: HydrateOutcome | undefined,
): boolean {
  return hydrateReady && (outcome === "ok" || outcome === "empty");
}

export interface GenerateCatalogGate {
  outcome: HydrateOutcome | undefined;
  failed: string;
  loading: string;
}

/** First catalog still in flight or missed — generate button label. */
export function firstUnusableGenerateCatalogLabel(
  hydrateReady: boolean,
  gates: ReadonlyArray<GenerateCatalogGate>,
): string | null {
  for (const gate of gates) {
    if (catalogUsableForGenerate(hydrateReady, gate.outcome)) continue;
    return gate.outcome === "failed" ? gate.failed : gate.loading;
  }
  return null;
}

/** Display label for the cycle's stored rule_version_id (does not write OQ-021). */
export function labelForRuleVersion(
  versions: Array<{ rule_version_id?: string; version_label?: string }>,
  ruleVersionId: string,
  fallback: string,
): string {
  const match = versions.find((v) => v.rule_version_id === ruleVersionId);
  const label = match?.version_label;
  return typeof label === "string" && label.length > 0 ? label : fallback;
}
