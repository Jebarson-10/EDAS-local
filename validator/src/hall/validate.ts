import type { HallDataset, HallResult } from "@exam-duty/allocation-engine";
import { haversineKm, roundKm, type RuleParameters, type ValidationStatus } from "@exam-duty/shared";
import { calculateHallRequirements } from "@exam-duty/allocation-engine";
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

function validCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean {
  return (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function academicYearNumber(value: string): number | null {
  const match = String(value).match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

function hallEligibilityProblems(
  assignment: HallResult["assignments"][number],
  dataset: HallValidationDataset,
  rules: RuleParameters,
): Array<{ ruleCode: string; message: string }> {
  const teacher = dataset.teachers.find((item) => item.teacherId === assignment.teacherId);
  const centre = dataset.centres.find((item) => item.centreId === assignment.centreId);
  if (!teacher || !centre) {
    return [{ ruleCode: "RULE-HALL-REFERENCE", message: "Assignment references unknown staff or centre" }];
  }
  const problems: Array<{ ruleCode: string; message: string }> = [];
  if (!teacher.isActive) problems.push({ ruleCode: "RULE-HALL-INACTIVE", message: "Hall staff member is inactive" });
  if ((teacher.staffCategory ?? "TEACHING") !== "TEACHING") {
    problems.push({ ruleCode: "RULE-HALL-STAFF-CATEGORY", message: "Hall invigilator must be teaching staff" });
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
  const homeDistance =
    validCoordinates(teacher.homeLatitude, teacher.homeLongitude) && validCoordinates(centre.latitude, centre.longitude)
      ? roundKm(haversineKm(teacher.homeLatitude!, teacher.homeLongitude!, centre.latitude!, centre.longitude!))
      : null;
  const schoolDistance =
    validCoordinates(school?.latitude, school?.longitude) && validCoordinates(centre.latitude, centre.longitude)
      ? roundKm(haversineKm(school!.latitude!, school!.longitude!, centre.latitude!, centre.longitude!))
      : null;
  const withinDistance =
    rules.distance_policy === "HOME_ONLY"
      ? homeDistance != null && homeDistance <= rules.maximum_distance_km
      : rules.distance_policy === "SCHOOL_ONLY"
        ? schoolDistance != null && schoolDistance <= rules.maximum_distance_km
        : (homeDistance != null && homeDistance <= rules.maximum_distance_km) ||
          (schoolDistance != null && schoolDistance <= rules.maximum_distance_km);
  if (homeDistance == null && schoolDistance == null) {
    if (rules.missing_coordinates_policy === "INELIGIBLE") {
      problems.push({ ruleCode: "RULE-HALL-DISTANCE", message: "Cannot check the 10 km rule because location details are missing" });
    }
  } else if (!withinDistance) {
    problems.push({ ruleCode: "RULE-HALL-DISTANCE", message: `Distance exceeds ${rules.maximum_distance_km} km` });
  }
  return problems;
}

export function validateHallAllocation(
  result: HallResult,
  demands: Array<{ centreId: string; totalStudents: number; examDate?: string; sessionCode?: "MORNING" | "AFTERNOON" }>,
  rules: RuleParameters,
  dataset?: HallValidationDataset,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  let errors = 0;
  let warnings = 0;
  let valid = 0;

  for (const d of demands) {
    const expected = calculateHallRequirements(
      d.totalStudents,
      rules.students_per_hall,
      rules.standby_percentage,
    );
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
      for (const problem of hallEligibilityProblems(a, dataset, rules)) {
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
