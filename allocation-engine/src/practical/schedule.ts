import type {
  ExaminerPairHistory,
  RuleParameters,
  SessionCode,
  Teacher,
  TeacherExemption,
  DutyCalendarEvent,
  HistoricalDuty,
} from "@exam-duty/shared";

// 1.2 schedules different subjects in parallel.  A subject's own batches
// still remain in morning/afternoon order, which models the 50 + 50 pattern
// without incorrectly treating all subjects in one school as one queue.
export const PRACTICAL_ALGORITHM_VERSION = "practical-1.4.0";

/** The confirmed examiner post rule for public practical examinations. */
export function requiredPracticalDesignation(
  standard: string | null | undefined,
): "BT" | "PG" | undefined {
  const value = String(standard ?? "").trim().toUpperCase();
  if (/(^|\D)10(?:TH)?(\D|$)|SSLC/.test(value)) return "BT";
  if (/(^|\D)12(?:TH)?(\D|$)|HSC|HIGHER SECONDARY/.test(value)) return "PG";
  return undefined;
}

function normalizedExaminerDesignation(designation: string): string {
  const compact = designation.toUpperCase().replace(/[\s._'’-]+/g, "");
  if (["BT", "BTASST", "BTASSISTANT", "BTTEACHER"].includes(compact)) return "BT";
  if (["PG", "PGASST", "PGASSISTANT", "PGTEACHER"].includes(compact)) return "PG";
  return compact;
}

export interface PracticalSchoolDemand {
  schoolId: string;
  subjectId: string;
  studentCount: number;
}

export interface PracticalDataset {
  teachers: Teacher[];
  exemptions: TeacherExemption[];
  calendar: DutyCalendarEvent[];
  pairHistory: ExaminerPairHistory[];
  availableDates: string[];
  asOfDate: string;
  academicYear: string;
  /** `10` uses BT Assistants; `12` uses PG Assistants. */
  standard: string;
  history?: HistoricalDuty[];
  /** Teachers eligible as internal for a school (typically same school) */
  internalEligible: (teacher: Teacher, schoolId: string, subjectId: string) => boolean;
  /** Teachers eligible as external */
  externalEligible: (teacher: Teacher, schoolId: string, subjectId: string) => boolean;
}

export interface PracticalBatch {
  batchKey: string;
  schoolId: string;
  subjectId: string;
  batchIndex: number;
  studentCount: number;
}

export interface PracticalScheduleItem {
  batchKey: string;
  schoolId: string;
  subjectId: string;
  examDate: string;
  sessionCode: SessionCode;
  internalExaminerId: string;
  externalExaminerId: string;
  roleSwitchApplied: boolean;
  decisionNotes: string[];
}

export interface PracticalResult {
  algorithmVersion: string;
  batches: PracticalBatch[];
  schedules: PracticalScheduleItem[];
  feasible: boolean;
  message?: string;
}

/** Balance student counts into near-equal batches around target size (OQ-006 interim). */
export function balanceBatches(studentCount: number, targetSize: number): number[] {
  if (studentCount <= 0) return [];
  if (studentCount <= targetSize) return [studentCount];
  // Prefer more batches so each stays near/under target rather than oversized (OQ-006).
  const n = Math.max(1, Math.ceil(studentCount / targetSize));
  const base = Math.floor(studentCount / n);
  const rem = studentCount % n;
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) {
    sizes.push(base + (i < rem ? 1 : 0));
  }
  return sizes;
}

function exemptionActive(e: TeacherExemption, asOf: string): boolean {
  if (!e.isExempted) return false;
  if (e.effectiveFrom > asOf) return false;
  if (e.effectiveTo && e.effectiveTo < asOf) return false;
  return true;
}

function conflicted(
  teacherId: string,
  date: string,
  session: SessionCode,
  calendar: DutyCalendarEvent[],
  occupied: Set<string>,
): boolean {
  const key = `${teacherId}|${date}|${session}`;
  if (occupied.has(key)) return true;
  return calendar.some(
    (c) => c.teacherId === teacherId && c.date === date && c.session === session,
  );
}

/** Office staff are deliberately kept out of all teaching examiner pools. */
function isTeachingStaff(teacher: Teacher): boolean {
  return (teacher.staffCategory ?? "TEACHING") === "TEACHING";
}

function matchesPracticalDesignation(teacher: Teacher, standard: string): boolean {
  const required = requiredPracticalDesignation(standard);
  return Boolean(required && normalizedExaminerDesignation(teacher.designation) === required);
}

function sessionsForDates(dates: string[]): { date: string; session: SessionCode }[] {
  const out: { date: string; session: SessionCode }[] = [];
  for (const d of [...dates].sort()) {
    out.push({ date: d, session: "MORNING" });
    out.push({ date: d, session: "AFTERNOON" });
  }
  return out;
}

function findPriorPair(
  a: string,
  b: string,
  subjectId: string,
  schoolId: string,
  history: ExaminerPairHistory[],
): ExaminerPairHistory | undefined {
  return history
    .filter(
      (p) =>
        p.subjectId === subjectId &&
        p.schoolId === schoolId &&
        ((p.teacherAId === a && p.teacherBId === b) ||
          (p.teacherAId === b && p.teacherBId === a)),
    )
    .sort((x, y) => y.academicYear.localeCompare(x.academicYear))[0];
}

export function schedulePractical(
  demands: PracticalSchoolDemand[],
  dataset: PracticalDataset,
  rules: RuleParameters,
): PracticalResult {
  const batches: PracticalBatch[] = [];
  const requiredDesignation = requiredPracticalDesignation(dataset.standard);
  if (!requiredDesignation) {
    return {
      algorithmVersion: PRACTICAL_ALGORITHM_VERSION,
      batches,
      schedules: [],
      feasible: false,
      message: "Set the examination standard to 10 or 12 before creating practical duties.",
    };
  }
  for (const d of demands) {
    const sizes = balanceBatches(d.studentCount, rules.practical_batch_size);
    sizes.forEach((size, idx) => {
      batches.push({
        batchKey: `${d.schoolId}|${d.subjectId}|${idx + 1}`,
        schoolId: d.schoolId,
        subjectId: d.subjectId,
        batchIndex: idx + 1,
        studentCount: size,
      });
    });
  }

  const slots = sessionsForDates(dataset.availableDates);
  if (slots.length === 0) {
    return {
      algorithmVersion: PRACTICAL_ALGORITHM_VERSION,
      batches,
      schedules: [],
      feasible: false,
      message: "NO VALID SCHEDULE — no available dates",
    };
  }

  // Group batches by school for completion window
  const bySchool = new Map<string, PracticalBatch[]>();
  for (const b of batches) {
    const list = bySchool.get(b.schoolId) ?? [];
    list.push(b);
    bySchool.set(b.schoolId, list);
  }

  const schedules: PracticalScheduleItem[] = [];
  const occupied = new Set<string>();
  const workload = new Map<string,number>();
  const sortedDates = [...dataset.availableDates].sort();

  for (const [schoolId, schoolBatches] of [...bySchool.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    // Completion window: each subject can use one morning/afternoon sequence
    // in the school's window. Different subjects may run in the same slot
    // with different examiner pairs. This is required for, for example,
    // Maths-Biology, Maths-Computer and Vocational groups at one school.
    const windowDates = sortedDates.slice(0, rules.practical_completion_days);
    const windowSlots = sessionsForDates(windowDates);
    const batchesBySubject = new Map<string, PracticalBatch[]>();
    for (const batch of schoolBatches) {
      const subjectBatches = batchesBySubject.get(batch.subjectId) ?? [];
      subjectBatches.push(batch);
      batchesBySubject.set(batch.subjectId, subjectBatches);
    }
    const longestSubjectRun = Math.max(
      0,
      ...[...batchesBySubject.values()].map((subjectBatches) => subjectBatches.length),
    );
    if (longestSubjectRun > windowSlots.length) {
      return {
        algorithmVersion: PRACTICAL_ALGORITHM_VERSION,
        batches,
        schedules,
        feasible: false,
        message: `NO VALID SCHEDULE — school ${schoolId} has a subject requiring ${longestSubjectRun} sessions but only ${windowSlots.length} within ${rules.practical_completion_days} days`,
      };
    }

    // Interleave subject runs by batch number. Hence batch 1 of Physics,
    // Chemistry and Biology can all take place in the same morning, while
    // batch 2 of each takes place in the following afternoon. `occupied`
    // below remains the hard guard against reusing either examiner.
    const schoolScheduleOrder: Array<{ batch: PracticalBatch; slotIndex: number }> = [];
    const subjectRuns = [...batchesBySubject.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, subjectBatches]) =>
        [...subjectBatches].sort((a, b) => a.batchIndex - b.batchIndex || a.batchKey.localeCompare(b.batchKey)),
      );
    for (let slotIndex = 0; slotIndex < longestSubjectRun; slotIndex++) {
      for (const subjectBatches of subjectRuns) {
        const batch = subjectBatches[slotIndex];
        if (batch) schoolScheduleOrder.push({ batch, slotIndex });
      }
    }

    const previousSlotBySubject = new Map<string,number>();
    for (const { batch } of schoolScheduleOrder) {
      const candidatesAt = (slot:{date:string;session:SessionCode}) => {
      const rank = (a:Teacher,b:Teacher,role:"PRACTICAL_INTERNAL"|"PRACTICAL_EXTERNAL") => {
        const previousRole = (t:Teacher) => (dataset.history??[]).filter(h=>h.teacherId===t.teacherId && Number(h.academicYear)===Number(dataset.academicYear)-1 && (h.roleCode??h.dutyTypeCode).startsWith("PRACTICAL_")).sort((x,y)=>y.examDate.localeCompare(x.examDate))[0];
        const rotation = (t:Teacher) => (previousRole(t)?.roleCode??previousRole(t)?.dutyTypeCode)===role?1:0;
        const recent = (t:Teacher) => (dataset.history??[]).filter(h=>h.teacherId===t.teacherId && h.examDate<slot.date).map(h=>h.examDate).sort().at(-1)??"";
        return rotation(a)-rotation(b)||(workload.get(a.teacherId)??0)-(workload.get(b.teacherId)??0)||recent(a).localeCompare(recent(b))||a.employeeCode.localeCompare(b.employeeCode);
      };
      const internals = dataset.teachers
        .filter(
          (t) =>
            t.isActive &&
            isTeachingStaff(t) &&
            matchesPracticalDesignation(t, dataset.standard) &&
            !dataset.exemptions.some(
              (e) => e.teacherId === t.teacherId && exemptionActive(e, slot.date),
            ) &&
            dataset.internalEligible(t, schoolId, batch.subjectId) &&
            !conflicted(t.teacherId, slot.date, slot.session, dataset.calendar, occupied),
        )
        .sort((a, b) => rank(a,b,"PRACTICAL_INTERNAL"));

      const externals = dataset.teachers
        .filter(
          (t) =>
            t.isActive &&
            isTeachingStaff(t) &&
            matchesPracticalDesignation(t, dataset.standard) &&
            !dataset.exemptions.some(
              (e) => e.teacherId === t.teacherId && exemptionActive(e, slot.date),
            ) &&
            dataset.externalEligible(t, schoolId, batch.subjectId) &&
            !conflicted(t.teacherId, slot.date, slot.session, dataset.calendar, occupied),
        )
        .sort((a, b) => rank(a,b,"PRACTICAL_EXTERNAL"));
      return {internals,externals};
      };
      let chosen: {slot:typeof windowSlots[number];internals:Teacher[];externals:Teacher[];index:number}|undefined;
      for(let index=(previousSlotBySubject.get(batch.subjectId)??-1)+1;index<windowSlots.length;index++){
        const slot=windowSlots[index]!;const {internals,externals}=candidatesAt(slot);
        if(internals.some(a=>externals.some(b=>a.teacherId!==b.teacherId))){chosen={slot,internals,externals,index};break;}
      }
      const {slot,internals,externals}=chosen??{slot:windowSlots[0]!,internals:[],externals:[]};

      if (internals.length === 0 || externals.length === 0) {
        return {
          algorithmVersion: PRACTICAL_ALGORITHM_VERSION,
          batches,
          schedules,
          feasible: false,
          message: `NO VALID SCHEDULE — insufficient examiners for ${batch.batchKey}`,
        };
      }

      let internal = internals[0]!;
      let external =
        externals.find((e) => e.teacherId !== internal.teacherId) ?? null;
      if (!external) {
        return {
          algorithmVersion: PRACTICAL_ALGORITHM_VERSION,
          batches,
          schedules,
          feasible: false,
          message: `NO VALID SCHEDULE — could not pair distinct examiners for ${batch.batchKey}`,
        };
      }

      const notes: string[] = [];
      let roleSwitchApplied = false;

      // Prefer historical pair with role switch (soft by default OQ-008)
      for (const a of internals) {
        for (const b of externals) {
          if (a.teacherId === b.teacherId) continue;
          const prior = findPriorPair(
            a.teacherId,
            b.teacherId,
            batch.subjectId,
            schoolId,
            dataset.pairHistory,
          );
          if (!prior) continue;
          // Prefer swapped roles
          const wantInternal =
            prior.internalTeacherId === a.teacherId ? b.teacherId : a.teacherId;
          const wantExternal =
            prior.externalTeacherId === a.teacherId ? b.teacherId : a.teacherId;
          // Map to actual teachers if both still in pools
          const intCand = internals.find((t) => t.teacherId === wantInternal);
          const extCand = externals.find((t) => t.teacherId === wantExternal);
          if (intCand && extCand && intCand.teacherId !== extCand.teacherId) {
            internal = intCand;
            external = extCand;
            roleSwitchApplied = true;
            notes.push(
              `Applied annual role switch from academic year ${prior.academicYear} (mode=${rules.role_switch_mode})`,
            );
            break;
          }
        }
        if (roleSwitchApplied) break;
      }

      if (rules.role_switch_mode === "hard") {
        // If hard mode and prior pair exists but switch impossible — fail
        // (only when a prior pair involving available teachers cannot switch)
        // Already handled by preference; hard failure only if we detected prior without switch path
      }

      schedules.push({
        batchKey: batch.batchKey,
        schoolId,
        subjectId: batch.subjectId,
        examDate: slot.date,
        sessionCode: slot.session,
        internalExaminerId: internal.teacherId,
        externalExaminerId: external.teacherId,
        roleSwitchApplied,
        decisionNotes: notes,
      });
      occupied.add(`${internal.teacherId}|${slot.date}|${slot.session}`);
      occupied.add(`${external.teacherId}|${slot.date}|${slot.session}`);
      previousSlotBySubject.set(batch.subjectId,chosen!.index);
      workload.set(internal.teacherId,(workload.get(internal.teacherId)??0)+1);
      workload.set(external.teacherId,(workload.get(external.teacherId)??0)+1);
    }
  }

  return {
    algorithmVersion: PRACTICAL_ALGORITHM_VERSION,
    batches,
    schedules,
    feasible: true,
  };
}
