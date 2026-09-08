import { describe, expect, it } from "vitest";
import {
  allocationRunReasonsFromFetch,
  allocationRunResultsFromFetch,
  buildHydrateReport,
  catalogUsableForGenerate,
  classifyHydrateList,
  firstUnusableGenerateCatalogLabel,
  labelForRuleVersion,
  pickAuthoritativeList,
} from "./hydrateReport.js";

describe("classifyHydrateList", () => {
  it("treats a missing response as failed, not empty", () => {
    expect(classifyHydrateList(null, [])).toBe("failed");
    expect(classifyHydrateList(undefined, undefined)).toBe("failed");
  });

  it("distinguishes an empty D1 list from a populated one", () => {
    expect(classifyHydrateList({ teachers: [] }, [])).toBe("empty");
    expect(classifyHydrateList({ teachers: [{ id: "t1" }] }, [{ id: "t1" }])).toBe(
      "ok",
    );
  });
});

describe("buildHydrateReport", () => {
  it("splits source outcomes for the banner", () => {
    const report = buildHydrateReport({
      teachers: "ok",
      schools: "empty",
      rule_parameters: "failed",
    });
    expect(report.failed).toEqual(["rule_parameters"]);
    expect(report.ok).toEqual(["teachers"]);
    expect(report.empty).toEqual(["schools"]);
  });
});

describe("pickAuthoritativeList", () => {
  const demoHistory = [
    { teacherId: "demo_t", dutyTypeCode: "CHIEF_EXAMINATION" },
  ];

  it("replaces demo rows when D1 returned an empty list", () => {
    expect(pickAuthoritativeList("empty", demoHistory, [])).toEqual([]);
  });

  it("uses mapped D1 rows when the list is populated", () => {
    const api = [{ teacherId: "d1_t", dutyTypeCode: "HALL_INVIGILATOR" }];
    expect(pickAuthoritativeList("ok", demoHistory, api)).toEqual(api);
  });

  it("keeps the synthetic seed only when the source failed", () => {
    expect(pickAuthoritativeList("failed", demoHistory, [])).toEqual(
      demoHistory,
    );
  });
});

