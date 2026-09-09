export type Role = "ADMIN" | "OFFICER" | "DATA_OPERATOR" | "VIEWER";

export type ExamCycleStatus =
  | "DRAFT"
  | "OPEN"
  | "ALLOCATION_GENERATED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "LOCKED"
  | "ARCHIVED";

export type DataQuality =
  | "Confirmed"
  | "Unverified"
  | "Imported"
  | "ManuallyCorrected"
  | "Derived";

export type SessionCode = "MORNING" | "AFTERNOON";

/** One officer-entered examination session used to create duty slots. */
export interface ExamTimetableEntry {
  timetableEntryId: string;
  examDate: string;
  sessionCode: SessionCode;
  subjectLabel: string;
  requiresChief: boolean;
  requiresHall: boolean;
  notes?: string | null;
}

export type DutyModule = "THEORY" | "PRACTICAL" | "HALL" | "COMBINED";

export type ValidationStatus = "VALID" | "VALID_WITH_WARNINGS" | "INVALID" | "PENDING";

export type Severity = "INFO" | "WARNING" | "ERROR";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RuleParameters {
  maximum_distance_km: number;
  /** Provisional: HOME_OR_SCHOOL — see OQ-001 */
  distance_policy: "HOME_OR_SCHOOL" | "HOME_ONLY" | "SCHOOL_ONLY";
  repeat_years: number;
  students_per_hall: number;
  standby_percentage: number;
  practical_batch_size: number;
  practical_completion_days: number;
  fairness_window_days: number;
  seniority_mode: "district" | "block" | "school" | "block_then_district";
  block_priority_mode: string;
  designation_priority_order: string[];
  hm_fallback_designations: string[];
  chief_preferred_designations: string[];
  chief_fallback_designations: string[];
  scoring_weights: ScoringWeights;
  /** Provisional soft — see OQ-008 */
  role_switch_mode: "soft" | "hard";
  hall_designation_allowlist: string[];
  missing_coordinates_policy: "INELIGIBLE" | "WARN";
}

export interface ScoringWeights {
  recent_duty: number;
  repeated_duty: number;
  distance: number;
  workload: number;
  role_balance: number;
}

export const DEFAULT_RULE_PARAMETERS: RuleParameters = {
  maximum_distance_km: 10,
  distance_policy: "HOME_OR_SCHOOL",
  repeat_years: 2,
  students_per_hall: 20,
  standby_percentage: 10,
  practical_batch_size: 50,
  practical_completion_days: 3,
  fairness_window_days: 365,
  seniority_mode: "block_then_district",
  block_priority_mode: "none",
  designation_priority_order: ["HM", "PRINCIPAL", "SENIOR_PG", "PG"],
  hm_fallback_designations: ["SENIOR_PG"],
  chief_preferred_designations: ["PRINCIPAL", "HM"],
  chief_fallback_designations: ["SENIOR_PG"],
  scoring_weights: {
    recent_duty: 5,
    repeated_duty: 3,
    distance: 1,
    workload: 2,
    role_balance: 1,
  },
  role_switch_mode: "soft",
  hall_designation_allowlist: [],
  missing_coordinates_policy: "INELIGIBLE",
};

export interface Teacher {
  teacherId: string;
  employeeCode: string;
  name: string;
  schoolId: string;
  designation: string;
  subject?: string | null;
  seniorityRank?: number | null;
  joiningDate?: string | null;
  homeLatitude?: number | null;
  homeLongitude?: number | null;
  isActive: boolean;
  dataQuality: DataQuality;
  blockId?: string;
}

export interface School {
  schoolId: string;
  schoolCode: string;
  schoolName: string;
  blockId: string;
  latitude?: number | null;
  longitude?: number | null;
  active: boolean;
}

export interface Centre {
  centreId: string;
  centreCode: string;
  centreName: string;
  blockId: string;
  latitude?: number | null;
  longitude?: number | null;
  capacity?: number | null;
  active: boolean;
}

export interface CentreSchoolRelationship {
  centreId: string;
  schoolId: string;
  relationshipType: "HOST" | "CLUBBED";
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface TeacherExemption {
  /** D1 `teacher_exemptions.id` when the row was hydrated or just saved. */
  id?: string;
  teacherId: string;
  isExempted: boolean;
  reason: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface HistoricalDuty {
  teacherId: string;
  centreId?: string | null;
  schoolId?: string | null;
  dutyTypeCode: string;
  roleCode?: string | null;
  examDate: string;
  sessionCode: SessionCode;
  subjectId?: string | null;
  academicYear: string;
  dataQuality?: DataQuality;
}

export interface DutyCalendarEvent {
  teacherId: string;
  date: string;
  session: SessionCode;
  dutyType: string;
  locationId?: string | null;
  role?: string | null;
}

export interface ExaminerPairHistory {
  teacherAId: string;
  teacherBId: string;
  subjectId: string;
  schoolId: string;
  academicYear: string;
  internalTeacherId: string;
  externalTeacherId: string;
}

export interface DecisionReason {
  ruleCode: string;
  severity: Severity;
  message: string;
  details?: Record<string, unknown>;
}

export interface DecisionTrace {
  teacherId: string;
  targetId: string;
  eligibility: "PASS" | "FAIL";
  reasons: DecisionReason[];
  score?: number;
  selectedBecause?: string;
}

export interface ShortageReport {
  requirementKey: string;
  required: number;
  eligible: number;
  shortage: number;
  exclusionTallies: Record<string, number>;
  message: string;
}
