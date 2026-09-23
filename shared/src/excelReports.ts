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
    ["Centre", "Movement", "Teacher", "Teacher school", "Duty role", "Duty centre", "Date", "Session"],
    [...centreRows]
      .map((row) => ({
        Centre: rowValue(row, "Centre"),
        Movement: rowValue(row, "Movement"),
        Teacher: rowValue(row, "Teacher"),
        "Teacher school": rowValue(row, "Teacher school"),
        "Duty role": formatDutyRole(String(rowValue(row, "Duty role", "Role"))),
        "Duty centre": rowValue(row, "Duty centre"),
        Date: rowValue(row, "Date"),
        Session: rowValue(row, "Session"),
      }))
      .sort((left, right) =>
        `${left.Centre}|${left.Movement}|${left.Date}|${left.Session}|${left.Teacher}`.localeCompare(
          `${right.Centre}|${right.Movement}|${right.Date}|${right.Session}|${right.Teacher}`,
        ),
      ),
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

/** A blank copy of the seven-tab CEO staff return layout used by OVER ALL.xlsx. */
export async function buildOfficialStaffTemplateWorkbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const shared = ["S.NO", "SCHOOL CODE", "NAME OF THE SCHOOL", "TYPE (GOVT/AIDED)", "TEACHERS NAME (INITIAL AT END)", "SEX M/F", "DESIGNATION", "MOBILE NO", "QUALIFICATION"];
  const dates = (appointment: string) => [appointment, appointment, appointment, "DATE OF RETIREMENT", "DATE OF RETIREMENT", "DATE OF RETIREMENT"];
  const dateParts = ["DD", "MM", "YYYY", "DD", "MM", "YYYY"];
  const commonEnd = ["RESIDENTIAL UNION/BLOCK", "PREVIOUS EXAM DUTY", "PREVIOUS CAMP DUTY", "HEALTH / LEAVE / REMARKS", "BLOCK"];
  const layouts: Array<{ name: string; title: string; headers: string[]; subheaders: string[] }> = [
    { name: "HM", title: "HEADMASTER & INCHARGE HM DETAILS", headers: [...shared.slice(0, 4), "HEADMASTER NAME (INITIAL AT END)", shared[5]!, shared[7]!, shared[8]!, "MAJOR SUBJECT", ...dates("DATE OF APPOINTMENT IN HM POST"), ...commonEnd], subheaders: [...Array(9).fill(""), ...dateParts, ...Array(5).fill("")] },
    { name: "PG", title: "PG TEACHERS LIST", headers: [...shared, "MAJOR SUBJECT", "11,12TH HANDLING SUBJECT", "ADDITIONAL HANDLING SUBJECTS", ...dates("DATE OF APPOINTMENT AS PG ASST"), ...commonEnd], subheaders: [...Array(12).fill(""), ...dateParts, ...Array(5).fill("")] },
    { name: "BT", title: "BT (10TH HANDLING) TEACHERS LIST", headers: [...shared, "MAJOR SUBJECT", "10TH HANDLING SUBJECT", "MEDIUM (TAMIL/ENGLISH/BOTH)", ...dates("DATE OF APPOINTMENT AS BT ASST"), ...commonEnd], subheaders: [...Array(12).fill(""), ...dateParts, ...Array(5).fill("")] },
    { name: "BT NON", title: "BT (10TH NON HANDLING) TEACHERS LIST", headers: [...shared, "MAJOR SUBJECT", "ADDITIONAL HANDLING SUBJECTS", "", ...dates("DATE OF APPOINTMENT AS BT ASST"), ...commonEnd], subheaders: [...Array(12).fill(""), ...dateParts, ...Array(5).fill("")] },
    { name: "SGT", title: "SGT TEACHERS LIST", headers: [...shared, "MAJOR SUBJECT", "HANDLING SUBJECTS", ...dates("DATE OF APPOINTMENT AS SGT"), ...commonEnd], subheaders: [...Array(11).fill(""), ...dateParts, ...Array(5).fill("")] },
    { name: "SPL", title: "SPECIAL TEACHERS LIST", headers: [...shared, "", "", ...dates("DATE OF APPOINTMENT AS SPECIAL TEACHER"), ...commonEnd], subheaders: [...Array(11).fill(""), ...dateParts, ...Array(5).fill("")] },
    { name: "NON TEACHING", title: "NON TEACHING STAFF LIST", headers: [...shared.slice(0, 4), "NAME OF THE EMPLOYEE (INITIAL AT END)", ...shared.slice(5), ...dates("DATE OF APPOINTMENT IN PRESENT DESIGNATION"), "RESIDENTIAL UNION/BLOCK", "LAST SSLC / HSC EXAMINATION DUTY", "HEALTH / LEAVE / REMARKS", "BLOCK"], subheaders: [...Array(9).fill(""), ...dateParts, ...Array(4).fill("")] },
  ];
  for (const layout of layouts) {
    const sheet = wb.addWorksheet(layout.name);
    sheet.addRow([layout.title]);
    sheet.addRow(layout.headers);
    sheet.addRow(layout.subheaders);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(2).font = { bold: true };
    sheet.getRow(3).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 3 }];
    layout.headers.forEach((header, index) => {
      sheet.getColumn(index + 1).width = Math.max(14, Math.min(32, header.length + 3));
    });
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
