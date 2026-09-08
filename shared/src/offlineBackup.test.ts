import { describe, expect, it } from "vitest";
import {
  buildOfflineContingencyPayload,
  offlineContingencyHasWipeTrigger,
} from "./offlineBackup.js";

describe("buildOfflineContingencyPayload", () => {
  it("omits wipe-trigger keys including teacher_exemptions and teacher history", () => {
    const payload = buildOfflineContingencyPayload({
      examCycleName: "2027 HSC",
      examCycleStatus: "OPEN",
      ruleVersionLabel: "2027.1",
      teachers: [{ teacherId: "t1" }],
      schools: [{ schoolId: "s1" }],
      centres: [{ centreId: "c1" }],
      relationships: [],
      history: [{ teacherId: "t1" }],
      blocks: [{ blockId: "b1" }],
    });
    expect(payload.metadata).toMatchObject({ source: "offline-memory" });
    expect(payload.teachers).toHaveLength(1);
    expect(payload.rules).toBe("2027.1");
    expect(offlineContingencyHasWipeTrigger(payload)).toBe(false);
    expect(Array.isArray(payload.teacher_exemptions)).toBe(false);
    expect(Array.isArray(payload.exam_cycles)).toBe(false);
    expect(Array.isArray(payload.rule_versions)).toBe(false);
    expect(Array.isArray(payload.subjects)).toBe(false);
    expect(Array.isArray(payload.rule_parameters)).toBe(false);
    expect(Array.isArray(payload.audit_logs)).toBe(false);
    expect(Array.isArray(payload.teacher_school_history)).toBe(false);
    expect(Array.isArray(payload.teacher_designation_history)).toBe(false);
    expect(Array.isArray(payload.teacher_location_history)).toBe(false);
    expect(Array.isArray(payload.allocation_runs)).toBe(false);
    expect(Array.isArray(payload.examiner_pairs)).toBe(false);
    expect(Array.isArray(payload.input_snapshots)).toBe(false);
    expect(Array.isArray(payload.practical_batches)).toBe(false);
  });
});
