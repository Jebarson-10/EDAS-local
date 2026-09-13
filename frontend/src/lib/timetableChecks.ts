import type { ExamTimetableEntry } from "@exam-duty/shared";

/** Reject accidental sample/old-year dates before an allocation is generated. */
export function timetableYearProblem(
  entries: ExamTimetableEntry[],
  academicYear: string,
): string | null {
  const permittedYears = new Set(academicYear.match(/\d{4}/g) ?? []);
  if (!permittedYears.size) return null;
  const wrong = entries.find((entry) => !permittedYears.has(entry.examDate.slice(0, 4)));
  return wrong
    ? `Timetable date ${wrong.examDate} does not match academic year ${academicYear}. Replace the sample timetable with official dates before generating duties.`
    : null;
}
