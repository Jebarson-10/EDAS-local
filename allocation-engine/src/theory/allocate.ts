import type {
  Centre,
  CentreSchoolRelationship,
  DecisionReason,
  DutyCalendarEvent,
  HistoricalDuty,
  RuleParameters,
  School,
  Teacher,
  TeacherExemption,
} from "@exam-duty/shared";
import { haversineKm, roundKm } from "@exam-duty/shared";

export const ALGORITHM_VERSION = "theory-1.1.0";

export interface TheoryRequirement {
  requirementKey: string;
  centreId: string;
  roleCode: string;
  examDate: string;
  sessionCode: "MORNING" | "AFTERNOON";
  /** Preferred designation band, e.g. HM */
  preferredDesignations: string[];
  /** Explicit fallback designations when preferred pool short — shown, never silent */
  fallbackDesignations: string[];
}

export interface TheoryDataset {
  teachers: Teacher[];
  schools: School[];
  centres: Centre[];
  relationships: CentreSchoolRelationship[];
  exemptions: TeacherExemption[];
  history: HistoricalDuty[];
  calendar: DutyCalendarEvent[];
  academicYear: string;
  asOfDate: string;
}

export interface CandidateEvaluation {
  teacherId: string;
  centreId: string;
  eligible: boolean;
  hardReasons: DecisionReason[];
  softNotes: DecisionReason[];
  distanceHomeKm: number | null;
  distanceSchoolKm: number | null;
  score: number;
  designation: string;
  employeeCode: string;
  usedFallbackBand: boolean;
}

export interface TheoryAssignment {
  requirementKey: string;
  centreId: string;
  roleCode: string;
  examDate: string;
  sessionCode: "MORNING" | "AFTERNOON";
  teacherId: string;
  employeeCode: string;
  score: number;
  usedFallbackBand: boolean;
  decisionTrace: {
    teacherId: string;
    targetId: string;
    eligibility: "PASS" | "FAIL";
    reasons: DecisionReason[];
    score: number;
    selectedBecause: string;
  };
}

export interface TheoryAllocationResult {
  algorithmVersion: string;
  assignments: TheoryAssignment[];
  shortages: Array<{
    requirementKey: string;
    required: number;
    eligible: number;
    shortage: number;
    exclusionTallies: Record<string, number>;
    message: string;
    hmRequirementMeta?: {
      preferredEligible: number;
      fallbackRequired: number;
      fallbackDesignations: string[];
    };
  }>;
  candidateMatrixSize: number;
  feasible: boolean;
}

function isExemptionActive(
  e: TeacherExemption,
  asOf: string,
): boolean {
  if (!e.isExempted) return false;
  if (e.effectiveFrom > asOf) return false;
  if (e.effectiveTo && e.effectiveTo < asOf) return false;
  return true;
}

function activeClubbedSchoolIds(
  centreId: string,
  relationships: CentreSchoolRelationship[],
  asOf: string,
): Set<string> {
  const set = new Set<string>();
  for (const r of relationships) {
    if (r.centreId !== centreId) continue;
    if (r.effectiveFrom > asOf) continue;
    if (r.effectiveTo && r.effectiveTo < asOf) continue;
    set.add(r.schoolId);
  }
  return set;
}

function indexHistory(history: HistoricalDuty[]): Map<string, HistoricalDuty[]> {
  const map = new Map<string, HistoricalDuty[]>();
  for (const h of history) {
    const list = map.get(h.teacherId) ?? [];
    list.push(h);
    map.set(h.teacherId, list);
  }
  return map;
}

function indexClubbing(
  relationships: CentreSchoolRelationship[],
  asOf: string,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const r of relationships) {
    if (r.effectiveFrom > asOf) continue;
    if (r.effectiveTo && r.effectiveTo < asOf) continue;
    const set = map.get(r.centreId) ?? new Set();
    set.add(r.schoolId);
    map.set(r.centreId, set);
  }
  return map;
}

function academicYearNumber(year: string): number {
  const m = year.match(/(\d{4})/);
  return m ? Number(m[1]) : Number.NaN;
}

