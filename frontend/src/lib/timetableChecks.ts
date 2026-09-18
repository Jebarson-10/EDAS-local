import type { ExamTimetableEntry } from "@exam-duty/shared";

function localDateText(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Allow any timetable date from the device's current date onward. */
export function timetableDateProblem(
  entries: ExamTimetableEntry[],
  today = localDateText(),
): string | null {
  const pastEntry = entries.find((entry) => entry.examDate < today);
  return pastEntry
    ? `Timetable date ${pastEntry.examDate} is before today (${today}). Enter today or a future exam date before generating duties.`
    : null;
}
