import ExcelJS from "exceljs";
import { parseTeacherRowsFromAoa } from "./excelTeachers.js";

export interface WorkbookMeta {
  title: string;
  examCycle: string;
  generatedAt: string;
  ruleVersion: string;
  allocationRun: string;
  officer: string;
  dataVersion: string;
}

function applyMetaSheet(wb: ExcelJS.Workbook, meta: WorkbookMeta): void {
  const sheet = wb.addWorksheet("Metadata");
  sheet.addRows([
    ["Title", meta.title],
    ["Examination cycle", meta.examCycle],
    ["Generated timestamp", meta.generatedAt],
    ["Rule version", meta.ruleVersion],
    ["Allocation run", meta.allocationRun],
    ["Officer", meta.officer],
    ["Data version", meta.dataVersion],
    ["Note", "Home coordinates intentionally omitted from reports"],
  ]);
}

export async function buildTeacherWiseWorkbook(
  meta: WorkbookMeta,
  rows: Array<Record<string, string | number | boolean | null | undefined>>,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Erode Exam Duty Allotment";
  applyMetaSheet(wb, meta);
  const sheet = wb.addWorksheet("Teacher-wise");
  const headers = [
    "Teacher",
    "School",
    "DutyType",
    "Centre",
    "Date",
    "Session",
    "Role",
    "Subject",
  ];
  sheet.addRow(headers);
  for (const r of rows) {
    sheet.addRow(headers.map((h) => r[h] ?? ""));
  }
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

export async function buildExceptionWorkbook(
  meta: WorkbookMeta,
  rows: Array<{
    Kind: string;
    Key: string;
    Message: string;
    Severity: string;
  }>,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  applyMetaSheet(wb, meta);
  const sheet = wb.addWorksheet("Exceptions");
  sheet.addRow(["Kind", "Key", "Message", "Severity"]);
  for (const r of rows) {
    sheet.addRow([r.Kind, r.Key, r.Message, r.Severity]);
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function buildCompleteAllotmentWorkbook(
  meta: WorkbookMeta,
  teacherRows: Array<Record<string, string | number | boolean | null | undefined>>,
  schoolRows: Array<Record<string, string | number | boolean | null | undefined>>,
  centreRows: Array<Record<string, string | number | boolean | null | undefined>>,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  applyMetaSheet(wb, meta);
  const add = (
    name: string,
    headers: string[],
    rows: Array<Record<string, string | number | boolean | null | undefined>>,
  ) => {
    const sheet = wb.addWorksheet(name);
    sheet.addRow(headers);
    for (const r of rows) sheet.addRow(headers.map((h) => r[h] ?? ""));
  };
  add(
    "Teacher-wise",
    [
      "Teacher",
      "EmployeeCode",
      "School",
      "DutyType",
      "Centre",
      "Date",
      "Session",
      "Role",
      "Subject",
    ],
    teacherRows,
  );
  add(
    "School-wise",
    ["School", "Centre", "Teachers", "Date", "Session", "Duty"],
    schoolRows,
  );
  add(
    "Centre-wise",
    ["Centre", "Teachers", "Roles", "Dates", "Sessions", "Standby"],
    centreRows,
  );
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Parse teachers sheet from an uploaded .xlsx ArrayBuffer. */
export async function parseTeachersWorkbook(
  buffer: ArrayBuffer,
): Promise<{ rows: Record<string, unknown>[]; headerErrors: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return { rows: [], headerErrors: ["Workbook has no sheets"] };
  const aoa: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as unknown[];
    // exceljs is 1-indexed
    aoa.push((values ?? []).slice(1));
  });
  return parseTeacherRowsFromAoa(aoa);
}

/** Build a synthetic teachers.xlsx for demos/tests. */
export async function buildTeachersTemplateWorkbook(
  rows: Array<Record<string, unknown>>,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Teachers");
  const headers = [
    "name",
    "schoolName",
    "schoolCode",
    "designation",
    "subject",
    "seniorityRank",
    "joiningDate",
    "homeLatitude",
    "homeLongitude",
    "isActive",
  ];
  const labels: Record<string, string> = { name:"Teacher name", schoolName:"School name", schoolCode:"Centre code", designation:"Designation", subject:"Subject", seniorityRank:"Seniority rank", joiningDate:"Joining date", homeLatitude:"Home latitude", homeLongitude:"Home longitude", isActive:"Active" };
  sheet.addRow(headers.map((h) => labels[h] ?? h));
  for (const r of rows) {
    sheet.addRow(headers.map((h) => r[h] ?? ""));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
