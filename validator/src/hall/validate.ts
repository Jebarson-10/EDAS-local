import type { HallDataset, HallResult } from "@exam-duty/allocation-engine";
import { type RuleParameters, type ValidationStatus } from "@exam-duty/shared";
import { teachesSubject, normalizeSubject } from "@exam-duty/shared";
import { detectSessionConflicts } from "../conflict/engine.js";
import type { ValidationIssue, ValidationResult } from "../theory/validate.js";

type HallValidationDataset = Pick<
  HallDataset,
  | "teachers"
  | "schools"
  | "centres"
  | "exemptions"
  | "history"
  | "calendar"
  | "academicYear"
  | "centreSchoolIds"
>;

function academicYearNumber(value: string): number | null {
  const match = String(value).match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

/** Keep this check independent from the allocator: only approved teaching posts may invigilate. */
function isApprovedHallDesignation(designation: string): boolean {
  return ["PG", "SENIOR_PG", "BT", "SGT", "SPECIAL_TEACHER"].includes(designation);
}

function hallEligibilityProblems(
  assignment: HallResult["assignments"][number],
  dataset: HallValidationDataset,
  rules: RuleParameters,
  paperSubjects?: string[],
): Array<{ ruleCode: string; message: string }> {
  const teacher = dataset.teachers.find((item) => item.teacherId === assignment.teacherId);
  const centre = dataset.centres.find((item) => item.centreId === assignment.centreId);
  if (!teacher || !centre) {
    return [{ ruleCode: "RULE-HALL-REFERENCE", message: "Assignment references unknown staff or centre" }];
  }
  const problems: Array<{ ruleCode: string; message: string }> = [];
  const recordedSubjects=[teacher.subject || teacher.officialDetails?.["Handling subject"] || teacher.officialDetails?.["Major subject"],teacher.officialDetails?.["Additional handling subjects"]].filter(Boolean).join(", ");
  if (paperSubjects && (!paperSubjects.length || paperSubjects.some(subject => !subject.trim()))) problems.push({ruleCode:"RULE-HALL-PAPER",message:"Timetable subject is missing."});
  if (paperSubjects?.some(subject => teachesSubject(recordedSubjects,subject) || (normalizeSubject(subject).code === "SCI" && ["PHY","CHE","BIO"].some(science=>teachesSubject(recordedSubjects,science))))) problems.push({ruleCode:"RULE-HALL-EXAM-SUBJECT",message:"A teacher of the examined subject cannot invigilate or serve as backup in that session."});
  if (paperSubjects && !recordedSubjects && teacher.designation !== "SPECIAL_TEACHER") problems.push({ruleCode:"RULE-HALL-TEACHER-SUBJECT",message:"Teacher subject is missing; the exam-subject exclusion cannot be checked."});
  if (!teacher.isActive) problems.push({ ruleCode: "RULE-HALL-INACTIVE", message: "Hall staff member is inactive" });
  if ((teacher.staffCategory ?? "TEACHING") !== "TEACHING") {
    problems.push({ ruleCode: "RULE-HALL-STAFF-CATEGORY", message: "Hall invigilator must be teaching staff" });
  }
  if (!isApprovedHallDesignation(teacher.designation)) {
    problems.push({ ruleCode: "RULE-HALL-POST", message: "Only PG, Senior PG, BT, SGT or special teachers may be used for hall duty" });
  }
  if (rules.hall_designation_allowlist.length && !rules.hall_designation_allowlist.includes(teacher.designation)) {
    problems.push({ ruleCode: "RULE-HALL-POST", message: "Staff post is not allowed for hall duty" });
  }
  const exempt = dataset.exemptions.some(
    (item) =>
      item.teacherId === teacher.teacherId &&
      item.isExempted &&
      item.effectiveFrom <= assignment.examDate &&
      (!item.effectiveTo || item.effectiveTo >= assignment.examDate),
  );
  if (exempt) problems.push({ ruleCode: "RULE-HALL-EXEMPT", message: "Hall staff member is exempt" });
  const calendarConflict = dataset.calendar.some(
    (item) =>
      item.teacherId === teacher.teacherId &&
      item.date === assignment.examDate &&
      item.session === assignment.sessionCode,
  );
  if (calendarConflict) {
    problems.push({ ruleCode: "RULE-HALL-CALENDAR", message: "Staff member already has another duty in this session" });
  }
  if ((dataset.centreSchoolIds.get(centre.centreId) ?? new Set()).has(teacher.schoolId)) {
    problems.push({ ruleCode: "RULE-HALL-OWN-SCHOOL", message: "Staff member belongs to this centre or a clubbed school" });
  }
  const year = academicYearNumber(dataset.academicYear);
  const repeatCentre = dataset.history.some((item) => {
    const historyYear = academicYearNumber(item.academicYear);
    return (
      item.teacherId === teacher.teacherId &&
      item.centreId === centre.centreId &&
      year != null &&
      historyYear != null &&
      historyYear < year &&
      historyYear >= year - rules.repeat_years
    );
  });
  if (repeatCentre) {
    problems.push({ ruleCode: "RULE-HALL-REPEAT-CENTRE", message: "Staff member served at this centre within the previous-year exclusion window" });
  }
  const school = dataset.schools.find((item) => item.schoolId === teacher.schoolId);
  if (!school?.blockId?.trim() || !centre.blockId?.trim() || school.blockId !== centre.blockId) {
    problems.push({ ruleCode: "RULE-HALL-BLOCK", message: "Staff member's current school and the centre must have the same saved block." });
  }
  return problems;
}

export function validateHallAllocation(
  result: HallResult,
  demands: Array<{ centreId: string; totalStudents: number; examDate?: string; sessionCode?: "MORNING" | "AFTERNOON"; subjects?: string[] }>,
  rules: RuleParameters,
  dataset?: HallValidationDataset,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  let errors = 0;
  let warnings = 0;
  let valid = 0;

  for (const d of demands) {
    // Independent calculation; never reuse the allocator’s count helper.
    const expected = {
      requiredHalls: d.totalStudents > 0 ? Math.ceil(d.totalStudents / Math.max(rules.students_per_hall,1)) + rules.extra_halls_per_centre : 0,
      standby: d.totalStudents > 0 ? rules.hall_backup_staff : 0,
    };
    if (d.examDate && d.sessionCode) {
      const sessionAssignments=result.assignments.filter(a => a.centreId===d.centreId && a.examDate===d.examDate && a.sessionCode===d.sessionCode);
      for (const [role,expectedCount] of [["HALL_INVIGILATOR",expected.requiredHalls],["HALL_STANDBY",expected.standby]] as const) {
        const count=sessionAssignments.filter(a=>a.roleCode===role).length;
        if (count!==expectedCount) { errors++; issues.push({ruleCode:"RULE-HALL-STAFF-COUNT",severity:"ERROR",message:`${role === "HALL_STANDBY" ? "Backup staff" : "Invigilators"}: ${count} assigned; ${expectedCount} required.`,centreId:d.centreId,date:d.examDate}); }
      }
    }
    const gotHalls = result.requiredHallsByCentre[d.centreId] ?? -1;
    const gotStandby = result.standbyByCentre[d.centreId] ?? -1;
    if (gotHalls !== expected.requiredHalls || gotStandby !== expected.standby) {
      errors += 1;
      issues.push({
        ruleCode: "RULE-HALL-CALC",
        severity: "ERROR",
        message: `Hall/standby calc mismatch for ${d.centreId}`,
      });
    }
  }

  // Reuse on another exam day is allowed. Only two hall places in the same
  // date/session are a clash.
  const seen = new Set<string>();
  for (const a of result.assignments) {
    const assignmentKey = `${a.teacherId}|${a.examDate}|${a.sessionCode}`;
    if (seen.has(assignmentKey)) {
      errors += 1;
      issues.push({
        ruleCode: "RULE-HALL-DUP",
        severity: "ERROR",
        message: "Teacher assigned twice in the same date and session",
        teacherId: a.teacherId,
      });
    } else {
      seen.add(assignmentKey);
      valid += 1;
    }
    if (dataset) {
      const demand=demands.find(d => d.centreId===a.centreId && (!d.examDate || d.examDate===a.examDate) && (!d.sessionCode || d.sessionCode===a.sessionCode));
      if (!demand) {errors++;issues.push({ruleCode:"RULE-HALL-SESSION",severity:"ERROR",message:"Hall assignment is outside the requested centre timetable.",teacherId:a.teacherId});}
      for (const problem of hallEligibilityProblems(a, dataset, rules, demand?.subjects)) {
        errors += 1;
        issues.push({
          ruleCode: problem.ruleCode,
          severity: "ERROR",
          message: problem.message,
          teacherId: a.teacherId,
          centreId: a.centreId,
          date: a.examDate,
          duty: a.roleCode,
        });
      }
    }
  }

  for (const s of result.shortages) {
    errors += 1;
    issues.push({
      ruleCode: "RULE-HALL-SHORTAGE",
      severity: "ERROR",
      message: s.message,
      centreId: s.centreId,
      details: {
        centreId: s.centreId,
        required: s.required,
        eligible: s.eligible,
        shortage: s.shortage,
      },
    });
  }

  const conflicts = detectSessionConflicts(
    result.assignments.map((a) => ({
      teacherId: a.teacherId,
      date: a.examDate,
      session: a.sessionCode,
      dutyType: a.roleCode,
      locationId: a.centreId,
    })),
  );
  for (const c of conflicts) {
    errors += 1;
    issues.push({
      ruleCode: c.ruleCode,
      severity: "ERROR",
      message: c.message,
      teacherId: c.teacherId,
      date: c.date,
    });
  }

  let status: ValidationStatus = "VALID";
  if (errors > 0) status = "INVALID";
  else if (warnings > 0) status = "VALID_WITH_WARNINGS";

  return {
    status,
    assignments: result.assignments.length,
    valid,
    warnings,
    errors,
    issues,
    conflicts,
  };
}