describe("catalogUsableForGenerate", () => {
  it("refuses generate until the list GET returned ok or empty", () => {
    expect(catalogUsableForGenerate(false, undefined)).toBe(false);
    expect(catalogUsableForGenerate(false, "ok")).toBe(false);
    expect(catalogUsableForGenerate(true, undefined)).toBe(false);
    expect(catalogUsableForGenerate(true, "failed")).toBe(false);
    expect(catalogUsableForGenerate(true, "ok")).toBe(true);
    expect(catalogUsableForGenerate(true, "empty")).toBe(true);
  });

  it("treats a rule-parameters miss as unavailable, not a DEFAULT overlay", () => {
    expect(classifyHydrateList(null, [])).toBe("failed");
    expect(catalogUsableForGenerate(true, "failed")).toBe(false);
    expect(classifyHydrateList({ parameters: [] }, [])).toBe("empty");
    expect(catalogUsableForGenerate(true, "empty")).toBe(true);
  });

  it("treats exam-cycles / centres / relationships miss as unavailable, not seed overlay", () => {
    expect(classifyHydrateList(null, [])).toBe("failed");
    expect(catalogUsableForGenerate(true, "failed")).toBe(false);
    expect(classifyHydrateList({ cycles: [] }, [])).toBe("empty");
    expect(classifyHydrateList({ centres: [] }, [])).toBe("empty");
    expect(classifyHydrateList({ relationships: [] }, [])).toBe("empty");
    expect(catalogUsableForGenerate(true, "empty")).toBe(true);
    expect(
      firstUnusableGenerateCatalogLabel(true, [
        { outcome: "failed", failed: "Cycle unavailable", loading: "Loading cycle…" },
        { outcome: "ok", failed: "Centres unavailable", loading: "Loading centres…" },
      ]),
    ).toBe("Cycle unavailable");
    expect(
      firstUnusableGenerateCatalogLabel(true, [
        { outcome: "empty", failed: "Cycle unavailable", loading: "Loading cycle…" },
        { outcome: "ok", failed: "Centres unavailable", loading: "Loading centres…" },
      ]),
    ).toBeNull();
    expect(
      firstUnusableGenerateCatalogLabel(false, [
        { outcome: undefined, failed: "Cycle unavailable", loading: "Loading cycle…" },
      ]),
    ).toBe("Loading cycle…");
  });

  it("treats teachers / schools / duty-history miss as unavailable, not seed overlay", () => {
    expect(classifyHydrateList(null, [])).toBe("failed");
    expect(catalogUsableForGenerate(true, "failed")).toBe(false);
    expect(classifyHydrateList({ teachers: [] }, [])).toBe("empty");
    expect(classifyHydrateList({ schools: [] }, [])).toBe("empty");
    expect(classifyHydrateList({ history: [] }, [])).toBe("empty");
    expect(catalogUsableForGenerate(true, "empty")).toBe(true);
    expect(
      firstUnusableGenerateCatalogLabel(true, [
        {
          outcome: "failed",
          failed: "Teachers unavailable",
          loading: "Loading teachers…",
        },
        { outcome: "ok", failed: "Schools unavailable", loading: "Loading schools…" },
      ]),
    ).toBe("Teachers unavailable");
    expect(
      firstUnusableGenerateCatalogLabel(true, [
        {
          outcome: "empty",
          failed: "Teachers unavailable",
          loading: "Loading teachers…",
        },
        {
          outcome: "empty",
          failed: "Schools unavailable",
          loading: "Loading schools…",
        },
        {
          outcome: "empty",
          failed: "Duty history unavailable",
          loading: "Loading duty history…",
        },
      ]),
    ).toBeNull();
    expect(
      firstUnusableGenerateCatalogLabel(false, [
        {
          outcome: undefined,
          failed: "Teachers unavailable",
          loading: "Loading teachers…",
        },
      ]),
    ).toBe("Loading teachers…");
  });

  it("treats a per-run results GET miss as unavailable, not empty assignments", () => {
    expect(allocationRunResultsFromFetch(null)).toEqual({ missed: true });
    expect(allocationRunResultsFromFetch(undefined)).toEqual({ missed: true });
    expect(allocationRunResultsFromFetch({})).toEqual({ missed: true });
    expect(allocationRunResultsFromFetch({ results: null })).toEqual({
      missed: true,
    });
    expect(allocationRunResultsFromFetch({ results: [] })).toEqual({
      missed: false,
      results: [],
    });
    const rows = [{ teacher_id: "t1" }];
    expect(allocationRunResultsFromFetch({ results: rows })).toEqual({
      missed: false,
      results: rows,
    });
    expect(catalogUsableForGenerate(true, "failed")).toBe(false);
  });

  it("treats a per-run reasons GET miss as unavailable, not empty issues", () => {
    expect(allocationRunReasonsFromFetch(null)).toEqual({ missed: true });
    expect(allocationRunReasonsFromFetch(undefined)).toEqual({ missed: true });
    expect(allocationRunReasonsFromFetch({})).toEqual({ missed: true });
    expect(allocationRunReasonsFromFetch({ reasons: null })).toEqual({
      missed: true,
    });
    expect(allocationRunReasonsFromFetch({ reasons: [] })).toEqual({
      missed: false,
      reasons: [],
    });
    const rows = [{ rule_code: "RULE-CONFLICT-SESSION" }];
    expect(allocationRunReasonsFromFetch({ reasons: rows })).toEqual({
      missed: false,
      reasons: rows,
    });
    expect(catalogUsableForGenerate(true, "failed")).toBe(false);
  });

  it("treats allocation-runs miss as unavailable, not an empty calendar", () => {
    expect(classifyHydrateList(null, [])).toBe("failed");
    expect(catalogUsableForGenerate(true, "failed")).toBe(false);
    expect(classifyHydrateList({ runs: [] }, [])).toBe("empty");
    expect(catalogUsableForGenerate(true, "empty")).toBe(true);
    expect(
      firstUnusableGenerateCatalogLabel(true, [
        {
          outcome: "failed",
          failed: "Allocation runs unavailable",
          loading: "Loading allocation runs…",
        },
      ]),
    ).toBe("Allocation runs unavailable");
    expect(
      firstUnusableGenerateCatalogLabel(true, [
        {
          outcome: "empty",
          failed: "Allocation runs unavailable",
          loading: "Loading allocation runs…",
        },
      ]),
    ).toBeNull();
    expect(
      firstUnusableGenerateCatalogLabel(false, [
        {
          outcome: undefined,
          failed: "Allocation runs unavailable",
          loading: "Loading allocation runs…",
        },
      ]),
    ).toBe("Loading allocation runs…");
  });
});

describe("labelForRuleVersion", () => {
  it("uses the stored version label for the cycle's rule_version_id", () => {
    expect(
      labelForRuleVersion(
        [
          { rule_version_id: "rv-2027-1", version_label: "2027.1" },
          { rule_version_id: "rv_restore_1", version_label: "restore.1" },
        ],
        "rv_restore_1",
        "2027.1",
      ),
    ).toBe("restore.1");
  });

  it("keeps the fallback when the version list missed that id", () => {
    expect(labelForRuleVersion([], "rv_restore_1", "2027.1")).toBe("2027.1");
  });
});
