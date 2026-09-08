import type {
  Centre,
  DutyCalendarEvent,
  HistoricalDuty,
  RuleParameters,
  School,
  SessionCode,
  Teacher,
  TeacherExemption,
} from "@exam-duty/shared";
import { haversineKm, roundKm } from "@exam-duty/shared";

export const HALL_ALGORITHM_VERSION = "hall-1.0.0";

export interface HallCentreDemand {
  centreId: string;
  totalStudents: number;
  examDate: string;
  sessionCode: SessionCode;
}

export interface HallDataset {
  teachers: Teacher[];
  schools: School[];
  centres: Centre[];
  exemptions: TeacherExemption[];
  history: HistoricalDuty[];
  calendar: DutyCalendarEvent[];
  academicYear: string;
  asOfDate: string;
  /** School ids linked to centre (own/clubbed) */
  centreSchoolIds: Map<string, Set<string>>;
}

export interface HallAssignment {
  centreId: string;
  examDate: string;
  sessionCode: SessionCode;
  roleCode: "HALL_INVIGILATOR" | "HALL_STANDBY";
  slotIndex: number;
  teacherId: string;
  employeeCode: string;
  score: number;
}

export interface HallResult {
  algorithmVersion: string;
  requiredHallsByCentre: Record<string, number>;
  standbyByCentre: Record<string, number>;
  assignments: HallAssignment[];
  shortages: Array<{
    centreId: string;
    required: number;
    eligible: number;
    shortage: number;
    message: string;
  }>;
  feasible: boolean;
}

export function calculateHallRequirements(
  totalStudents: number,
  studentsPerHall: number,
  standbyPercentage: number,
): { requiredHalls: number; standby: number } {
  const requiredHalls = Math.ceil(totalStudents / Math.max(studentsPerHall, 1));
  const standby = Math.ceil((requiredHalls * standbyPercentage) / 100);
  return { requiredHalls, standby };
}

function yearNum(y: string): number {
  const m = y.match(/(\d{4})/);
  return m ? Number(m[1]) : NaN;
}

export function allocateHall(
  demands: HallCentreDemand[],
  dataset: HallDataset,
  rules: RuleParameters,
): HallResult {
  const schoolById = new Map(dataset.schools.map((s) => [s.schoolId, s]));
  const centreById = new Map(dataset.centres.map((c) => [c.centreId, c]));
  const occupied = new Set<string>();
  const assigned = new Set<string>();
  const assignments: HallAssignment[] = [];
  const shortages: HallResult["shortages"] = [];
  const requiredHallsByCentre: Record<string, number> = {};
  const standbyByCentre: Record<string, number> = {};

  const sorted = [...demands].sort((a, b) =>
    `${a.centreId}|${a.examDate}|${a.sessionCode}`.localeCompare(
      `${b.centreId}|${b.examDate}|${b.sessionCode}`,
    ),
  );

  for (const demand of sorted) {
    const { requiredHalls, standby } = calculateHallRequirements(
      demand.totalStudents,
      rules.students_per_hall,
      rules.standby_percentage,
    );
    requiredHallsByCentre[demand.centreId] = requiredHalls;
    standbyByCentre[demand.centreId] = standby;
    const centre = centreById.get(demand.centreId);
    if (!centre) {
      shortages.push({
        centreId: demand.centreId,
        required: requiredHalls + standby,
        eligible: 0,
        shortage: requiredHalls + standby,
        message: "NO FEASIBLE ALLOCATION — unknown centre",
      });
      continue;
    }

    const need: Array<{ role: "HALL_INVIGILATOR" | "HALL_STANDBY"; idx: number }> = [];
    for (let i = 0; i < requiredHalls; i++) need.push({ role: "HALL_INVIGILATOR", idx: i + 1 });
    for (let i = 0; i < standby; i++) need.push({ role: "HALL_STANDBY", idx: i + 1 });

    const clubbed = dataset.centreSchoolIds.get(demand.centreId) ?? new Set();
    const cy = yearNum(dataset.academicYear);

    const eligible = dataset.teachers.filter((t) => {
      if (!t.isActive || assigned.has(t.teacherId)) return false;
      if (
        dataset.exemptions.some(
          (e) =>
            e.teacherId === t.teacherId &&
            e.isExempted &&
            e.effectiveFrom <= dataset.asOfDate &&
            (!e.effectiveTo || e.effectiveTo >= dataset.asOfDate),
        )
      )
        return false;
      if (
        rules.hall_designation_allowlist.length > 0 &&
        !rules.hall_designation_allowlist.includes(t.designation)
      )
        return false;
      if (clubbed.has(t.schoolId)) return false;
      if (
        occupied.has(`${t.teacherId}|${demand.examDate}|${demand.sessionCode}`) ||
        dataset.calendar.some(
          (c) =>
            c.teacherId === t.teacherId &&
            c.date === demand.examDate &&
            c.session === demand.sessionCode,
        )
      )
        return false;

      // repeat centre
      for (const h of dataset.history) {
        if (h.teacherId !== t.teacherId || h.centreId !== demand.centreId) continue;
        const hy = yearNum(h.academicYear);
        if (!Number.isNaN(cy) && !Number.isNaN(hy) && hy < cy && hy >= cy - rules.repeat_years) {
          return false;
        }
      }

      // distance
      const school = schoolById.get(t.schoolId);
      let home: number | null = null;
      let sch: number | null = null;
      if (
        centre.latitude != null &&
        centre.longitude != null &&
        t.homeLatitude != null &&
        t.homeLongitude != null
      ) {
        home = roundKm(
          haversineKm(t.homeLatitude, t.homeLongitude, centre.latitude, centre.longitude),
        );
      }
      if (
        centre.latitude != null &&
        centre.longitude != null &&
        school?.latitude != null &&
        school.longitude != null
      ) {
        sch = roundKm(
          haversineKm(school.latitude, school.longitude, centre.latitude, centre.longitude),
        );
      }
      const max = rules.maximum_distance_km;
      const ok =
        (home != null && home <= max) || (sch != null && sch <= max);
      if (!ok) return false;
      return true;
    });

    eligible.sort((a, b) => {
      const score = (t: Teacher) => {
        let recent = 0;
        for (const h of dataset.history) {
          if (h.teacherId === t.teacherId) recent += 1;
        }
        return recent + (t.seniorityRank ?? 9999) * 0.0001;
      };
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa - sb;
      return a.employeeCode.localeCompare(b.employeeCode);
    });

    if (eligible.length < need.length) {
      shortages.push({
        centreId: demand.centreId,
        required: need.length,
        eligible: eligible.length,
        shortage: need.length - eligible.length,
        message: "NO FEASIBLE ALLOCATION",
      });
      // Assign what we can without forcing beyond eligible
    }

    const take = Math.min(eligible.length, need.length);
    for (let i = 0; i < take; i++) {
      const t = eligible[i]!;
      const n = need[i]!;
      assignments.push({
        centreId: demand.centreId,
        examDate: demand.examDate,
        sessionCode: demand.sessionCode,
        roleCode: n.role,
        slotIndex: n.idx,
        teacherId: t.teacherId,
        employeeCode: t.employeeCode,
        score: i,
      });
      assigned.add(t.teacherId);
      occupied.add(`${t.teacherId}|${demand.examDate}|${demand.sessionCode}`);
    }
  }

  return {
    algorithmVersion: HALL_ALGORITHM_VERSION,
    requiredHallsByCentre,
    standbyByCentre,
    assignments,
    shortages,
    feasible: shortages.length === 0,
  };
}