function centresInLookback(
  teacherId: string,
  historyByTeacher: Map<string, HistoricalDuty[]>,
  currentYear: string,
  lookbackYears: number,
  modulePrefix = "THEORY",
): { centreId: string; academicYear: string; dataQuality?: string }[] {
  const cy = academicYearNumber(currentYear);
  const out: { centreId: string; academicYear: string; dataQuality?: string }[] = [];
  for (const h of historyByTeacher.get(teacherId) ?? []) {
    if (!h.centreId) continue;
    const isTheory =
      h.dutyTypeCode.includes("THEORY") ||
      h.dutyTypeCode === "CHIEF_EXAMINATION" ||
      h.dutyTypeCode === "DEPARTMENT_OFFICER" ||
      h.roleCode === "CHIEF_EXAMINATION" ||
      h.roleCode === "DEPARTMENT_OFFICER";
    if (modulePrefix === "THEORY" && !isTheory) continue;
    const hy = academicYearNumber(h.academicYear);
    if (Number.isNaN(cy) || Number.isNaN(hy)) continue;
    if (hy < cy && hy >= cy - lookbackYears) {
      out.push({
        centreId: h.centreId,
        academicYear: h.academicYear,
        dataQuality: h.dataQuality,
      });
    }
  }
  return out;
}

function hasSessionConflict(
  teacherId: string,
  date: string,
  session: string,
  calendar: DutyCalendarEvent[],
  occupied: Set<string>,
): boolean {
  const key = `${teacherId}|${date}|${session}`;
  if (occupied.has(key)) return true;
  return calendar.some(
    (e) => e.teacherId === teacherId && e.date === date && e.session === session,
  );
}

