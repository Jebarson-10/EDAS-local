import { Link } from "react-router-dom";
import { Panel } from "../components/ui";

const steps = [
  ["1. Set up schools and teachers", "Open Master data. Add blocks, schools, exam centres and teachers. Use the Offline OSM lookup to fill coordinates, then check the suggested place before saving.", "/master", "Open Master data"],
  ["2. Check the exam details", "Open Exam cycle. Enter the exam name, academic year and dates. Confirm the active rules before generating any duty list.", "/cycles", "Open Exam cycle"],
  ["3. Create duty lists", "Generate Theory, Practical and Hall duty lists. Read any shortage message; the system never hides a shortage by assigning an unsuitable teacher.", "/theory", "Create Theory list"],
  ["4. Check before approval", "Open Check list to see conflicts, missing information and warnings. Correct the source data or record an authorised exception before approval.", "/validation", "Open Check list"],
  ["5. Print and share", "Open Reports to download school-wise, teacher-wise and duty reports. The layouts use the Directorate heading and table style from the 2026 Chief/Department, Custodian, Liaison and Route Officer lists.", "/reports", "Open Reports"],
];

export function HelpPage() {
  return <Panel title="How to use this app">
    <p className="mb-5 text-sm text-[var(--color-ink-muted)]">Use this guide in order for each examination. Your work is saved automatically on this computer.</p>
    <ol className="space-y-3">{steps.map(([title, text, to, label]) => <li key={title} className="rounded-xl border border-[var(--color-line)] bg-white p-4"><h2 className="font-display text-lg">{title}</h2><p className="mt-1 text-sm text-[var(--color-ink-muted)]">{text}</p><Link className="mt-3 inline-block rounded bg-[var(--color-brand)] px-3 py-2 text-sm text-white" to={to}>{label}</Link></li>)}</ol>
    <div className="mt-5 rounded-xl bg-[var(--color-sky-wash)] p-4 text-sm"><b>Important:</b> Review the printed list before issuing it. If information is wrong, correct Master data and create a new list; earlier approved lists remain available for reference.</div>
  </Panel>;
}
