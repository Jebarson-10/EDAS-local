import type { DutyCalendarEvent, SessionCode } from "./types.js";

/**
 * Duty calendar assembly.
 *
 * The engines already refuse a teacher who is busy in `dataset.calendar` for a
 * date + session (OQ-009 interim: hard block every same-slot overlap), but the
 * calendar has to be handed to them. These mappers turn already-decided duties
 * of one module into the calendar the *other* modules must respect, so a
 * chief examiner is not also picked as an invigilator in the same session.
 *
 * Pure data shaping — no eligibility or scoring logic lives here.
 */

/** Theory / hall style assignments: one teacher holds one slot. */
export function assignmentsToCalendarEvents(
  assignments: Array<{
    teacherId: string;
    examDate: string;
    sessionCode: SessionCode;
    roleCode?: string | null;
    dutyTypeCode?: string | null;
    centreId?: string | null;
  }>,
): DutyCalendarEvent[] {
  return assignments.map((a) => ({
    teacherId: a.teacherId,
    date: a.examDate,
    session: a.sessionCode,
    dutyType: a.dutyTypeCode ?? a.roleCode ?? "DUTY",
    locationId: a.centreId ?? null,
    role: a.roleCode ?? null,
  }));
}

/** A practical batch occupies both examiners for the slot. */
export function practicalSchedulesToCalendarEvents(
  schedules: Array<{
    schoolId: string;
    examDate: string;
    sessionCode: SessionCode;
    internalExaminerId: string;
    externalExaminerId: string;
  }>,
): DutyCalendarEvent[] {
  const events: DutyCalendarEvent[] = [];
  for (const s of schedules) {
    events.push({
      teacherId: s.internalExaminerId,
      date: s.examDate,
      session: s.sessionCode,
      dutyType: "PRACTICAL_INTERNAL",
      locationId: s.schoolId,
      role: "PRACTICAL_INTERNAL",
    });
    events.push({
      teacherId: s.externalExaminerId,
      date: s.examDate,
      session: s.sessionCode,
      dutyType: "PRACTICAL_EXTERNAL",
      locationId: s.schoolId,
      role: "PRACTICAL_EXTERNAL",
    });
  }
  return events;
}

/**
 * Merge calendars from several modules, dropping exact duplicates and sorting
 * so the allocation input stays deterministic (AGENTS rule 6).
 */
export function mergeCalendarEvents(
  ...groups: DutyCalendarEvent[][]
): DutyCalendarEvent[] {
  const byKey = new Map<string, DutyCalendarEvent>();
  for (const group of groups) {
    for (const e of group) {
      const key = `${e.teacherId}|${e.date}|${e.session}|${e.dutyType}|${e.locationId ?? ""}`;
      if (!byKey.has(key)) byKey.set(key, e);
    }
  }
  return [...byKey.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, e]) => e);
}
