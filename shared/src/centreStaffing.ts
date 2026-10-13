import type {
  Centre,
  CentreSchoolRelationship,
  ExamTimetableEntry,
  RuleParameters,
} from "./types.js";

export type CentreStaffingRequirement = {
  requirementKey: string;
  centreId: string;
  roleCode: "CHIEF_EXAMINATION" | "DEPARTMENT_OFFICER" | "OFFICE_STAFF" | "CUSTODIAN";
  examDate: string;
  sessionCode: "MORNING" | "AFTERNOON";
  preferredDesignations: string[];
  fallbackDesignations: string[];
  staffCategory?: "TEACHING" | "NON_TEACHING";
  continuityKey?: string;
  requiredSchoolLevel?: "HIGHER_SECONDARY";
  seniorityByJoiningDate?: boolean;
  officeStaffPost?: "JUNIOR_ASSISTANT" | "OFFICE_ASSISTANT";
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
  standard?: string;
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
        preferredDesignations: input.standard === "12" ? ["HM", "PRINCIPAL"] : input.rules.chief_preferred_designations,
        fallbackDesignations: input.standard === "12" ? [] : includeOfficialPgRoster(input.rules.chief_fallback_designations),
        continuityKey: `${centre.centreId}|CHIEF_EXAMINATION`,
        ...(input.standard === "12" ? { requiredSchoolLevel: "HIGHER_SECONDARY" as const } : {}),
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
          seniorityByJoiningDate: true,
          preferredDesignations: ["SENIOR_PG", "PG"],
          fallbackDesignations: [],
          staffCategory: "TEACHING",
        });
      }
      for (let index = 1; index <= 2; index += 1) {
        requirements.push({
          requirementKey: `${sessionKey}|OFFICE_STAFF|${index}`,
          ...common,
          roleCode: "OFFICE_STAFF",
          officeStaffPost: index === 1 ? "JUNIOR_ASSISTANT" : "OFFICE_ASSISTANT",
          preferredDesignations: [index === 1 ? "JUNIOR_ASSISTANT" : "OFFICE_ASSISTANT"],
          fallbackDesignations: index === 2 ? ["RECORD_CLERK"] : [],
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

/** Several subjects at one centre/session still need just one hall staffing set. */
export function buildHallDemands(input:{timetable:ExamTimetableEntry[];centres:Centre[];relationships:CentreSchoolRelationship[]}) {
  const demands=new Map<string,{centreId:string;totalStudents:number;examDate:string;sessionCode:"MORNING"|"AFTERNOON"; subjects:string[]}>();
  for(const entry of input.timetable.filter(e=>e.requiresHall))for(const centre of input.centres){
    if(!centre.active||!centreAppliesToSession(centre.centreId,entry,input.relationships))continue;
    const key=`${centre.centreId}|${entry.examDate}|${entry.sessionCode}`;
    const previous=demands.get(key);
    demands.set(key,{centreId:centre.centreId,totalStudents:centre.capacity??0,examDate:entry.examDate,sessionCode:entry.sessionCode,subjects:[...new Set([...(previous?.subjects ?? []),entry.subjectLabel])]});
  }
  return [...demands.values()];
}

export function buildCustodianRequirements(plans:Array<{centreId:string;schoolIds:string[];count:number}>, timetable:ExamTimetableEntry[]):CentreStaffingRequirement[] {
  const sessions=new Map(timetable.filter(t=>t.requiresChief).map(t=>[`${t.examDate}|${t.sessionCode}`,t]));
  return plans.flatMap(p=>[...sessions.values()].flatMap(s=>Array.from({length:p.count},(_,i)=>({requirementKey:`${p.centreId}|${s.examDate}|${s.sessionCode}|CUSTODIAN|${i+1}`,centreId:p.centreId,roleCode:"CUSTODIAN" as const,examDate:s.examDate,sessionCode:s.sessionCode,preferredDesignations:["PG","SENIOR_PG","BT"],fallbackDesignations:[],staffCategory:"TEACHING" as const}))));
}