export function evaluateTheoryCandidate(
  teacher: Teacher,
  centre: Centre,
  schoolById: Map<string, School>,
  dataset: TheoryDataset,
  rules: RuleParameters,
  occupied: Set<string>,
  requirement: TheoryRequirement,
  designationBand: "preferred" | "fallback",
  fairnessByTeacher: Map<string, { recentPenalty: number; repeatedPenalty: number; lastDutyDate?: string }> = new Map(),
  historyByTeacher: Map<string, HistoricalDuty[]> = new Map(),
  clubbedByCentre: Map<string, Set<string>> = new Map(),
): CandidateEvaluation {
  const hardReasons: DecisionReason[] = [];
  const softNotes: DecisionReason[] = [];
  const school = schoolById.get(teacher.schoolId);

  if (!teacher.isActive) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-INACTIVE",
      severity: "ERROR",
      message: "Teacher is inactive",
    });
  }

  const exempt = dataset.exemptions.find(
    (e) => e.teacherId === teacher.teacherId && isExemptionActive(e, dataset.asOfDate),
  );
  if (exempt) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-EXEMPT",
      severity: "ERROR",
      message: `Teacher exempted: ${exempt.reason}`,
    });
  }

  if (
    hasSessionConflict(
      teacher.teacherId,
      requirement.examDate,
      requirement.sessionCode,
      dataset.calendar,
      occupied,
    )
  ) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-CONFLICT",
      severity: "ERROR",
      message: "Simultaneous duty conflict on date/session",
    });
  }

  const clubbed =
    clubbedByCentre.get(centre.centreId) ??
    activeClubbedSchoolIds(centre.centreId, dataset.relationships, dataset.asOfDate);
  if (clubbed.has(teacher.schoolId)) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-OWN-SCHOOL",
      severity: "ERROR",
      message: "Own-school / clubbed-school conflict (current school linked to centre)",
      details: { schoolId: teacher.schoolId, centreId: centre.centreId },
    });
  }

  const priorCentres = centresInLookback(
    teacher.teacherId,
    historyByTeacher.size ? historyByTeacher : indexHistory(dataset.history),
    dataset.academicYear,
    rules.repeat_years,
  );
  if (priorCentres.some((c) => c.centreId === centre.centreId)) {
    const hit = priorCentres.find((c) => c.centreId === centre.centreId)!;
    hardReasons.push({
      ruleCode: "RULE-THEORY-002",
      severity: "ERROR",
      message:
        "Teacher was assigned to the same centre during the configured previous-year exclusion window",
      details: { academicYear: hit.academicYear, dataQuality: hit.dataQuality },
    });
    if (hit.dataQuality === "Unverified") {
      softNotes.push({
        ruleCode: "UNVERIFIED_HISTORY_USED",
        severity: "WARNING",
        message: "Repeat-centre exclusion used unverified historical data (OQ-013)",
      });
    }
  }

  let distanceHomeKm: number | null = null;
  let distanceSchoolKm: number | null = null;
  const centreOk =
    centre.latitude != null &&
    centre.longitude != null &&
    Number.isFinite(centre.latitude) &&
    Number.isFinite(centre.longitude);

  if (!centreOk) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-DISTANCE",
      severity: "ERROR",
      message: "Centre coordinates missing",
    });
  } else {
    if (
      teacher.homeLatitude != null &&
      teacher.homeLongitude != null &&
      Number.isFinite(teacher.homeLatitude) &&
      Number.isFinite(teacher.homeLongitude)
    ) {
      distanceHomeKm = roundKm(
        haversineKm(
          teacher.homeLatitude,
          teacher.homeLongitude,
          centre.latitude!,
          centre.longitude!,
        ),
      );
    }
    if (
      school?.latitude != null &&
      school.longitude != null &&
      Number.isFinite(school.latitude) &&
      Number.isFinite(school.longitude)
    ) {
      distanceSchoolKm = roundKm(
        haversineKm(
          school.latitude,
          school.longitude,
          centre.latitude!,
          centre.longitude!,
        ),
      );
    }

    const max = rules.maximum_distance_km;
    let distanceOk = false;
    if (rules.distance_policy === "HOME_OR_SCHOOL") {
      distanceOk =
        (distanceHomeKm != null && distanceHomeKm <= max) ||
        (distanceSchoolKm != null && distanceSchoolKm <= max);
    } else if (rules.distance_policy === "HOME_ONLY") {
      distanceOk = distanceHomeKm != null && distanceHomeKm <= max;
    } else {
      distanceOk = distanceSchoolKm != null && distanceSchoolKm <= max;
    }

    if (distanceHomeKm == null && distanceSchoolKm == null) {
      if (rules.missing_coordinates_policy === "INELIGIBLE") {
        hardReasons.push({
          ruleCode: "RULE-THEORY-DISTANCE",
          severity: "ERROR",
          message: "MISSING_COORDINATES — cannot evaluate distance policy (OQ-001)",
        });
      }
    } else if (!distanceOk) {
      hardReasons.push({
        ruleCode: "RULE-THEORY-DISTANCE",
        severity: "ERROR",
        message: `Distance exceeds ${max} km under policy ${rules.distance_policy}`,
        details: { distanceHomeKm, distanceSchoolKm },
      });
    } else {
      softNotes.push({
        ruleCode: "INFO-DISTANCE",
        severity: "INFO",
        message: `Within ${max} km (home=${distanceHomeKm ?? "n/a"} school=${distanceSchoolKm ?? "n/a"})`,
      });
    }
  }

  const band =
    designationBand === "preferred"
      ? requirement.preferredDesignations
      : requirement.fallbackDesignations;
  if (!band.includes(teacher.designation)) {
    hardReasons.push({
      ruleCode: "RULE-THEORY-ROLE",
      severity: "ERROR",
      message: `Designation ${teacher.designation} not in band [${band.join(", ")}]`,
    });
  }

  // Soft fairness score
  const weights = rules.scoring_weights;
  const fairness = fairnessByTeacher.get(teacher.teacherId) ?? {
    recentPenalty: 0,
    repeatedPenalty: 0,
  };
  const recentPenalty = fairness.recentPenalty;
  const repeatedPenalty = fairness.repeatedPenalty;
  const minDist = Math.min(
    distanceHomeKm ?? Number.POSITIVE_INFINITY,
    distanceSchoolKm ?? Number.POSITIVE_INFINITY,
  );
  const distancePenalty =
    Number.isFinite(minDist) ? minDist / Math.max(rules.maximum_distance_km, 1) : 10;
  const seniority =
    teacher.seniorityRank == null ? 9999 : teacher.seniorityRank;
  const score =
    weights.recent_duty * recentPenalty +
    weights.repeated_duty * Math.min(repeatedPenalty, 5) +
    weights.distance * distancePenalty +
    weights.workload * 0 +
    weights.role_balance * (designationBand === "fallback" ? 2 : 0) +
    seniority * 0.0001;

  softNotes.push({
    ruleCode: "INFO-FAIRNESS",
    severity: "INFO",
    message: `Fairness uses last duty ${fairness.lastDutyDate ?? "none recorded"}; recency=${recentPenalty}, historyCount=${repeatedPenalty} (window=${rules.fairness_window_days}d)`,
  });

  return {
    teacherId: teacher.teacherId,
    centreId: centre.centreId,
    eligible: hardReasons.length === 0,
    hardReasons,
    softNotes,
    distanceHomeKm,
    distanceSchoolKm,
    score,
    designation: teacher.designation,
    employeeCode: teacher.employeeCode,
    usedFallbackBand: designationBand === "fallback",
  };
}

