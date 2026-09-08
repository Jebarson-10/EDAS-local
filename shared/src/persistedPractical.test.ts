import { describe, expect, it } from "vitest";
import { mergeFallbackIntoDecisionTrace } from "./persistedFlags.js";
import {
  findPersistedResultForPracticalSchedule,
  practicalBatchesFromPersistedResults,
  practicalDecisionTraceFromSchedule,
  practicalIdentityFromDecisionTrace,
  practicalSchedulesFromPersistedResults,
  practicalSubjectFromBatchOrTrace,
} from "./persistedPractical.js";

describe("practicalDecisionTraceFromSchedule", () => {
  it("keeps school/subject/batch/external identity for persist", () => {
    expect(
      practicalDecisionTraceFromSchedule({
        batchKey: "s1|PHYSICS|1",
        schoolId: "s1",
        subjectId: "PHYSICS",
        externalExaminerId: "t_ext",
        decisionNotes: ["Applied annual role switch from academic year 2026"],
        roleSwitchApplied: true,
        batchIndex: 1,
        studentCount: 40,
      }),
    ).toEqual({
      batchKey: "s1|PHYSICS|1",
      schoolId: "s1",
      subjectId: "PHYSICS",
      externalExaminerId: "t_ext",
      decisionNotes: ["Applied annual role switch from academic year 2026"],
      roleSwitchApplied: true,
      batchIndex: 1,
      studentCount: 40,
    });
  });
});

describe("mergeFallbackIntoDecisionTrace + practical identity", () => {
  it("folds usedFallbackBand onto an object trace without dropping batchKey", () => {
    const merged = mergeFallbackIntoDecisionTrace(
      JSON.stringify(
        practicalDecisionTraceFromSchedule({
          batchKey: "s1|PHYSICS|1",
          schoolId: "s1",
          subjectId: "PHYSICS",
          externalExaminerId: "t_ext",
          decisionNotes: [],
          roleSwitchApplied: false,
          batchIndex: 1,
          studentCount: 40,
        }),
      ),
      false,
    );
    expect(JSON.parse(merged)).toEqual({
      batchKey: "s1|PHYSICS|1",
      schoolId: "s1",
      subjectId: "PHYSICS",
      externalExaminerId: "t_ext",
      decisionNotes: [],
      roleSwitchApplied: false,
      batchIndex: 1,
      studentCount: 40,
      usedFallbackBand: false,
    });
  });
});

describe("practicalIdentityFromDecisionTrace", () => {
  it("reads persisted identity instead of inventing UNK", () => {
    expect(
      practicalIdentityFromDecisionTrace(
        JSON.stringify({
          batchKey: "s1|PHYSICS|1",
          schoolId: "s1",
          subjectId: "PHYSICS",
          externalExaminerId: "t_ext",
          decisionNotes: ["Applied annual role switch from academic year 2026"],
          batchIndex: 1,
          studentCount: 40,
        }),
      ),
    ).toEqual({
      batchKey: "s1|PHYSICS|1",
      schoolId: "s1",
      subjectId: "PHYSICS",
      externalExaminerId: "t_ext",
      decisionNotes: ["Applied annual role switch from academic year 2026"],
      batchIndex: 1,
      studentCount: 40,
    });
  });

  it("treats leftover UNK identity as missing", () => {
    const identity = practicalIdentityFromDecisionTrace(
      JSON.stringify({ subjectId: "UNK", batchKey: "UNK", schoolId: "UNK" }),
    );
    expect(identity.subjectId).toBe("");
    expect(identity.batchKey).toBe("");
    expect(identity.schoolId).toBe("");
  });

  it("does not invent UNK or batch-date labels for old notes-only traces", () => {
    const identity = practicalIdentityFromDecisionTrace(
      JSON.stringify({
        decisionNotes: ["Applied annual role switch from academic year 2026"],
        roleSwitchApplied: true,
      }),
    );
    expect(identity.subjectId).toBe("");
    expect(identity.subjectId).not.toBe("UNK");
    expect(identity.batchKey).toBe("");
    expect(identity.externalExaminerId).toBe("");
    expect(identity.schoolId).toBe("");
    expect(identity.decisionNotes).toEqual([
      "Applied annual role switch from academic year 2026",
    ]);
    expect(identity.studentCount).toBeUndefined();
  });
});

