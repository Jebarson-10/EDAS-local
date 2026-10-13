import {
  type Centre,
  type DecisionReason,
  type RuleParameters,
  type School,
  type Teacher,
} from "@exam-duty/shared";
import { inferSchoolLevel, officePost } from "@exam-duty/shared";
import type {
  TheoryDataset,
  TheoryRequirement,
} from "@exam-duty/allocation-engine";

/**
 * The validator deliberately owns this check instead of calling the allocator.
 * It rechecks only hard eligibility rules; choosing the best eligible person is
 * an allocation concern and is intentionally not repeated here.
 */
export interface TheoryEligibilityCheck {
  eligible: boolean;
  hardReasons: DecisionReason[];
  warnings: DecisionReason[];
}

function exemptionApplies(
  effectiveFrom: string,
  effectiveTo: string | null | undefined,
  asOfDate: string,
): boolean {
  return effectiveFrom <= asOfDate && (!effectiveTo || effectiveTo >= asOfDate);
}

function activeSchoolIdsAtCentre(
  centreId: string,
  dataset: TheoryDataset,
): Set<string> {
  const schoolIds = new Set<string>();
  for (const relationship of dataset.relationships) {
    if (relationship.centreId !== centreId) continue;
    if (relationship.effectiveFrom > dataset.asOfDate) continue;
    if (
      relationship.effectiveTo &&
      relationship.effectiveTo < dataset.asOfDate
    ) {
      continue;
    }
    schoolIds.add(relationship.schoolId);
  }
  return schoolIds;
}

function academicYearNumber(academicYear: string): number {
  const match = academicYear.match(/(\d{4})/);
  return match ? Number(match[1]) : Number.NaN;
}

function isTheoryCentreDuty(
  dutyTypeCode: string,
  roleCode: string | null | undefined,
): boolean {
  return (
    dutyTypeCode.includes("THEORY") ||
    dutyTypeCode === "CHIEF_EXAMINATION" ||
    dutyTypeCode === "DEPARTMENT_OFFICER" ||
    dutyTypeCode === "OFFICE_STAFF" ||
    dutyTypeCode === "CUSTODIAN" ||
    roleCode === "CHIEF_EXAMINATION" ||
    roleCode === "DEPARTMENT_OFFICER" ||
    roleCode === "OFFICE_STAFF" ||
    roleCode === "CUSTODIAN"
  );
}

function priorCentreDuty(
  teacherId: string,
  centreId: string,
  dataset: TheoryDataset,
  repeatYears: number,
) {
  const currentYear = academicYearNumber(dataset.academicYear);
  if (Number.isNaN(currentYear)) return undefined;

  return dataset.history.find((history) => {
    if (history.teacherId !== teacherId || history.centreId !== centreId) {
      return false;
    }
    if (!isTheoryCentreDuty(history.dutyTypeCode, history.roleCode)) {
      return false;
    }
    const historicYear = academicYearNumber(history.academicYear);
    return (
      !Number.isNaN(historicYear) &&
      historicYear < currentYear &&
      historicYear >= currentYear - repeatYears
    );
  });
}

function roleBand(
  requirement: TheoryRequirement,
  designationBand: "preferred" | "fallback",
): string[] {
  return designationBand === "preferred"
    ? requirement.preferredDesignations
    : requirement.fallbackDesignations;
}