export function allocateTheory(
  requirements: TheoryRequirement[],
  dataset: TheoryDataset,
  rules: RuleParameters,
): TheoryAllocationResult {
  const schoolById = new Map(dataset.schools.map((s) => [s.schoolId, s]));
  const centreById = new Map(dataset.centres.map((c) => [c.centreId, c]));
  const occupied = new Set<string>();
  const assignedTeachers = new Set<string>();
  const assignments: TheoryAssignment[] = [];
  const shortages: TheoryAllocationResult["shortages"] = [];
  let matrixSize = 0;

  const fairnessByTeacher = new Map<
    string,
    { recentPenalty: number; repeatedPenalty: number; lastDutyDate?: string }
  >();
  const windowMs = rules.fairness_window_days * 86400000;
  const asOfMs = Date.parse(dataset.asOfDate);
  for (const h of dataset.history) {
    const cur = fairnessByTeacher.get(h.teacherId) ?? {
      recentPenalty: 0,
      repeatedPenalty: 0,
    };
    cur.repeatedPenalty += 1;
    const ht = Date.parse(h.examDate);
    if (!Number.isNaN(ht) && !Number.isNaN(asOfMs) && ht <= asOfMs) {
      if (!cur.lastDutyDate || h.examDate > cur.lastDutyDate) cur.lastDutyDate = h.examDate;
    }
    fairnessByTeacher.set(h.teacherId, cur);
  }
  for (const fairness of fairnessByTeacher.values()) {
    if (!fairness.lastDutyDate || Number.isNaN(asOfMs)) continue;
    const elapsed = Math.max(0, asOfMs - Date.parse(fairness.lastDutyDate));
    if (elapsed <= windowMs) {
      // A newer last duty receives the larger soft penalty. Teachers with no
      // duty, or a duty outside the configured window, get first consideration.
      fairness.recentPenalty = Math.max(1, Math.ceil((windowMs - elapsed) / 86_400_000));
    }
  }

  const historyByTeacher = indexHistory(dataset.history);
  const clubbedByCentre = indexClubbing(dataset.relationships, dataset.asOfDate);

  type Pool = {
    req: TheoryRequirement;
    centre: Centre | null;
    preferred: CandidateEvaluation[];
    preferredTallies: Record<string, number>;
    fallback: CandidateEvaluation[];
    fallbackTallies: Record<string, number>;
  };

  const pools: Pool[] = requirements.map((req) => {
    const centre = centreById.get(req.centreId) ?? null;
    const preferred: CandidateEvaluation[] = [];
    const preferredTallies: Record<string, number> = {};
    const fallback: CandidateEvaluation[] = [];
    const fallbackTallies: Record<string, number> = {};
    if (!centre) {
      return { req, centre, preferred, preferredTallies, fallback, fallbackTallies };
    }
    for (const t of dataset.teachers) {
      const pref = evaluateTheoryCandidate(
        t,
        centre,
        schoolById,
        dataset,
        rules,
        occupied,
        req,
        "preferred",
        fairnessByTeacher,
        historyByTeacher,
        clubbedByCentre,
      );
      matrixSize += 1;
      if (pref.eligible) preferred.push(pref);
      else {
        for (const r of pref.hardReasons) {
          preferredTallies[r.ruleCode] = (preferredTallies[r.ruleCode] ?? 0) + 1;
        }
      }
      if (req.fallbackDesignations.length > 0) {
        const fb = evaluateTheoryCandidate(
          t,
          centre,
          schoolById,
          dataset,
          rules,
          occupied,
          req,
          "fallback",
          fairnessByTeacher,
          historyByTeacher,
          clubbedByCentre,
        );
        if (fb.eligible) fallback.push(fb);
        else {
          for (const r of fb.hardReasons) {
            fallbackTallies[r.ruleCode] = (fallbackTallies[r.ruleCode] ?? 0) + 1;
          }
        }
      }
    }
    preferred.sort((a, b) =>
      a.score !== b.score
        ? a.score - b.score
        : a.employeeCode.localeCompare(b.employeeCode),
    );
    fallback.sort((a, b) =>
      a.score !== b.score
        ? a.score - b.score
        : a.employeeCode.localeCompare(b.employeeCode),
    );
    return { req, centre, preferred, preferredTallies, fallback, fallbackTallies };
  });

  pools.sort((a, b) => {
    if (a.preferred.length !== b.preferred.length) {
      return a.preferred.length - b.preferred.length;
    }
    return a.req.requirementKey.localeCompare(b.req.requirementKey);
  });

  for (const pool of pools) {
    const { req, centre } = pool;
    if (!centre) {
      shortages.push({
        requirementKey: req.requirementKey,
        required: 1,
        eligible: 0,
        shortage: 1,
        exclusionTallies: { UNKNOWN_CENTRE: 1 },
        message: "NO FEASIBLE ALLOCATION — centre not found",
      });
      continue;
    }

    const pick = (list: CandidateEvaluation[], blockFirst: boolean) => {
      const eligible = list.filter((c) => {
        if (assignedTeachers.has(c.teacherId)) return false;
        if (
          hasSessionConflict(
            c.teacherId,
            req.examDate,
            req.sessionCode,
            dataset.calendar,
            occupied,
          )
        )
          return false;
        return true;
      });
      // Senior PG fallback is block-first; the district pool is considered
      // only when that block cannot satisfy the requirement. Within either
      // pool the existing deterministic seniority/fairness ordering remains.
      if (blockFirst && rules.seniority_mode === "block_then_district") {
        const candidateBlockId = (candidate: CandidateEvaluation) => {
          const teacher = dataset.teachers.find(
            (item) => item.teacherId === candidate.teacherId,
          );
          return teacher ? schoolById.get(teacher.schoolId)?.blockId : undefined;
        };
        return (
          eligible.find(
            (candidate) => candidateBlockId(candidate) === centre.blockId,
          ) ?? eligible[0]
        );
      }
      return eligible[0];
    };

    let chosen = pick(pool.preferred, false);
    let usedFallback = false;
    let fallbackMeta:
      | {
          preferredEligible: number;
          fallbackRequired: number;
          fallbackDesignations: string[];
        }
      | undefined;

    const preferredRemaining = pool.preferred.filter(
      (c) => !assignedTeachers.has(c.teacherId),
    ).length;

    if (!chosen && req.fallbackDesignations.length > 0) {
      chosen = pick(pool.fallback, true);
      usedFallback = Boolean(chosen);
      fallbackMeta = {
        preferredEligible: preferredRemaining,
        fallbackRequired: 1,
        fallbackDesignations: req.fallbackDesignations,
      };
      if (!chosen) {
        shortages.push({
          requirementKey: req.requirementKey,
          required: 1,
          eligible:
            preferredRemaining +
            pool.fallback.filter((c) => !assignedTeachers.has(c.teacherId)).length,
          shortage: 1,
          exclusionTallies: { ...pool.preferredTallies, ...pool.fallbackTallies },
          message: "NO FEASIBLE ALLOCATION",
          hmRequirementMeta: {
            preferredEligible: preferredRemaining,
            fallbackRequired: 1,
            fallbackDesignations: req.fallbackDesignations,
          },
        });
        continue;
      }
    } else if (!chosen) {
      shortages.push({
        requirementKey: req.requirementKey,
        required: 1,
        eligible: 0,
        shortage: 1,
        exclusionTallies: pool.preferredTallies,
        message: "NO FEASIBLE ALLOCATION",
      });
      continue;
    }

    const teacher = dataset.teachers.find((t) => t.teacherId === chosen!.teacherId)!;
    const reasons = [...chosen.hardReasons, ...chosen.softNotes];
    const selectedSchool = schoolById.get(teacher.schoolId);
    if (
      usedFallback &&
      rules.seniority_mode === "block_then_district" &&
      selectedSchool?.blockId !== centre.blockId
    ) {
      reasons.unshift({
        ruleCode: "INFO-DISTRICT-FALLBACK",
        severity: "WARNING",
        message: "No eligible candidate in the centre block; selected from the district pool",
        details: { centreBlockId: centre.blockId, teacherBlockId: selectedSchool?.blockId },
      });
    }
    if (usedFallback) {
      reasons.unshift({
        ruleCode: "INFO-HM-FALLBACK",
        severity: "WARNING",
        message: `Preferred band shortage; used fallback designation ${teacher.designation}`,
        details: fallbackMeta,
      });
    }
    reasons.push({
      ruleCode: "INFO-SELECTED",
      severity: "INFO",
      message: "Selected because lowest eligible fairness score with deterministic tie-break",
    });

    assignments.push({
      requirementKey: req.requirementKey,
      centreId: req.centreId,
      roleCode: req.roleCode,
      examDate: req.examDate,
      sessionCode: req.sessionCode,
      teacherId: teacher.teacherId,
      employeeCode: teacher.employeeCode,
      score: chosen.score,
      usedFallbackBand: usedFallback || chosen.usedFallbackBand,
      decisionTrace: {
        teacherId: teacher.teacherId,
        targetId: req.centreId,
        eligibility: "PASS",
        reasons,
        score: chosen.score,
        selectedBecause: "lowest eligible fairness score",
      },
    });

    assignedTeachers.add(teacher.teacherId);
    occupied.add(`${teacher.teacherId}|${req.examDate}|${req.sessionCode}`);
  }

  return {
    algorithmVersion: ALGORITHM_VERSION,
    assignments,
    shortages,
    candidateMatrixSize: matrixSize,
    feasible: shortages.length === 0,
  };
}
