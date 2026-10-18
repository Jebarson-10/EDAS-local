import ExcelJS from "exceljs";
import type { ExamWorkspace, WorkspaceRun } from "@exam-duty/shared";
import { workspaceReportSheets } from "./workspaceReportData";

/** Each invocation builds exactly one standard/module workbook. */
export function buildWorkspaceReportWorkbook(w: ExamWorkspace, run: WorkspaceRun, chiefsOnly = false) {
  const book = new ExcelJS.Workbook();
  book.creator = "Erode Exam Duty";
  for (const data of workspaceReportSheets(w, run, chiefsOnly)) {
    const sheet = book.addWorksheet(data.name);
    sheet.addRow([data.title]); sheet.addRow([data.subtitle]); sheet.addRow([]);
    const headerRow = sheet.addRow(data.headers);
    for (const values of data.rows) sheet.addRow(values.map((v, i) => data.dateColumns?.includes(i) && typeof v === "string" && v ? new Date(`${v}T00:00:00Z`) : v));
    sheet.columns.forEach((c, i) => { c.width = data.widths[i] ?? 26; });
    const last = data.headers.length;
    sheet.mergeCells(1, 1, 1, last); sheet.mergeCells(2, 1, 2, last);
    sheet.getRow(1).font = { name: "Arial", size: 14, bold: true, color: { argb: "FF183B4C" } };
    sheet.getRow(1).height = 30;
    sheet.getRow(2).height = data.subtitle.includes("\n") ? 42 : 26;
    headerRow.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF183B4C" } };
    headerRow.height = 30;
    sheet.eachRow((row, index) => {
      row.alignment = { wrapText: true, vertical: "middle", horizontal: index === 4 ? "center" : "left" };
      if (index > 4) { row.font = { name: "Arial", size: 10 }; row.height = 42; }
    });
    for (const i of data.dateColumns ?? []) sheet.getColumn(i + 1).numFmt = "dd/mm/yyyy";
    sheet.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, sheet.rowCount), column: last } };
    sheet.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:4" };
    sheet.headerFooter = { oddFooter: "Page &P of &N" };
  }
  return book;
}
