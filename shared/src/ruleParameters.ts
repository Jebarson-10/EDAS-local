import {
  DEFAULT_RULE_PARAMETERS,
  type RuleParameters,
  type ScoringWeights,
} from "./types.js";

export interface StoredRuleParameterRow {
  param_key: string;
  param_value: string;
  value_type: string;
}

export interface AppliedRuleParameters {
  parameters: RuleParameters;
  applied: string[];
  ignored: string[];
  invalid: string[];
}

const DISTANCE_POLICIES: RuleParameters["distance_policy"][] = [
  "HOME_OR_SCHOOL",
  "HOME_ONLY",
  "SCHOOL_ONLY",
];
const SENIORITY_MODES: RuleParameters["seniority_mode"][] = [
  "district",
  "block",
  "school",
];
const ROLE_SWITCH_MODES: RuleParameters["role_switch_mode"][] = ["soft", "hard"];
const MISSING_COORD_POLICIES: RuleParameters["missing_coordinates_policy"][] = [
  "INELIGIBLE",
  "WARN",
];
const SCORING_KEYS: (keyof ScoringWeights)[] = [
  "recent_duty",
  "repeated_duty",
  "distance",
  "workload",
  "role_balance",
];

function parseStoredValue(value: string, valueType: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    if (valueType === "number") {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    if (valueType === "boolean") {
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
      return undefined;
    }
    if (valueType === "string") return value;
    return undefined;
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isScoringWeights(v: unknown): v is ScoringWeights {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return SCORING_KEYS.every((k) => typeof o[k] === "number");
}

/**
 * Overlay D1 `rule_parameters` onto a known RuleParameters shape.
 * Unknown keys are ignored (never interpreted). Invalid values keep the
 * base — typically the documented seed defaults — instead of inventing a rule.
 */
export function applyStoredRuleParameters(
  rows: StoredRuleParameterRow[],
  base: RuleParameters = DEFAULT_RULE_PARAMETERS,
): AppliedRuleParameters {
  const next: RuleParameters = { ...base, scoring_weights: { ...base.scoring_weights } };
  const applied: string[] = [];
  const ignored: string[] = [];
  const invalid: string[] = [];

  for (const row of rows) {
    const key = row.param_key;
    if (!(key in DEFAULT_RULE_PARAMETERS)) {
      ignored.push(key);
      continue;
    }
    const parsed = parseStoredValue(row.param_value, row.value_type);
    if (parsed === undefined) {
      invalid.push(key);
      continue;
    }

    let ok = false;
    switch (key) {
      case "maximum_distance_km":
      case "repeat_years":
      case "students_per_hall":
      case "standby_percentage":
      case "practical_batch_size":
      case "practical_completion_days":
      case "fairness_window_days":
        if (typeof parsed === "number" && Number.isFinite(parsed)) {
          next[key] = parsed;
          ok = true;
        }
        break;
      case "distance_policy":
        if (
          typeof parsed === "string" &&
          (DISTANCE_POLICIES as string[]).includes(parsed)
        ) {
          next.distance_policy = parsed as RuleParameters["distance_policy"];
          ok = true;
        }
        break;
      case "seniority_mode":
        if (
          typeof parsed === "string" &&
          (SENIORITY_MODES as string[]).includes(parsed)
        ) {
          next.seniority_mode = parsed as RuleParameters["seniority_mode"];
          ok = true;
        }
        break;
      case "role_switch_mode":
        if (
          typeof parsed === "string" &&
          (ROLE_SWITCH_MODES as string[]).includes(parsed)
        ) {
          next.role_switch_mode = parsed as RuleParameters["role_switch_mode"];
          ok = true;
        }
        break;
      case "missing_coordinates_policy":
        if (
          typeof parsed === "string" &&
          (MISSING_COORD_POLICIES as string[]).includes(parsed)
        ) {
          next.missing_coordinates_policy =
            parsed as RuleParameters["missing_coordinates_policy"];
          ok = true;
        }
        break;
      case "block_priority_mode":
        if (typeof parsed === "string") {
          next.block_priority_mode = parsed;
          ok = true;
        }
        break;
      case "designation_priority_order":
      case "hm_fallback_designations":
      case "chief_preferred_designations":
      case "chief_fallback_designations":
      case "hall_designation_allowlist":
        if (isStringArray(parsed)) {
          next[key] = parsed;
          ok = true;
        }
        break;
      case "scoring_weights":
        if (isScoringWeights(parsed)) {
          next.scoring_weights = parsed;
          ok = true;
        }
        break;
      default:
        ignored.push(key);
        continue;
    }

    if (ok) applied.push(key);
    else invalid.push(key);
  }

  return { parameters: next, applied, ignored, invalid };
}