describe("practicalSchedulesFromPersistedResults", () => {
  it("hydrates school/subject/batch/external from the trace", () => {
    const schedules = practicalSchedulesFromPersistedResults([
      {
        teacher_id: "t_int",
        centre_id: "s1",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify({
          batchKey: "s1|PHYSICS|1",
          schoolId: "s1",
          subjectId: "PHYSICS",
          externalExaminerId: "t_ext",
          decisionNotes: [],
          roleSwitchApplied: false,
          batchIndex: 1,
          studentCount: 40,
        }),
      },
    ]);
    expect(schedules).toEqual([
      {
        batchKey: "s1|PHYSICS|1",
        schoolId: "s1",
        subjectId: "PHYSICS",
        examDate: "2027-03-01",
        sessionCode: "MORNING",
        internalExaminerId: "t_int",
        externalExaminerId: "t_ext",
        roleSwitchApplied: false,
        decisionNotes: [],
      },
    ]);
  });

  it("does not invent UNK, centre-date batchKey, or external=internal", () => {
    const schedules = practicalSchedulesFromPersistedResults([
      {
        teacher_id: "t_int",
        centre_id: "s1",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify([
          "Applied annual role switch from academic year 2026",
        ]),
      },
    ]);
    expect(schedules[0]?.subjectId).toBe("");
    expect(schedules[0]?.subjectId).not.toBe("UNK");
    expect(schedules[0]?.batchKey).toBe("");
    expect(schedules[0]?.batchKey).not.toBe("s1-2027-03-01");
    expect(schedules[0]?.schoolId).toBe("s1");
    expect(schedules[0]?.externalExaminerId).toBe("");
    expect(schedules[0]?.externalExaminerId).not.toBe(
      schedules[0]?.internalExaminerId,
    );
    expect(schedules[0]?.decisionNotes).toEqual([
      "Applied annual role switch from academic year 2026",
    ]);
  });

  it("does not invent a second schedule from a PRACTICAL_EXTERNAL result row", () => {
    const schedules = practicalSchedulesFromPersistedResults([
      {
        teacher_id: "t_int",
        centre_id: "s1",
        duty_type_code: "PRACTICAL_INTERNAL",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify({
          batchKey: "s1|PHYSICS|1",
          schoolId: "s1",
          subjectId: "PHYSICS",
          externalExaminerId: "t_ext",
          decisionNotes: [],
          roleSwitchApplied: false,
          batchIndex: 1,
          studentCount: 40,
        }),
      },
      {
        teacher_id: "t_ext",
        centre_id: "s1",
        duty_type_code: "PRACTICAL_EXTERNAL",
        role_code: "PRACTICAL_EXTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify({
          batchKey: "s1|PHYSICS|1",
          schoolId: "s1",
          subjectId: "PHYSICS",
          externalExaminerId: "t_ext",
          decisionNotes: [],
          roleSwitchApplied: false,
          batchIndex: 1,
          studentCount: 40,
        }),
      },
    ]);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.internalExaminerId).toBe("t_int");
    expect(schedules[0]?.externalExaminerId).toBe("t_ext");
  });
});

describe("practicalBatchesFromPersistedResults", () => {
  it("reads persisted batch identity instead of inventing studentCount 0", () => {
    const batches = practicalBatchesFromPersistedResults([
      {
        teacher_id: "t_int",
        centre_id: "s1",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify({
          batchKey: "s1|PHYSICS|1",
          schoolId: "s1",
          subjectId: "PHYSICS",
          externalExaminerId: "t_ext",
          batchIndex: 1,
          studentCount: 40,
        }),
      },
      {
        teacher_id: "t_old",
        centre_id: "s1",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-02",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify([]),
      },
    ]);
    expect(batches).toEqual([
      {
        batchKey: "s1|PHYSICS|1",
        schoolId: "s1",
        subjectId: "PHYSICS",
        batchIndex: 1,
        studentCount: 40,
      },
    ]);
  });
});

describe("practicalSubjectFromBatchOrTrace", () => {
  it("skips leftover UNK batch subject and keeps persisted identity", () => {
    expect(
      practicalSubjectFromBatchOrTrace(
        { subject_code: "UNK", subject_id: "UNK" },
        "PHYSICS",
      ),
    ).toBe("PHYSICS");
  });

  it("does not invent UNK when leftover batch and old trace both lack identity", () => {
    expect(
      practicalSubjectFromBatchOrTrace({ subject_code: "UNK" }, ""),
    ).toBe("");
    expect(practicalSubjectFromBatchOrTrace(undefined, "UNK")).toBe("");
  });

  it("keeps a real leftover/live batch subject", () => {
    expect(
      practicalSubjectFromBatchOrTrace({ subject_code: "CHEMISTRY" }, "PHYSICS"),
    ).toBe("CHEMISTRY");
  });
});

describe("findPersistedResultForPracticalSchedule", () => {
  it("matches a schedule to its persisted batchKey", () => {
    const rows = [
      {
        teacher_id: "t_int",
        centre_id: "s1",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify({
          batchKey: "s1|PHYSICS|1",
          schoolId: "s1",
          subjectId: "PHYSICS",
        }),
      },
    ];
    const found = findPersistedResultForPracticalSchedule(rows, {
      batchId: "s1|PHYSICS|1",
      examDate: "2027-03-01",
      internalExaminerId: "t_int",
    });
    expect(found?.teacher_id).toBe("t_int");
  });

  it("prefers the INTERNAL result when an EXTERNAL pair row shares the batchKey", () => {
    const rows = [
      {
        teacher_id: "t_ext",
        centre_id: "s1",
        duty_type_code: "PRACTICAL_EXTERNAL",
        role_code: "PRACTICAL_EXTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify({
          batchKey: "s1|PHYSICS|1",
          schoolId: "s1",
          subjectId: "PHYSICS",
          externalExaminerId: "t_ext",
        }),
      },
      {
        teacher_id: "t_int",
        centre_id: "s1",
        duty_type_code: "PRACTICAL_INTERNAL",
        role_code: "PRACTICAL_INTERNAL",
        exam_date: "2027-03-01",
        session_code: "MORNING",
        score: 0,
        decision_trace_json: JSON.stringify({
          batchKey: "s1|PHYSICS|1",
          schoolId: "s1",
          subjectId: "PHYSICS",
          externalExaminerId: "t_ext",
        }),
      },
    ];
    const found = findPersistedResultForPracticalSchedule(rows, {
      batchId: "s1|PHYSICS|1",
      examDate: "2027-03-01",
      internalExaminerId: "t_int",
    });
    expect(found?.teacher_id).toBe("t_int");
  });
});
