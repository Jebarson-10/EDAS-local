import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS, type Teacher } from "@exam-duty/shared";
import { schedulePractical } from "./schedule.js";

const teacher = (
  teacherId: string,
  employeeCode: string,
  schoolId: string,
): Teacher => ({
  teacherId,
  employeeCode,
  name: teacherId,
  schoolId,
  designation: "PG",
  subject: "physics",
  isActive: true,
  dataQuality: "Confirmed",
});

describe("practical scheduling", () => {
  it("explains a missing external examiner using actual staff and remaining sessions", () => {
    const result = schedulePractical(
      [{ schoolId: "host", subjectId: "physics", studentCount: 50 }],
      { teachers: [teacher("inside", "I", "host"), { ...teacher("wrong-post", "W", "outside"), designation: "BT" }, teacher("occupied", "O", "outside")], exemptions: [], calendar: [{ teacherId: "occupied", date: "2027-03-01", session: "MORNING", dutyType: "THEORY" }, { teacherId: "occupied", date: "2027-03-01", session: "AFTERNOON", dutyType: "THEORY" }], pairHistory: [], availableDates: ["2027-03-01"], asOfDate: "2027-03-01", academicYear: "2027", standard: "12", internalEligible: (t, school) => t.schoolId === school, externalEligible: (t, school) => t.schoolId !== school },
      DEFAULT_RULE_PARAMETERS,
    );
    expect(result.feasible).toBe(false);
    expect(result.diagnostics?.[0]?.message).toContain("external examiner");
    expect(result.diagnostics?.[0]?.message).not.toContain("No available PG internal examiner");
    expect(result.diagnostics?.[0]?.exclusionTallies).toEqual({ "Wrong staff post (needs PG)": 1, "Already occupied in every remaining session": 1 });
  });
  it("stagger schools so the same subject teachers can exchange examiner duties", () => {
    const result = schedulePractical(
      [{schoolId:"a",subjectId:"physics",studentCount:50},{schoolId:"b",subjectId:"physics",studentCount:50}],
      {teachers:[teacher("ta","A","a"),teacher("tb","B","b")],exemptions:[],calendar:[],pairHistory:[],availableDates:["2027-03-01"],asOfDate:"2027-03-01",academicYear:"2027",standard:"12",internalEligible:(t,s)=>t.schoolId===s,externalEligible:(t,s)=>t.schoolId!==s},
      DEFAULT_RULE_PARAMETERS,
    );
    expect(result.feasible).toBe(true);
    expect(result.schedules.map(s=>[s.schoolId,s.sessionCode,s.internalExaminerId,s.externalExaminerId])).toEqual([["a","MORNING","ta","tb"],["b","AFTERNOON","tb","ta"]]);
  });
  it("never uses office staff as practical internal or external examiners", () => {
    const officeInternal: Teacher = {
      ...teacher("office-internal", "A-OFFICE", "host"),
      staffCategory: "NON_TEACHING",
      designation: "Junior Assistant",
    };
    const officeExternal: Teacher = {
      ...teacher("office-external", "B-OFFICE", "outside"),
      staffCategory: "NON_TEACHING",
      designation: "Record Clerk",
    };
    const result = schedulePractical(
      [{ schoolId: "host", subjectId: "bio", studentCount: 40 }],
      {
        teachers: [
          officeInternal,
          officeExternal,
          { ...teacher("teaching-internal", "Z-INTERNAL", "host"), subject: "bio" },
          { ...teacher("teaching-external", "Z-EXTERNAL", "outside"), subject: "bio" },
        ],
        exemptions: [],
        calendar: [],
        pairHistory: [],
        availableDates: ["2027-03-01"],
        asOfDate: "2027-03-01",
        academicYear: "2027",
        standard: "12",
        // These callbacks intentionally only check school. The scheduler must
        // still enforce staff group independently of a caller's callback.
        internalEligible: (candidate, schoolId) => candidate.schoolId === schoolId,
        externalEligible: (candidate, schoolId) => candidate.schoolId !== schoolId,
      },
      DEFAULT_RULE_PARAMETERS,
    );

    expect(result.feasible).toBe(true);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0]).toMatchObject({
      internalExaminerId: "teaching-internal",
      externalExaminerId: "teaching-external",
    });
  });

  it("runs different subject groups in parallel while keeping each subject's batches sequential", () => {
    const result = schedulePractical(
      [
        { schoolId: "host", subjectId: "bio", studentCount: 100 },
        { schoolId: "host", subjectId: "computer", studentCount: 100 },
        { schoolId: "host", subjectId: "vocational", studentCount: 100 },
      ],
      {
        teachers: [
          { ...teacher("i-bio", "I1", "host"), subject: "bio" }, { ...teacher("i-computer", "I2", "host"), subject: "computer" }, { ...teacher("i-vocational", "I3", "host"), subject: "vocational" },
          { ...teacher("e-bio", "E1", "outside"), subject: "bio" }, { ...teacher("e-computer", "E2", "outside"), subject: "computer" }, { ...teacher("e-vocational", "E3", "outside"), subject: "vocational" },
        ],
        exemptions: [],
        calendar: [],
        pairHistory: [],
        availableDates: ["2027-03-01", "2027-03-02"],
        asOfDate: "2027-03-01",
        academicYear: "2027",
        standard: "12",
        internalEligible: (candidate, schoolId, subjectId) =>
          candidate.teacherId === `i-${subjectId}` && candidate.schoolId === schoolId,
        externalEligible: (candidate, _schoolId, subjectId) =>
          candidate.teacherId === `e-${subjectId}`,
      },
      { ...DEFAULT_RULE_PARAMETERS, practical_batch_size: 50, practical_completion_days: 2 },
    );

    expect(result.feasible).toBe(true);
    expect(result.schedules).toHaveLength(6);
    const firstBatches = result.schedules.filter((item) => item.batchKey.endsWith("|1"));
    const secondBatches = result.schedules.filter((item) => item.batchKey.endsWith("|2"));
    expect(new Set(firstBatches.map((item) => `${item.examDate}|${item.sessionCode}`))).toEqual(
      new Set(["2027-03-01|MORNING"]),
    );
    expect(new Set(secondBatches.map((item) => `${item.examDate}|${item.sessionCode}`))).toEqual(
      new Set(["2027-03-01|AFTERNOON"]),
    );
  });

  it("uses BT assistants for standard 10 and PG assistants for standard 12", () => {
    const pg = { ...teacher("pg", "PG", "host"), subject: "bio" };
    const bt = { ...teacher("bt", "BT", "host"), designation: "BT ASST", subject: "bio" };
    const outsideBt = { ...teacher("outside-bt", "BT2", "outside"), designation: "BT", subject: "bio" };
    const result = schedulePractical(
      [{ schoolId: "host", subjectId: "bio", studentCount: 20 }],
      {
        teachers: [pg, bt, outsideBt], exemptions: [], calendar: [], pairHistory: [],
        availableDates: ["2027-03-01"], asOfDate: "2027-03-01", academicYear: "2027", standard: "10",
        internalEligible: (candidate, schoolId) => candidate.schoolId === schoolId,
        externalEligible: (candidate, schoolId) => candidate.schoolId !== schoolId,
      },
      DEFAULT_RULE_PARAMETERS,
    );
    expect(result.schedules[0]).toMatchObject({ internalExaminerId: "bt", externalExaminerId: "outside-bt" });
  });

  it("requires a matching recorded subject and never uses SGT or SPL for practical duty", () => {
    const result = schedulePractical(
      [{ schoolId: "host", subjectId: "chemistry", studentCount: 20 }],
      {
        teachers: [
          { ...teacher("wrong-internal", "A1", "host"), subject: "physics" },
          { ...teacher("right-internal", "A2", "host"), subject: "chemistry" },
          { ...teacher("sgt-internal", "A3", "host"), designation: "SGT", subject: "chemistry" },
          { ...teacher("spl-internal", "A4", "host"), designation: "SPECIAL_TEACHER", subject: "chemistry" },
          { ...teacher("wrong-external", "B1", "outside"), subject: "physics" },
          { ...teacher("right-external", "B2", "outside"), subject: "chemistry" },
          { ...teacher("sgt-external", "B3", "outside"), designation: "SGT", subject: "chemistry" },
          { ...teacher("spl-external", "B4", "outside"), designation: "SPECIAL_TEACHER", subject: "chemistry" },
        ],
        exemptions: [], calendar: [], pairHistory: [], availableDates: ["2027-03-01"],
        asOfDate: "2027-03-01", academicYear: "2027", standard: "12",
        // The scheduler must still enforce its subject and post rules when a
        // caller accidentally supplies a broad school-only callback.
        internalEligible: (candidate, schoolId) => candidate.schoolId === schoolId,
        externalEligible: (candidate, schoolId) => candidate.schoolId !== schoolId,
      },
      DEFAULT_RULE_PARAMETERS,
    );

    expect(result.feasible).toBe(true);
    expect(result.schedules[0]).toMatchObject({
      internalExaminerId: "right-internal",
      externalExaminerId: "right-external",
    });
  });
});
