import type { PersistedDecisionReasonRow } from "./persistedConflicts.js";

export interface HydratedTheoryShortage {
  requirementKey: string;
  required: number;
  eligible: number;
  shortage: number;
  exclusionTallies: Record<string, number>;
  message: string;
  hmRequirementMeta?: {
    preferredEligible: number;
    fallbackRequired: number;
    fallbackDesignations: string[];
  };
}

export interface HydratedHallShortage {
  centreId: string;
  required: number;
  eligible: number;
  shortage: number;
  message: string;
}

export interface HydratedValidationIssue {
  ruleCode: string;
  severity: "ERROR" | "WARNING" | "INFO";
  message: string;
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function exclusionTalliesFrom(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isFinite(count)) out[key] = count;
  }
  return out;
}

function hmMetaFrom(
  value: unknown,
): HydratedTheoryShortage["hmRequirementMeta"] {
  if (!isRecord(value)) return undefined;
  const preferredEligible = asFiniteNumber(value.preferredEligible);
  const fallbackRequired = asFiniteNumber(value.fallbackRequired);
  if (preferredEligible === null || fallbackRequired === null) return undefined;
  const fallbackDesignations = Array.isArray(value.fallbackDesignations)
    ? value.fallbackDesignations.filter((d): d is string => typeof d === "string")
    : [];
  return { preferredEligible, fallbackRequired, fallbackDesignations };
}

function theoryShortageFromRecord(
  rec: Record<string, unknown>,
): HydratedTheoryShortage | null {
  const requirementKey = asNonEmptyString(rec.requirementKey);
  const required = asFiniteNumber(rec.required);
  const eligible = asFiniteNumber(rec.eligible);
  const shortage = asFiniteNumber(rec.shortage ?? rec.unfilled);
  const message = asNonEmptyString(rec.message);
  if (
    !requirementKey ||
    required === null ||
    eligible === null ||
    shortage === null ||
    !message
  ) {
    return null;
  }
  const hmRequirementMeta = hmMetaFrom(rec.hmRequirementMeta);
  return {
    requirementKey,
    required,
    eligible,
    shortage,
    exclusionTallies: exclusionTalliesFrom(rec.exclusionTallies),
    message,
    ...(hmRequirementMeta ? { hmRequirementMeta } : {}),
  };
}

function hallShortageFromRecord(
  rec: Record<string, unknown>,
): HydratedHallShortage | null {
  const centreId = asNonEmptyString(rec.centreId);
  const required = asFiniteNumber(rec.required);
  const eligible = asFiniteNumber(rec.eligible);
  const shortage = asFiniteNumber(rec.shortage ?? rec.unfilled);
  const message = asNonEmptyString(rec.message);
  if (
    !centreId ||
    required === null ||
    eligible === null ||
    shortage === null ||
    !message
  ) {
    return null;
  }
  return { centreId, required, eligible, shortage, message };
}

function shortageArrayFromSummary(summaryJson: string | null | undefined): unknown[] | null {
  const parsed = parseJson(summaryJson);
  if (!isRecord(parsed)) return null;
  if (Array.isArray(parsed.shortages)) return parsed.shortages;
  if (Array.isArray(parsed.shortageDetails)) return parsed.shortageDetails;
  return null;
}

/**
 * Reconstruct theory shortage rows already stored on summary_json.
 * A numeric `shortages` count is not enough — do not invent required/eligible.
 */
export function theoryShortagesFromPersistedSummary(
  summaryJson: string | null | undefined,
): HydratedTheoryShortage[] {
  const raw = shortageArrayFromSummary(summaryJson);
  if (!raw) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];
    const shortage = theoryShortageFromRecord(item);
    return shortage ? [shortage] : [];
  });
}

/**
 * Reconstruct theory shortages from RULE-SHORTAGE details already persisted.
 * Skips rows whose details lack required/eligible/shortage/requirementKey.
 */
export function theoryShortagesFromPersistedReasons(
  reasons: PersistedDecisionReasonRow[],
): HydratedTheoryShortage[] {
  const out: HydratedTheoryShortage[] = [];
  for (const r of reasons) {
    if (r.rule_code !== "RULE-SHORTAGE") continue;
    const details = parseJson(r.details_json);
    const rec = isRecord(details) ? details : {};
    const shortage = theoryShortageFromRecord({
      requirementKey: rec.requirementKey ?? rec.duty,
      required: rec.required,
      eligible: rec.eligible,
      shortage: rec.shortage ?? rec.unfilled,
      exclusionTallies: rec.exclusionTallies,
      hmRequirementMeta: rec.hmRequirementMeta,
      message: r.message,
    });
    if (shortage) out.push(shortage);
  }
  return out;
}

