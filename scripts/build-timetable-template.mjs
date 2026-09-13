import ExcelJS from "exceljs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const output = resolve("frontend/public/templates/EDAS-timetable-template.xlsx");
await mkdir(dirname(output), { recursive: true });

const book = new ExcelJS.Workbook();
book.creator = "Erode Exam Duty";
book.created = new Date("2026-01-01T00:00:00.000Z");
const guide = book.addWorksheet("Read first");
guide.columns = [{ width: 24 }, { width: 105 }];
guide.addRow(["Timetable upload", "Fill the Timetable sheet and upload it in Exam cycle."]);
guide.addRow(["One row", "Use one row for each date and session. The same date and session cannot be repeated."]);
guide.addRow(["Date", "Use an Excel date or day/month/year, such as 15/03/2026."]);
guide.addRow(["Session", "Enter Morning or Afternoon."]);
guide.addRow(["School name", "Choose a saved school name. Leave it blank or write All schools for a district-wide session."]);
guide.addRow(["Chief duty / Hall duty", "Enter Yes or No. Leave blank when both duties are needed."]);
guide.addRow(["Important", "Do not change the headings in the Timetable sheet."]);
guide.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
guide.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123E54" } };
guide.eachRow((row, number) => { if (number > 1) row.getCell(1).font = { bold: true }; });

const sheet = book.addWorksheet("Timetable");
const headings = ["Date", "Session", "School name", "Subject / paper", "Chief duty", "Hall duty", "Notes"];
sheet.addRow(headings);
sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123E54" } };
sheet.views = [{ state: "frozen", ySplit: 1 }];
sheet.autoFilter = { from: "A1", to: "G1" };
[14, 16, 42, 28, 15, 14, 42].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
await book.xlsx.writeFile(output);
