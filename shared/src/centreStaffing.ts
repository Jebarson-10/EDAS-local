import type {
  Centre,
  CentreSchoolRelationship,
  ExamTimetableEntry,
  RuleParameters,
} from "./types.js";

export type CentreStaffingRequirement = {
  requirementKey: string;
  centreId: string;
  roleCode: "CHIEF_EXAMINATION" | "DEPARTMENT_OFFICER" | "OFFICE_STAFF";
  examDate: string;
  sessionCode: "MORNING" | "AFTERNOON";
  preferredDesignations: string[];
  fallbackDesignations: string[];
  staffCategory?: "TEACHING" | "NON_TEACHING";
};

export type CentreStaffingPlan = {
  requirements: CentreStaffingRequirement[];
  missingStudentStrengthCentreIds: string[];
  centreSessions: number;
};

function centreAppliesToSession(
  centreId: string,
  entry: ExamTimetableEntry,
  relationships: CentreSchoolRelationship[],
): boolean {
  if (!entry.schoolId) return true;
  return relationships.some(
    (relationship) =>
      relationship.centreId === centreId &&
      relationship.schoolId === entry.schoolId &&
      relationship.effectiveFrom <= entry.examDate &&
      (!relationship.effectiveTo || relationship.effectiveTo >= entry.examDate),
  );
}

/**
 * The official FORM-02 roster calls the post simply "PG". In this app,
 * "Senior PG" means the senior eligible members of that roster, not a
 * separate source sheet, so retain either stored spelling in the same pool.
 */
function includeOfficialPgRoster(designations: string[]): string[] {
  return designations.includes("SENIOR_PG") && !designations.includes("PG")
    ? [...designations, "PG"]
    : designations;
}

/**
 * Creates one centre staffing set for each centre/date/session. Subject rows
 * in the same timetable session never duplicate centre-level duties.
 */
export function buildCentreStaffingRequirements(input: {
  timetable: ExamTimetableEntry[];
  centres: Centre[];
  relationships: CentreSchoolRelationship[];
  rules: RuleParameters;
}): CentreStaffingPlan {
  const requirements: CentreStaffingRequirement[] = [];
  const missingStudentStrengthCentreIds = new Set<string>();
  const seen = new Set<string>();

  for (const entry of input.timetable) {
    if (!entry.requiresChief) continue;
    for (const centre of input.centres) {
      if (!centre.active || !centreAppliesToSession(centre.centreId, entry, input.relationships)) {
        continue;
      }
      const sessionKey = `${centre.centreId}|${entry.examDate}|${entry.sessionCode}`;
      if (seen.has(sessionKey)) continue;
      seen.add(sessionKey);

      const common = {
        centreId: centre.centreId,
        examDate: entry.examDate,
        sessionCode: entry.sessionCode,
      } as const;
      requirements.push({
        requirementKey: `${sessionKey}|CHIEF_EXAMINATION`,
        ...common,
        roleCode: "CHIEF_EXAMINATION",
        preferredDesignations: input.rules.chief_preferred_designations,
        fallbackDesignations: includeOfficialPgRoster(
          input.rules.chief_fallback_designations,
        ),
        staffCategory: "TEACHING",
      });

      const studentStrength = centre.capacity;
      if (
        typeof studentStrength !== "number" ||
        !Number.isInteger(studentStrength) ||
        studentStrength <= 0
      ) {
        missingStudentStrengthCentreIds.add(centre.centreId);
        continue;
      }
      const departmentCount =
        studentStrength > input.rules.department_officer_second_threshold ? 2 : 1;
      for (let index = 1; index <= departmentCount; index += 1) {
        requirements.push({
          requirementKey: `${sessionKey}|DEPARTMENT_OFFICER|${index}`,
          ...common,
          roleCode: "DEPARTMENT_OFFICER",
          preferredDesignations: ["SENIOR_PG", "PG"],
          fallbackDesignations: [],
          staffCategory: "TEACHING",
        });
      }
      for (let index = 1; index <= input.rules.office_staff_per_centre; index += 1) {
        requirements.push({
          requirementKey: `${sessionKey}|OFFICE_STAFF|${index}`,
          ...common,
          roleCode: "OFFICE_STAFF",
          preferredDesignations: [],
          fallbackDesignations: [],
          staffCategory: "NON_TEACHING",
        });
      }
    }
  }

  return {
    requirements,
    missingStudentStrengthCentreIds: [...missingStudentStrengthCentreIds].sort(),
    centreSessions: seen.size,
  };
}

/** Number required by the confirmed one-custodian-per-N-schools planning rule. */
export function calculateCustodianRequirementCount(
  schoolCount: number,
  schoolsPerCustodian: number,
): number {
  if (!Number.isInteger(schoolCount) || schoolCount < 0) return 0;
  if (!Number.isInteger(schoolsPerCustodian) || schoolsPerCustodian <= 0) return 0;
  return Math.ceil(schoolCount / schoolsPerCustodian);
}
