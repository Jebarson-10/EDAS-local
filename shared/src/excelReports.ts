import ExcelJS from "exceljs";
import { parseTeacherRowsFromAoa } from "./excelTeachers.js";
import { parseOfficialStaffWorkbook } from "./officialStaffWorkbook.js";

export interface WorkbookMeta {
  title: string;
  examCycle: string;
  generatedAt: string;
  ruleVersion: string;
  allocationRun: string;
  officer: string;
  dataVersion: string;
}

/**
 * Presentation-only names for duty roles. Allocation and audit records keep
 * their stable role codes; downloaded lists use the names staff recognise.
 */
const DUTY_ROLE_LABELS: Record<string, string> = {
  CHIEF_EXAMINATION: "Chief examiner",
  DEPARTMENT_OFFICER: "Departmental officer",
  OFFICE_STAFF: "Office staff",
  CUSTODIAN: "Custodian",
  HALL_INVIGILATOR: "Hall invigilator",
  HALL_STANDBY: "Hall standby",
  PRACTICAL_INTERNAL: "Internal examiner",
  PRACTICAL_EXTERNAL: "External examiner",
};

export function formatDutyRole(roleCode: string | null | undefined): string {
  const raw = String(roleCode ?? "").trim();
  if (!raw) return "";
  const normalized = raw.toUpperCase();
  if (DUTY_ROLE_LABELS[normalized]) return DUTY_ROLE_LABELS[normalized];
  const knownLabel = Object.values(DUTY_ROLE_LABELS).find(
    (label) => label.toUpperCase() === normalized,
  );
  if (knownLabel) return knownLabel;

  // A future role can still be printed readably before its label is added.
  return normalized
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => `${word[0] ?? ""}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

type ReportRow = Record<string, string | number | boolean | null | undefined>;

function rowValue(row: ReportRow, ...keys: string[]): string | number | boolean | null | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined) return value;
  }
  return "";
}

function teacherDutyCells(row: ReportRow) {
  return [
    rowValue(row, "Teacher"),
    rowValue(row, "School"),
    rowValue(row, "Duty", "DutyType"),
    rowValue(row, "Centre"),
    rowValue(row, "Date"),
    rowValue(row, "Session"),
    formatDutyRole(String(rowValue(row, "Duty role", "Role"))),
    rowValue(row, "Subject"),
  ];
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
  rows: ReportRow[],
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Erode Exam Duty Allotment";
  applyMetaSheet(wb, meta);
  const sheet = wb.addWorksheet("Teacher-wise");
  const headers = [
    "Teacher",
    "School",
    "Duty",
    "Centre",
    "Date",
    "Session",
    "Duty role",
    "Subject",
  ];
  sheet.addRow(headers);
  for (const r of rows) {
    sheet.addRow(teacherDutyCells(r));
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
  teacherRows: ReportRow[],
  schoolRows: ReportRow[],
  centreRows: ReportRow[],
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  applyMetaSheet(wb, meta);
  const add = (
    name: string,
    headers: string[],
    rows: ReportRow[],
  ) => {
    const sheet = wb.addWorksheet(name);
    sheet.addRow(headers);
    for (const r of rows) sheet.addRow(headers.map((h) => r[h] ?? ""));
  };
  add(
    "Teacher-wise",
    [
      "Teacher",
      "School",
      "Duty",
      "Centre",
      "Date",
      "Session",
      "Duty role",
      "Subject",
    ],
    teacherRows.map((row) => ({
      Teacher: rowValue(row, "Teacher"),
      School: rowValue(row, "School"),
      Duty: rowValue(row, "Duty", "DutyType"),
      Centre: rowValue(row, "Centre"),
      Date: rowValue(row, "Date"),
      Session: rowValue(row, "Session"),
      "Duty role": formatDutyRole(String(rowValue(row, "Duty role", "Role"))),
      Subject: rowValue(row, "Subject"),
    })),
  );
  add(
    "School-wise",
    ["School", "Centre", "Teachers", "Date", "Session", "Duty"],
    schoolRows,
  );
  add(
    "Centre-wise",
    ["Centre", "Teachers", "Roles", "Dates", "Sessions", "Standby"],
    centreRows.map((row) => ({
      ...row,
      Roles: String(rowValue(row, "Roles"))
        .split(",")
        .map((role) => formatDutyRole(role))
        .filter(Boolean)
        .join(", "),
    })),
  );
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Parse teachers sheet from an uploaded .xlsx ArrayBuffer. */
export async function parseTeachersWorkbook(
  buffer: ArrayBuffer,
): Promise<{
  rows: Record<string, unknown>[];
  headerErrors: string[];
  notes?: string[];
  format?: "official-staff-workbook" | "standard";
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = wb.worksheets.map((sheet) => {
    const lines: unknown[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[];
      // exceljs is 1-indexed
      lines.push((values ?? []).slice(1));
    });
    return { name: sheet.name, lines };
  });
  if (!sheets.length) return { rows: [], headerErrors: ["Workbook has no sheets"] };

  const official = parseOfficialStaffWorkbook(sheets);
  if (official.detectedSheetNames.length > 0) {
    return {
      rows: official.rows,
      headerErrors:
        official.rows.length > 0
          ? []
          : ["No staff names were found in the official workbook."],
      notes: official.warnings,
      format: "official-staff-workbook",
    };
  }

  const parsed = parseTeacherRowsFromAoa(sheets[0]!.lines);
  return { ...parsed, format: "standard" };
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
    "staffCategory",
    "subject",
    "seniorityRank",
    "joiningDate",
    "homeLatitude",
    "homeLongitude",
    "isActive",
  ];
  const labels: Record<string, string> = { name:"Teacher name", schoolName:"School name", schoolCode:"Centre code", designation:"Designation", staffCategory:"Staff group (Teaching / Office staff)", subject:"Subject", seniorityRank:"Seniority rank", joiningDate:"Joining date", homeLatitude:"Home latitude", homeLongitude:"Home longitude", isActive:"Active" };
  sheet.addRow(headers.map((h) => labels[h] ?? h));
  for (const r of rows) {
    sheet.addRow(headers.map((h) => r[h] ?? ""));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