export function validateTheoryCandidateEligibility(
  teacher: Teacher,
  centre: Centre,
  schoolById: Map<string, School>,
  dataset: TheoryDataset,
  rules: RuleParameters,
  occupied: Set<string>,
  requirement: TheoryRequirement,
  designationBand: "preferred" | "fallback",
): TheoryEligibilityCheck {
  const hardReasons: DecisionReason[] = [];
  const currentSchool = schoolById.get(teacher.schoolId);
  if (requirement.requiredSchoolLevel && (currentSchool?.schoolLevel ?? inferSchoolLevel(currentSchool?.schoolName ?? "")) !== requirement.requiredSchoolLevel) {
    hardReasons.push({ruleCode:"RULE-CHIEF-SCHOOL-LEVEL",severity:"ERROR",message:"Chief must be a higher-secondary HM/Principal."});
  }
  if (requirement.seniorityByJoiningDate && (!teacher.joiningDate || !/^\d{4}-\d{2}-\d{2}$/.test(teacher.joiningDate) || !Number.isFinite(Date.parse(teacher.joiningDate)) || teacher.joiningDate > requirement.examDate)) {
    hardReasons.push({ruleCode:"RULE-DEPARTMENT-JOINING-DATE",severity:"ERROR",message:"PG appointment date is needed for departmental-officer seniority."});
  }
  const warnings: DecisionReason[] = [];
  if (requirement.roleCode === "CUSTODIAN" && !["PG", "SENIOR_PG", "BT"].includes(teacher.designation)) {
    hardReasons.push({ruleCode: "RULE-CUSTODIAN-POST", severity: "ERROR", message: "Only PG and BT Assistants may be custodians."});
  }

  if (
    requirement.staffCategory &&
    (teacher.staffCategory ?? "TEACHING") !== requirement.staffCategory
  ) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-STAFF-CATEGORY",
      severity: "ERROR",
      message: `This duty requires ${requirement.staffCategory.toLowerCase().replace("_", " ")} staff`,
    });
  }

  if (["SPECIAL_TEACHER", "SPL", "SPECIAL TEACHER"].includes(teacher.designation.toUpperCase())) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-SPECIAL-TEACHER",
      severity: "ERROR",
      message: "Special teachers are reserved for hall invigilation only",
    });
  }

  if (!teacher.isActive) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-INACTIVE",
      severity: "ERROR",
      message: "Teacher is inactive",
    });
  }

  const exemption = dataset.exemptions.find(
    (item) =>
      item.teacherId === teacher.teacherId &&
      item.isExempted &&
      exemptionApplies(item.effectiveFrom, item.effectiveTo, requirement.examDate),
  );
  if (exemption) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-EXEMPT",
      severity: "ERROR",
      message: `Teacher exempted: ${exemption.reason}`,
    });
  }

  const assignmentKey = `${teacher.teacherId}|${requirement.examDate}|${requirement.sessionCode}`;
  const calendarConflict = dataset.calendar.some(
    (event) =>
      event.teacherId === teacher.teacherId &&
      event.date === requirement.examDate &&
      event.session === requirement.sessionCode,
  );
  if (occupied.has(assignmentKey) || calendarConflict) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-CONFLICT",
      severity: "ERROR",
      message: "Simultaneous duty conflict on date/session",
    });
  }

  if (activeSchoolIdsAtCentre(centre.centreId, dataset).has(teacher.schoolId)) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-OWN-SCHOOL",
      severity: "ERROR",
      message: "Own-school / clubbed-school conflict (current school linked to centre)",
      details: { schoolId: teacher.schoolId, centreId: centre.centreId },
    });
  }

  const previousDuty = priorCentreDuty(
    teacher.teacherId,
    centre.centreId,
    dataset,
    rules.repeat_years,
  );
  if (previousDuty) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-002",
      severity: "ERROR",
      message:
        "Teacher was assigned to the same centre during the configured previous-year exclusion window",
      details: {
        academicYear: previousDuty.academicYear,
        dataQuality: previousDuty.dataQuality,
      },
    });
    if (previousDuty.dataQuality === "Unverified") {
      warnings.push({
        ruleCode: "UNVERIFIED_HISTORY_USED",
        severity: "WARNING",
        message: "Repeat-centre exclusion used unverified historical data (OQ-013)",
      });
    }
  }

  // Independently enforce the current-school block, including missing block data.
  const school = schoolById.get(teacher.schoolId);
  if (!school?.blockId?.trim() || !centre.blockId?.trim() || school.blockId !== centre.blockId) {
    hardReasons.push({ ruleCode: "RULE-THEORY-BLOCK", severity: "ERROR",
      message: "Staff member's current school and the centre must have the same saved block." });
  }

  const allowedDesignations = roleBand(requirement, designationBand);
  if (
    (designationBand === "fallback" && allowedDesignations.length === 0) ||
    (allowedDesignations.length > 0 && !allowedDesignations.includes(requirement.officeStaffPost ? officePost(teacher.designation) ?? "" : teacher.designation))
  ) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-ROLE",
      severity: "ERROR",
      message: `Designation ${teacher.designation} not in band [${allowedDesignations.join(", ")}]`,
    });
  }

  return {
    eligible: hardReasons.length === 0,
    hardReasons,
    warnings,
  };
}
