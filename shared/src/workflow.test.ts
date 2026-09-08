import { describe, expect, it } from "vitest";
import {
  applyTeacherImport,
  previewTeacherImport,
  parseTeacherRowsFromAoa,
  canTransition,
  isAllocationImmutable,
  createAmendmentDescriptor,
  pickHydrateExamCycle,
  assertMutable,
  mutationConflictStatus,
  shouldApplySessionAfterApi,
  shouldApplySessionAfterApis,
  importFileRowCount,
  importDrilldownCounts,
  historySourceImportId,
  parseImportRowCountHeader,
} from "../src/index.js";

describe("excel teacher AOA parse", () => {
  it("maps headers and coerces types", () => {
    const { rows, headerErrors } = parseTeacherRowsFromAoa([
      ["Employee Code", "Name", "School Code", "Designation", "isActive"],
      ["E1", "Ann", "S1", "HM", "yes"],
      ["", "", "", "", ""],
      ["E2", "Bob", "S2", "PG", "0"],
    ]);
    expect(headerErrors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      employeeCode: "E1",
      isActive: true,
    });
    expect(rows[1]).toMatchObject({ employeeCode: "E2", isActive: false });
  });
});

describe("import apply preserves history", () => {
  it("records school change history and does not delete", () => {
    const existing = [
      {
        employeeCode: "E1",
        name: "Ann",
        schoolCode: "S1",
        designation: "HM",
        isActive: true,
      },
    ];
    const preview = previewTeacherImport(
      [
        {
          employeeCode: "E1",
          name: "Ann",
          schoolCode: "S2",
          designation: "HM",
        },
        {
          employeeCode: "E2",
          name: "New",
          schoolCode: "S1",
          designation: "PG",
        },
      ],
      existing,
    );
    const applied = applyTeacherImport({
      preview,
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Ann",
          schoolId: "sch1",
          designation: "HM",
          isActive: true,
          dataQuality: "Confirmed",
        },
      ],
      schools: [
        { schoolId: "sch1", schoolCode: "S1" },
        { schoolId: "sch2", schoolCode: "S2" },
      ],
      importId: "imp1",
      asOfDate: "2027-01-15",
    });
    expect(applied.appliedUpdated).toBe(1);
    expect(applied.appliedNew).toBe(1);
    expect(applied.teachers).toHaveLength(2);
    expect(applied.schoolHistory.some((h) => h.effectiveTo === "2027-01-15")).toBe(
      true,
    );
    expect(applied.teachers.find((t) => t.employeeCode === "E1")?.schoolId).toBe(
      "sch2",
    );
  });

  it("counts file rows, not MISSING sentinels or roster upserts", () => {
    expect(
      importFileRowCount([
        { rowNumber: 1 },
        { rowNumber: 2 },
        { rowNumber: -1 },
      ]),
    ).toBe(2);
    expect(importFileRowCount([{ rowNumber: -1 }])).toBeUndefined();
    expect(importFileRowCount([])).toBeUndefined();
    expect(parseImportRowCountHeader("2")).toBe(2);
    expect(parseImportRowCountHeader("2.5")).toBeUndefined();
    expect(parseImportRowCountHeader("-1")).toBeUndefined();
    expect(parseImportRowCountHeader("nope")).toBeUndefined();
    expect(
      importDrilldownCounts([
        { rowNumber: 1 },
        { rowNumber: 2 },
        { row_number: -1 },
      ]),
    ).toEqual({ fileRows: 2, outcomes: 3 });
  });

  it("does not invent import provenance when no archive id is given", () => {
    expect(historySourceImportId(undefined)).toBe("");
    expect(historySourceImportId("  ")).toBe("");
    expect(historySourceImportId("imp-archived")).toBe("imp-archived");
    const existing = [
      {
        employeeCode: "E1",
        name: "Ann",
        schoolCode: "S1",
        designation: "HM",
        isActive: true,
      },
    ];
    const preview = previewTeacherImport(
      [
        {
          employeeCode: "E1",
          name: "Ann",
          schoolCode: "S2",
          designation: "PG",
        },
      ],
      existing,
    );
    const applied = applyTeacherImport({
      preview,
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Ann",
          schoolId: "sch1",
          designation: "HM",
          isActive: true,
          dataQuality: "Confirmed",
        },
      ],
      schools: [
        { schoolId: "sch1", schoolCode: "S1" },
        { schoolId: "sch2", schoolCode: "S2" },
      ],
      asOfDate: "2027-01-15",
    });
    expect(applied.appliedUpdated).toBe(1);
    expect(
      applied.schoolHistory.every((h) => h.sourceImportId === ""),
    ).toBe(true);
    expect(
      applied.designationHistory.every((h) => h.sourceImportId === ""),
    ).toBe(true);
  });
});

