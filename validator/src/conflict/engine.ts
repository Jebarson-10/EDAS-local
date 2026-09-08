import type { DutyCalendarEvent, SessionCode } from "@exam-duty/shared";

export interface NormalizedDutyEvent {
  teacherId: string;
  date: string;
  session: SessionCode;
  dutyType: string;
  locationId?: string | null;
  role?: string | null;
  sourceId?: string;
}

export interface ConflictFinding {
  ruleCode: string;
  severity: "ERROR" | "WARNING";
  message: string;
  teacherId: string;
  date: string;
  session: SessionCode;
  duties: string[];
}

/** Independent central conflict check across all modules. */
export function detectSessionConflicts(
  events: NormalizedDutyEvent[],
  existingCalendar: DutyCalendarEvent[] = [],
): ConflictFinding[] {
  const findings: ConflictFinding[] = [];
  const map = new Map<string, NormalizedDutyEvent[]>();

  const add = (e: NormalizedDutyEvent) => {
    const key = `${e.teacherId}|${e.date}|${e.session}`;
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  };

  for (const e of existingCalendar) {
    add({
      teacherId: e.teacherId,
      date: e.date,
      session: e.session,
      dutyType: e.dutyType,
      locationId: e.locationId,
      role: e.role,
      sourceId: "calendar",
    });
  }
  for (const e of events) add(e);

  for (const [, list] of map) {
    if (list.length < 2) continue;
    const duties = list.map((d) => d.dutyType);
    // Same duty duplicated still a conflict for distinct assignments
    findings.push({
      ruleCode: "RULE-CONFLICT-SESSION",
      severity: "ERROR",
      message: "Teacher has multiple duties in the same date and session",
      teacherId: list[0]!.teacherId,
      date: list[0]!.date,
      session: list[0]!.session,
      duties,
    });
  }
  return findings;
}
