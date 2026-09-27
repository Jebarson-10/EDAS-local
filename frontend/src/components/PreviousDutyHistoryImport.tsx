import { useState } from "react";
import {
  assertMutable,
  parseHistoricalDutyRows,
  resolveHistoricalDutyRows,
  type HistoricalDuty,
} from "@exam-duty/shared";
import { useApp } from "../state/AppContext";
import { Panel } from "./ui";
import { fetchDutyHistory, importPreviousDutyHistoryApi } from "../lib/api";

/** Dated, centre-wise history is needed to enforce the last-two-years rule. */
export function PreviousDutyHistoryImport() {
  const { dataset, examCycle, role, setDataset } = useApp();
  const [rows, setRows] = useState<HistoricalDuty[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (!dataset) return null;
  const currentDataset = dataset;

  async function downloadTemplate() {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Previous duties");
    sheet.addRow(["Teacher name", "School reference", "School name", "Centre code", "Exam date", "Session", "Duty group", "Role", "Academic year", "Exam school reference", "Exam school name", "Subject"]);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "DDEBF7" } };
    sheet.addRow(["", "", "", "", "", "Morning or Afternoon", "Theory / Hall, Practical, or Other", "For Practical: Internal or External examiner", "", "For Practical only", "For Practical only", "For Practical only"]);
    sheet.columns.forEach((column) => { column.width = 24; });
    const url = URL.createObjectURL(new Blob([await workbook.xlsx.writeBuffer()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "EDAS-previous-duty-history-template.xlsx";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function upload(file: File) {
    setBusy(true); setMessage(""); setProblems([]); setRows([]);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("The workbook has no sheets.");
      const table: unknown[][] = [];
      sheet.eachRow((row) => {
        table.push(Array.from({ length: sheet.columnCount }, (_, index) => row.getCell(index + 1).value));
      });
      const parsed = parseHistoricalDutyRows(table);
      const resolved = resolveHistoricalDutyRows(parsed.rows, {
        teachers: currentDataset.teachers.map((teacher) => ({ teacherId: teacher.teacherId, name: teacher.name, schoolId: teacher.schoolId })),
        schools: currentDataset.schools.map((school) => ({ schoolId: school.schoolId, schoolName: school.schoolName, sourceSchoolCode: school.sourceSchoolCode })),
        centres: currentDataset.centres.map((centre) => ({ centreId: centre.centreId, centreCode: centre.centreCode })),
      });
      const allProblems = [...parsed.errors, ...resolved.errors];
      setProblems(allProblems);
      setRows(resolved.rows);
      setMessage(allProblems.length
        ? `Read ${resolved.rows.length} matching duty rows. Fix the listed rows before saving.`
        : `Read ${resolved.rows.length} previous-duty rows. Check the count, then save.`);
    } catch (error) {
      setProblems([error instanceof Error ? error.message : "The workbook could not be read."]);
    } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      const result = await importPreviousDutyHistoryApi(role, examCycle.examCycleId, rows);
      const fresh = await fetchDutyHistory(role);
      if (!fresh) throw new Error("The rows were saved but could not be refreshed. Reopen the app before generating duties.");
      setDataset({
        ...currentDataset,
        history: fresh.history.map((row) => ({
          teacherId: row.teacher_id,
          centreId: row.centre_id ?? null,
          dutyTypeCode: row.duty_type_code,
          roleCode: row.role_code ?? null,
          examDate: row.exam_date,
          sessionCode: row.session_code as "MORNING" | "AFTERNOON",
          academicYear: row.academic_year,
          dataQuality: "Confirmed" as const,
        })),
      });
      setMessage(`Saved ${result.imported} previous duties and ${result.pairs} practical examiner pair(s). ${result.unchanged} already-saved rows were left unchanged. These records now enforce the two-year centre rule, fairness and next-year practical role switching.`);
      setRows([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Previous duty history could not be saved.");
    } finally { setBusy(false); }
  }

  return <Panel title="4. Previous duty history">
    <p className="text-sm mb-3">Upload dated, centre-wise duties from the last two years. This stops a teacher returning to the same centre and gives people with recent duties lower priority. For a practical duty, add the practical school and subject too, so next year’s internal and external examiners can be switched. Do not use the short remarks in OVER ALL as a substitute.</p>
    <div className="flex flex-wrap gap-2">
      <button className="border rounded p-2" onClick={() => void downloadTemplate()}>Download previous-duty template</button>
      <label className="border rounded p-2 cursor-pointer">Upload previous-duty Excel<input className="hidden" type="file" accept=".xlsx" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></label>
      <button className="border rounded p-2 disabled:opacity-40" disabled={busy || !rows.length || problems.length > 0 || !assertMutable(examCycle.status, "save").ok} onClick={() => void save()}>Save previous duties</button>
    </div>
    {message && <p role="status" className="mt-3">{message}</p>}
    {problems.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-[var(--color-err)]">{problems.slice(0, 20).map((problem, index) => <li key={index}>{problem}</li>)}{problems.length > 20 && <li>And {problems.length - 20} more rows to correct.</li>}</ul>}
  </Panel>;
}