describe("exam cycle workflow", () => {
  it("enforces transitions and immutability", () => {
    expect(canTransition("DRAFT", "OPEN")).toBe(true);
    expect(canTransition("PUBLISHED", "OPEN")).toBe(false);
    expect(isAllocationImmutable("PUBLISHED")).toBe(true);
    const frozen = assertMutable("PUBLISHED", "override");
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.conflict).toBe(true);
    expect(assertMutable("UNDER_REVIEW", "override").ok).toBe(true);
    expect(
      mutationConflictStatus({ error: "bad date" }),
    ).toBe(400);
    expect(
      mutationConflictStatus({
        error: "Cannot override while exam cycle is PUBLISHED",
        conflict: true,
      }),
    ).toBe(409);
    const amd = createAmendmentDescriptor("c1", "c2", "Correction needed");
    expect(amd.newStatus).toBe("DRAFT");
    expect(() => createAmendmentDescriptor("c1", "c2", "  ")).toThrow();
  });

  it("picks the mutable amendment on reload, not leftover published INITIAL_CYCLE", () => {
    const listed = [
      {
        exam_cycle_id: "ec_amd",
        status: "DRAFT",
        amended_from_id: "ec_2027_hsc",
      },
      { exam_cycle_id: "ec_2027_hsc", status: "PUBLISHED" },
    ];
    const leftoverPrefer =
      listed.find((c) => c.exam_cycle_id === "ec_2027_hsc") ?? listed[0];
    expect(leftoverPrefer?.exam_cycle_id).toBe("ec_2027_hsc");
    expect(pickHydrateExamCycle(listed, "ec_2027_hsc")?.exam_cycle_id).toBe(
      "ec_amd",
    );
    expect(pickHydrateExamCycle([], "ec_2027_hsc")).toBeUndefined();
    expect(pickHydrateExamCycle(undefined, "ec_2027_hsc")).toBeUndefined();
    expect(
      pickHydrateExamCycle(
        [{ exam_cycle_id: "ec_2027_hsc", status: "OPEN" }],
        "ec_2027_hsc",
      )?.exam_cycle_id,
    ).toBe("ec_2027_hsc");
    expect(
      pickHydrateExamCycle(
        [
          { exam_cycle_id: "ec_old", status: "ARCHIVED" },
          { exam_cycle_id: "ec_2027_hsc", status: "PUBLISHED" },
        ],
        "ec_2027_hsc",
      )?.exam_cycle_id,
    ).toBe("ec_2027_hsc");
  });

  it("does not apply session state after a reached non-OK API", () => {
    expect(shouldApplySessionAfterApi(null)).toEqual({
      apply: true,
      offline: true,
    });
    expect(shouldApplySessionAfterApi({ ok: true })).toEqual({
      apply: true,
      offline: false,
    });
    expect(shouldApplySessionAfterApi({ accepted: true })).toEqual({
      apply: true,
      offline: false,
    });
    const refused = shouldApplySessionAfterApi({
      ok: false,
      error: "Cannot apply import while exam cycle is PUBLISHED",
    });
    expect(refused).toEqual({
      apply: false,
      error: "Cannot apply import while exam cycle is PUBLISHED",
    });
    const conflictOnly = shouldApplySessionAfterApi({
      error: "frozen",
      accepted: false,
    });
    expect(conflictOnly.apply).toBe(false);
    if (!conflictOnly.apply) expect(conflictOnly.error).toBe("frozen");
    const persistRefused = shouldApplySessionAfterApi({
      accepted: false,
      error: "Cannot generate allocation while exam cycle is PUBLISHED",
    });
    expect(persistRefused).toEqual({
      apply: false,
      error: "Cannot generate allocation while exam cycle is PUBLISHED",
    });
  });

  it("does not apply a multi-write when any reached sibling failed or timed out", () => {
    expect(shouldApplySessionAfterApis([null, null])).toEqual({
      apply: true,
      offline: true,
    });
    expect(shouldApplySessionAfterApis([{ ok: true }, { ok: true }])).toEqual({
      apply: true,
      offline: false,
    });
    const mixed = shouldApplySessionAfterApis([
      { ok: true },
      { error: "Allocation run run_prac not found" },
    ]);
    expect(mixed.apply).toBe(false);
    if (!mixed.apply) {
      expect(mixed.error).toBe("Allocation run run_prac not found");
    }
    const timeout = shouldApplySessionAfterApis([{ ok: true }, null]);
    expect(timeout).toEqual({
      apply: false,
      error:
        "API reachable but a write call did not return — refuse local apply",
    });
  });
});
