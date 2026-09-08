import { describe, expect, it } from "vitest";
import {
  hallShortagesFromPersisted,
  issuesFromPersisted,
  issuesFromPersistedReasons,
  theoryShortagesFromPersisted,
  validCountFromPersistedSummary,
} from "./persistedShortages.js";

describe("theoryShortagesFromPersisted", () => {
  it("reads shortage objects from summary_json instead of inventing empty", () => {
    const shortages = theoryShortagesFromPersisted(
      JSON.stringify({
        assignments: 1,
        shortageCount: 1,
        feasible: false,
        shortages: [
          {
            requirementKey: "c1-CHIEF",
            required: 1,
            eligible: 0,
            shortage: 1,
            exclusionTallies: { OWN_SCHOOL: 2 },
            message: "NO FEASIBLE ALLOCATION",
            hmRequirementMeta: {
              preferredEligible: 0,
              fallbackRequired: 1,
              fallbackDesignations: ["PG"],
            },
          },
        ],
      }),
    );
    expect(shortages).toHaveLength(1);
    expect(shortages[0]).toEqual({
      requirementKey: "c1-CHIEF",
      required: 1,
      eligible: 0,
      shortage: 1,
      exclusionTallies: { OWN_SCHOOL: 2 },
      message: "NO FEASIBLE ALLOCATION",
      hmRequirementMeta: {
        preferredEligible: 0,
        fallbackRequired: 1,
        fallbackDesignations: ["PG"],
      },
    });
  });

  it("does not invent objects from a numeric shortages count", () => {
    expect(
      theoryShortagesFromPersisted(
        JSON.stringify({ assignments: 2, shortages: 1, feasible: false }),
      ),
    ).toEqual([]);
  });

  it("does not invent required/eligible when those fields are missing", () => {
    expect(
      theoryShortagesFromPersisted(
        JSON.stringify({
          shortages: [
            { requirementKey: "c1-CHIEF", message: "NO FEASIBLE ALLOCATION" },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("falls back to RULE-SHORTAGE details already persisted on reasons", () => {
    const shortages = theoryShortagesFromPersisted(
      JSON.stringify({ shortages: 1, feasible: false }),
      [
        {
          rule_code: "RULE-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
          details_json: JSON.stringify({
            requirementKey: "c2-CHIEF",
            required: 1,
            eligible: 3,
            shortage: 1,
          }),
        },
        {
          rule_code: "RULE-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION — centre not found",
        },
      ],
    );
    expect(shortages).toEqual([
      {
        requirementKey: "c2-CHIEF",
        required: 1,
        eligible: 3,
        shortage: 1,
        exclusionTallies: {},
        message: "NO FEASIBLE ALLOCATION",
      },
    ]);
  });
});

describe("hallShortagesFromPersisted", () => {
  it("reads hall shortage objects from summary_json", () => {
    expect(
      hallShortagesFromPersisted(
        JSON.stringify({
          shortages: [
            {
              centreId: "c1",
              required: 11,
              eligible: 3,
              shortage: 8,
              message: "NO FEASIBLE ALLOCATION",
            },
          ],
        }),
      ),
    ).toEqual([
      {
        centreId: "c1",
        required: 11,
        eligible: 3,
        shortage: 8,
        message: "NO FEASIBLE ALLOCATION",
      },
    ]);
  });

  it("does not invent hall objects from a count", () => {
    expect(
      hallShortagesFromPersisted(JSON.stringify({ shortages: 2, feasible: false })),
    ).toEqual([]);
  });
});

describe("validCountFromPersistedSummary", () => {
  it("reads persisted valid instead of inventing assignment length", () => {
    expect(
      validCountFromPersistedSummary(
        JSON.stringify({ assignments: 8, valid: 5, feasible: false }),
      ),
    ).toBe(5);
  });

  it("does not invent valid from assignment count or error count", () => {
    expect(
      validCountFromPersistedSummary(
        JSON.stringify({ assignments: 8, shortageCount: 2, feasible: false }),
      ),
    ).toBeUndefined();
    expect(validCountFromPersistedSummary(JSON.stringify({ errors: 3 }))).toBe(
      undefined,
    );
  });
});

describe("issuesFromPersisted", () => {
  it("reads issue objects from summary_json instead of inventing from errors", () => {
    expect(
      issuesFromPersisted(
        JSON.stringify({
          errors: 1,
          feasible: false,
          issues: [
            {
              ruleCode: "RULE-PRACTICAL-INFEASIBLE",
              severity: "ERROR",
              message: "NO VALID SCHEDULE — no available dates",
            },
            {
              ruleCode: "INFO-SELECTED",
              severity: "INFO",
              message: "Selected",
            },
          ],
        }),
      ),
    ).toEqual([
      {
        ruleCode: "RULE-PRACTICAL-INFEASIBLE",
        severity: "ERROR",
        message: "NO VALID SCHEDULE — no available dates",
      },
    ]);
  });

  it("does not invent issue rows from an errors count", () => {
    expect(
      issuesFromPersisted(JSON.stringify({ errors: 3, warnings: 1, feasible: false })),
    ).toEqual([]);
  });

  it("falls back to persisted reasons when summary has no issues array", () => {
    expect(
      issuesFromPersisted(JSON.stringify({ errors: 1 }), [
        {
          rule_code: "RULE-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
        },
      ]),
    ).toEqual([
      {
        ruleCode: "RULE-SHORTAGE",
        severity: "ERROR",
        message: "NO FEASIBLE ALLOCATION",
      },
    ]);
  });
});

describe("issuesFromPersistedReasons", () => {
  it("surfaces persisted ERROR/WARNING rows and skips INFO", () => {
    expect(
      issuesFromPersistedReasons([
        {
          rule_code: "INFO-SELECTED",
          severity: "INFO",
          message: "Selected",
        },
        {
          rule_code: "RULE-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
        },
        {
          rule_code: "INFO-HM-FALLBACK",
          severity: "WARNING",
          message: "Preferred band shortage",
        },
      ]),
    ).toEqual([
      {
        ruleCode: "RULE-SHORTAGE",
        severity: "ERROR",
        message: "NO FEASIBLE ALLOCATION",
      },
      {
        ruleCode: "INFO-HM-FALLBACK",
        severity: "WARNING",
        message: "Preferred band shortage",
      },
    ]);
  });
});
