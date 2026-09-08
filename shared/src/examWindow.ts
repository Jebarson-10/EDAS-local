/**
 * Examination window helpers.
 *
 * `exam_cycles.start_date` / `end_date` are the only schedule facts an officer
 * supplies today. Which subject sits on which day and session is not specified
 * anywhere in the client material (see OQ-020), so nothing here derives a
 * timetable — these helpers only bound duty dates by the configured window and
 * fall back to the caller's synthetic default when it is unset.
 */

export interface ExamWindow {
  startDate?: string | null;
  endDate?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First duty date: the configured window start, else the caller's fallback. */
export function examWindowStart(window: ExamWindow, fallback: string): string {
  const start = window.startDate;
  return start && ISO_DATE.test(start) ? start : fallback;
}

/**
 * Date-input values for the cycle page. Mount-time `useState(cycle.startDate)`
 * stays empty when hydrate later fills the stored window — Save would then
 * POST null and wipe D1.
 */
export function examWindowDraftInputs(window: ExamWindow): {
  start: string;
  end: string;
} {
  return {
    start: window.startDate ?? "",
    end: window.endDate ?? "",
  };
}

/**
 * True when posting this draft would clear a window the cycle already has.
 * Empty draft after a late hydrate is the wipe; a synced draft is not.
 */
export function examWindowDraftWouldClearStored(
  draft: { start: string; end: string },
  stored: ExamWindow,
): boolean {
  const hasStored = Boolean(stored.startDate || stored.endDate);
  return hasStored && !draft.start && !draft.end;
}

/**
 * `count` consecutive dates from the window start. When the window has an end
 * date the list is clipped to it, but never below a single day — an allocation
 * still has to happen somewhere, and refusing here would hide the reason.
 */
export function examWindowDates(
  window: ExamWindow,
  count: number,
  fallbackStart: string,
): string[] {
  const start = examWindowStart(window, fallbackStart);
  const wanted = Math.max(1, Math.floor(count));
  const end =
    window.endDate && ISO_DATE.test(window.endDate) ? window.endDate : null;
  const dates: string[] = [];
  for (let i = 0; i < wanted; i += 1) {
    const date = addDays(start, i);
    if (end && date > end && dates.length > 0) break;
    dates.push(date);
  }
  return dates;
}
