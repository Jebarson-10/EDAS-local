import { Panel } from "../components/ui";

const questions = [
  ["OQ-001", "Location eligibility formula (OR vs AND, missing coords)"],
  ["OQ-002", "Fairness window definition for “recently”"],
  ["OQ-003", "Official designation taxonomy and priority"],
  ["OQ-004", "Own-school / clubbed-school conflict precise definition"],
  ["OQ-005", "Repeat-centre lookback scope"],
  ["OQ-006", "Practical batch balancing for uneven counts"],
  ["OQ-007", "Practical completion days (2 vs 3)"],
  ["OQ-008", "Examiner role-switch hard vs soft"],
  ["OQ-009", "Any permitted simultaneous duty exceptions"],
  ["OQ-010", "Authentication provider for production"],
  ["OQ-011", "Department Officer eligibility"],
  ["OQ-012", "Hall designation allow/deny lists"],
  ["OQ-013", "Unverified history in hard exclusions"],
  ["OQ-014", "Teachers missing from Excel import"],
  ["OQ-015", "Backup encryption key custody"],
  ["OQ-016", "Report language / letterhead"],
  ["OQ-017", "Relaxation mode governance"],
  ["OQ-018", "Academic year boundary for history"],
  ["OQ-019", "Question paper allotment / label slips in scope?"],
  ["OQ-020", "Exam day / session / subject timetable and duty cardinality"],
  ["OQ-021", "Does activating a rule version retarget the open cycle?"],
];

export function OpenQuestionsPage() {
  return (
    <Panel title="Open questions">
      <p className="text-sm text-[var(--color-ink-muted)] mb-3">
        Ambiguities must not be invented. Full detail lives in{" "}
        <code>docs/open-questions.md</code>. Implementation uses provisional
        configurable parameters only.
      </p>
      <ul className="space-y-2 text-sm">
        {questions.map(([id, text]) => (
          <li
            key={id}
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2"
          >
            <span className="font-mono text-xs text-[var(--color-brand-accent)]">
              {id}
            </span>{" "}
            {text}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
