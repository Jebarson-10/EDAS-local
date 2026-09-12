import { Link } from "react-router-dom";
import { Panel } from "../components/ui";

const steps = [
  ["1. Add schools and teachers", "Add blocks first, then schools, then teachers. A school's centre code is optional: enter it for an exam centre and leave it blank for other schools. The app creates the centre automatically. Teachers do not need employee codes. To edit someone, choose their name from the list. Find their location using offline maps or enter latitude and longitude.", "/master", "Open Schools & teachers"],
  ["Importing Excel files", "Download the teacher template from Imports. Fill in teacher name, school name, designation and the other details. School names must match your saved school list. Centre code is optional. Upload the file and check the preview before saving. Teachers absent from the file are kept by default. If two teachers at the same school have the same name, add or edit them separately in Schools & teachers to avoid mixing their records.", "/imports", "Open Imports"],
  ["2. Check the exam details", "Open Exam cycle. Enter the exam name, academic year and dates. Confirm the active rules before generating any duty list.", "/cycles", "Open Exam cycle"],
  ["3. Create duty lists", "Generate Theory, Practical and Hall duty lists. Read any shortage message; the system never hides a shortage by assigning an unsuitable teacher.", "/theory", "Create Theory list"],
  ["4. Check before approval", "Open Check list to see conflicts, missing information and warnings. Correct the source data or record an authorised exception before approval.", "/validation", "Open Check list"],
  ["5. Print and share", "Open Reports to download school-wise, teacher-wise and duty reports. The layouts use the Directorate heading and table style from the 2026 Chief/Department, Custodian, Liaison and Route Officer lists.", "/reports", "Open Reports"],
  ["Activity log", "This is a record of changes: what was added or edited, when it happened and any reason given. Use it to check previous imports, manual teacher replacements and downloaded reports. You do not need to enter anything here.", "/audit", "Open Activity log"],
  ["Backups", "Save a backup before making large changes. It is a separate copy you can use if the computer fails or information is changed by mistake. Restoring a backup replaces current data, so check it carefully first and keep the backup password safe.", "/backups", "Open Backups"],
  ["Settings", "Check whether saved data is available and which allotment rules are in use. Existing examinations keep their own rules so earlier duty lists remain consistent.", "/settings", "Open Settings"],
];

export function HelpPage() {
  return <Panel title="How to use this app">
    <p className="mb-5 text-sm text-[var(--color-ink-muted)]">Use this guide in order for each examination. Your work is saved automatically on this computer.</p>
    <ol className="space-y-3">{steps.map(([title, text, to, label]) => <li key={title} className="rounded-xl border border-[var(--color-line)] bg-white p-4"><h2 className="font-display text-lg">{title}</h2><p className="mt-1 text-sm text-[var(--color-ink-muted)]">{text}</p><Link className="mt-3 inline-block rounded bg-[var(--color-brand)] px-3 py-2 text-sm text-white" to={to}>{label}</Link></li>)}</ol>
    <div className="mt-5 rounded-xl bg-[var(--color-sky-wash)] p-4 text-sm"><b>Important:</b> Review the printed list before issuing it. If information is wrong, correct Schools & teachers and create a new list; earlier approved lists remain available for reference.</div>
  </Panel>;
}
