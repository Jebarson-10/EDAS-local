import {
  assignmentsToCalendarEvents,
  latestRunForModuleInCycle,
  mergeCalendarEvents,
  practicalSchedulesToCalendarEvents,
  type DutyCalendarEvent,
} from "@exam-duty/shared";
import type { AllocationRunRecord } from "../state/AppContext";

/**
 * Duties already decided by the *other* modules of this exam cycle.
 *
 * Without it every module allocates as if the others do not exist, so the same
 * teacher can be a chief examiner and an invigilator in one session. Only the
 * latest run of each other module on this cycle counts — a leftover published
 * or INVALID run from the previous cycle must not occupy the amendment
 * calendar (noted against OQ-009). The module being generated is skipped
 * because a re-run replaces its own assignments rather than competing with
 * them.
 */
export function crossModuleCalendar(
  runs: AllocationRunRecord[],
  excludeModule: AllocationRunRecord["module"],
  examCycleId: string,
): DutyCalendarEvent[] {
  const groups: DutyCalendarEvent[][] = [];
  for (const module of ["THEORY", "PRACTICAL", "HALL"] as const) {
    if (module === excludeModule) continue;
    const run = latestRunForModuleInCycle(runs, module, examCycleId);
    if (!run?.result) continue;
    const result = run.result as {
      assignments?: Array<{
        teacherId: string;
        examDate: string;
        sessionCode: "MORNING" | "AFTERNOON";
        roleCode?: string;
        centreId?: string;
      }>;
      schedules?: Array<{
        schoolId: string;
        examDate: string;
        sessionCode: "MORNING" | "AFTERNOON";
        internalExaminerId: string;
        externalExaminerId: string;
      }>;
    };
    if (result.assignments?.length) {
      groups.push(assignmentsToCalendarEvents(result.assignments));
    }
    if (result.schedules?.length) {
      groups.push(practicalSchedulesToCalendarEvents(result.schedules));
    }
  }
  return mergeCalendarEvents(...groups);
}