export function theoryShortagesFromPersisted(
  summaryJson: string | null | undefined,
  reasons: PersistedDecisionReasonRow[] = [],
): HydratedTheoryShortage[] {
  const fromSummary = theoryShortagesFromPersistedSummary(summaryJson);
  if (fromSummary.length > 0) return fromSummary;
  return theoryShortagesFromPersistedReasons(reasons);
}

export function hallShortagesFromPersistedSummary(
  summaryJson: string | null | undefined,
): HydratedHallShortage[] {
  const raw = shortageArrayFromSummary(summaryJson);
  if (!raw) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];
    const shortage = hallShortageFromRecord(item);
    return shortage ? [shortage] : [];
  });
}

export function hallShortagesFromPersistedReasons(
  reasons: PersistedDecisionReasonRow[],
): HydratedHallShortage[] {
  const out: HydratedHallShortage[] = [];
  for (const r of reasons) {
    if (r.rule_code !== "RULE-HALL-SHORTAGE") continue;
    const details = parseJson(r.details_json);
    const rec = isRecord(details) ? details : {};
    const shortage = hallShortageFromRecord({
      centreId: rec.centreId,
      required: rec.required,
      eligible: rec.eligible,
      shortage: rec.shortage ?? rec.unfilled,
      message: r.message,
    });
    if (shortage) out.push(shortage);
  }
  return out;
}

export function hallShortagesFromPersisted(
  summaryJson: string | null | undefined,
  reasons: PersistedDecisionReasonRow[] = [],
): HydratedHallShortage[] {
  const fromSummary = hallShortagesFromPersistedSummary(summaryJson);
  if (fromSummary.length > 0) return fromSummary;
  return hallShortagesFromPersistedReasons(reasons);
}

/**
 * Validation page Valid stat. Persist already computed the count; a missing
 * field must not be invented from assignment length (same class as Errors: 0).
 */
export function validCountFromPersistedSummary(
  summaryJson: string | null | undefined,
): number | undefined {
  const parsed = parseJson(summaryJson);
  if (!isRecord(parsed)) return undefined;
  const valid = asFiniteNumber(parsed.valid);
  if (valid === null || valid < 0) return undefined;
  return Math.floor(valid);
}

/** ERROR/WARNING rows already stored — do not invent counts from assignment length. */
export function issuesFromPersistedReasons(
  reasons: PersistedDecisionReasonRow[],
): HydratedValidationIssue[] {
  const out: HydratedValidationIssue[] = [];
  for (const r of reasons) {
    if (r.severity !== "ERROR" && r.severity !== "WARNING") continue;
    out.push({
      ruleCode: r.rule_code,
      severity: r.severity,
      message: r.message,
    });
  }
  return out;
}

/**
 * Reconstruct Validation issues already stored on summary_json.
 * A numeric `errors` count is not enough — do not invent rule/message rows.
 */
export function issuesFromPersistedSummary(
  summaryJson: string | null | undefined,
): HydratedValidationIssue[] {
  const parsed = parseJson(summaryJson);
  if (!isRecord(parsed) || !Array.isArray(parsed.issues)) return [];
  const out: HydratedValidationIssue[] = [];
  for (const item of parsed.issues) {
    if (!isRecord(item)) continue;
    const ruleCode = asNonEmptyString(item.ruleCode);
    const message = asNonEmptyString(item.message);
    const severity = item.severity;
    if (!ruleCode || !message) continue;
    if (severity !== "ERROR" && severity !== "WARNING") continue;
    out.push({ ruleCode, severity, message });
  }
  return out;
}

export function issuesFromPersisted(
  summaryJson: string | null | undefined,
  reasons: PersistedDecisionReasonRow[] = [],
): HydratedValidationIssue[] {
  const fromSummary = issuesFromPersistedSummary(summaryJson);
  if (fromSummary.length > 0) return fromSummary;
  return issuesFromPersistedReasons(reasons);
}
