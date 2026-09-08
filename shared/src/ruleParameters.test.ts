import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS } from "./types.js";
import { applyStoredRuleParameters } from "./ruleParameters.js";

const seedRows = [
  { param_key: "maximum_distance_km", param_value: "10", value_type: "number" },
  {
    param_key: "distance_policy",
    param_value: '"HOME_OR_SCHOOL"',
    value_type: "string",
  },
  { param_key: "repeat_years", param_value: "2", value_type: "number" },
  { param_key: "students_per_hall", param_value: "20", value_type: "number" },
  { param_key: "standby_percentage", param_value: "10", value_type: "number" },
  { param_key: "practical_batch_size", param_value: "50", value_type: "number" },
  {
    param_key: "practical_completion_days",
    param_value: "3",
    value_type: "number",
  },
  { param_key: "fairness_window_days", param_value: "365", value_type: "number" },
  { param_key: "seniority_mode", param_value: '"district"', value_type: "string" },
  {
    param_key: "block_priority_mode",
    param_value: '"none"',
    value_type: "string",
  },
  {
    param_key: "designation_priority_order",
    param_value: '["HM","PRINCIPAL","SENIOR_PG","PG"]',
    value_type: "json",
  },
  {
    param_key: "hm_fallback_designations",
    param_value: '["SENIOR_PG"]',
    value_type: "json",
  },
  {
    param_key: "chief_preferred_designations",
    param_value: '["PRINCIPAL","HM"]',
    value_type: "json",
  },
  {
    param_key: "chief_fallback_designations",
    param_value: '["SENIOR_PG"]',
    value_type: "json",
  },
  {
    param_key: "scoring_weights",
    param_value:
      '{"recent_duty":5,"repeated_duty":3,"distance":1,"workload":2,"role_balance":1}',
    value_type: "json",
  },
  { param_key: "role_switch_mode", param_value: '"soft"', value_type: "string" },
  {
    param_key: "hall_designation_allowlist",
    param_value: "[]",
    value_type: "json",
  },
  {
    param_key: "missing_coordinates_policy",
    param_value: '"INELIGIBLE"',
    value_type: "string",
  },
];

describe("applyStoredRuleParameters", () => {
  it("rehydrates the seed rows onto the documented defaults", () => {
    const out = applyStoredRuleParameters(seedRows);
    expect(out.parameters).toEqual(DEFAULT_RULE_PARAMETERS);
    expect(out.applied).toHaveLength(seedRows.length);
    expect(out.ignored).toEqual([]);
    expect(out.invalid).toEqual([]);
  });

  it("applies a stored override without inventing other keys", () => {
    const out = applyStoredRuleParameters([
      {
        param_key: "maximum_distance_km",
        param_value: "8",
        value_type: "number",
      },
    ]);
    expect(out.parameters.maximum_distance_km).toBe(8);
    expect(out.parameters.repeat_years).toBe(
      DEFAULT_RULE_PARAMETERS.repeat_years,
    );
    expect(out.applied).toEqual(["maximum_distance_km"]);
  });

  it("ignores unknown keys and keeps defaults for invalid values", () => {
    const out = applyStoredRuleParameters([
      {
        param_key: "invented_constraint",
        param_value: "true",
        value_type: "boolean",
      },
      {
        param_key: "distance_policy",
        param_value: '"WALK_ONLY"',
        value_type: "string",
      },
      {
        param_key: "scoring_weights",
        param_value: '{"recent_duty":1}',
        value_type: "json",
      },
    ]);
    expect(out.ignored).toEqual(["invented_constraint"]);
    expect(out.invalid).toEqual(["distance_policy", "scoring_weights"]);
    expect(out.parameters).toEqual(DEFAULT_RULE_PARAMETERS);
  });
});
