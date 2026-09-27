import ExcelJS from "exceljs";
import { parseTeacherRowsFromAoa } from "./excelTeachers.js";
import { parseOfficialStaffWorkbook } from "./officialStaffWorkbook.js";
import type { Centre, School, Teacher } from "./types.js";

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

type DutyOrderRole =
  | "CHIEF_EXAMINATION"
  | "DEPARTMENT_OFFICER"
  | "OFFICE_STAFF"
  | "HALL_INVIGILATOR"
  | "HALL_STANDBY";

export interface CentreDutyOrderAssignment {
  centreId: string;
  teacherId: string;
  roleCode: DutyOrderRole;
  examDate: string;
  sessionCode: string;
  slotIndex?: number;
}

export interface CentreDutyOrderInput {
  title: string;
  centres: Centre[];
  schools: School[];
  teachers: Teacher[];
  theoryAssignments: CentreDutyOrderAssignment[];
  hallAssignments: CentreDutyOrderAssignment[];
}

export interface CentreDutyOrderMember {
  teacherId: string;
  teacherName: string;
  designation: string;
  subject: string;
  schoolName: string;
  contactNumber: string;
  roleCode: DutyOrderRole;
  dutyTimes: string[];
}

export interface CentreDutyOrderCentre {
  centreId: string;
  centreCode: string;
  centreName: string;
  chiefExaminers: CentreDutyOrderMember[];
  departmentalOfficers: CentreDutyOrderMember[];
  officeHelpers: CentreDutyOrderMember[];
  hallTeam: CentreDutyOrderMember[];
}

function textSort(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function dutyTime(date: string, session: string): string {
  return `${date} ${session === "AFTERNOON" ? "Afternoon" : "Morning"}`;
}

function contactNumber(teacher: Teacher | undefined): string {
  const details = teacher?.officialDetails ?? {};
  const match = Object.entries(details).find(
    ([key, value]) =>
      /(?:phone|mobile|contact|whatsapp)/i.test(key) && value.trim().length > 0,
  );
  return match?.[1]?.trim() ?? "";
}

function schoolNameForTeacher(
  teacher: Teacher | undefined,
  schoolById: Map<string, School>,
): string {
  if (!teacher) return "School not found";
  return schoolById.get(teacher.schoolId)?.schoolName ?? "School not found";
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(textSort);
}

/**
 * Shapes the two allocation runs into the centre duty order people issue.
 * It deliberately combines repeated date/session assignments for the same
 * teacher and role, so a person appears once within a centre instead of once
 * for every exam session.
 */
export function buildCentreDutyOrder(
  input: Omit<CentreDutyOrderInput, "title">,
): CentreDutyOrderCentre[] {
  const centreById = new Map(input.centres.map((centre) => [centre.centreId, centre]));
  const schoolById = new Map(input.schools.map((school) => [school.schoolId, school]));
  const teacherById = new Map(input.teachers.map((teacher) => [teacher.teacherId, teacher]));
  const byCentre = new Map<string, Map<string, CentreDutyOrderMember>>();
  const allAssignments = [
    ...input.theoryAssignments.filter((assignment) =>
      ["CHIEF_EXAMINATION", "DEPARTMENT_OFFICER", "OFFICE_STAFF"].includes(
        assignment.roleCode,
      ),
    ),
    ...input.hallAssignments.filter((assignment) =>
      ["HALL_INVIGILATOR", "HALL_STANDBY"].includes(assignment.roleCode),
    ),
  ];

  for (const assignment of allAssignments) {
    const teacher = teacherById.get(assignment.teacherId);
    const entries = byCentre.get(assignment.centreId) ?? new Map<string, CentreDutyOrderMember>();
    const key = `${assignment.roleCode}|${assignment.teacherId}`;
    const previous = entries.get(key);
    if (previous) {
      previous.dutyTimes = uniqueSorted([
        ...previous.dutyTimes,
        dutyTime(assignment.examDate, assignment.sessionCode),
      ]);
    } else {
      entries.set(key, {
        teacherId: assignment.teacherId,
        teacherName: teacher?.name ?? "Teacher not found",
        designation: teacher?.designation ?? "",
        subject: teacher?.subject ?? "",
        schoolName: schoolNameForTeacher(teacher, schoolById),
        contactNumber: contactNumber(teacher),
        roleCode: assignment.roleCode,
        dutyTimes: [dutyTime(assignment.examDate, assignment.sessionCode)],
      });
    }
    byCentre.set(assignment.centreId, entries);
  }

  const includedCentreIds = new Set([
    ...input.centres
      .filter((centre) => centre.active !== false)
      .map((centre) => centre.centreId),
    ...byCentre.keys(),
  ]);
  return [...includedCentreIds]
    .map((centreId) => {
      const centre = centreById.get(centreId);
      const members = [...(byCentre.get(centreId)?.values() ?? [])].map((member) => ({
        ...member,
        dutyTimes: uniqueSorted(member.dutyTimes),
      }));
      const membersFor = (roleCode: DutyOrderRole) =>
        members
          .filter((member) => member.roleCode === roleCode)
          .sort((left, right) => textSort(left.teacherName, right.teacherName));
      return {
        centreId,
        centreCode: centre?.centreCode ?? centreId,
        centreName: centre?.centreName ?? "Centre not found",
        chiefExaminers: membersFor("CHIEF_EXAMINATION"),
        departmentalOfficers: membersFor("DEPARTMENT_OFFICER"),
        officeHelpers: membersFor("OFFICE_STAFF"),
        hallTeam: [
          ...membersFor("HALL_INVIGILATOR"),
          ...membersFor("HALL_STANDBY"),
        ],
      };
    })
    .sort((left, right) =>
      textSort(`${left.centreCode}|${left.centreName}`, `${right.centreCode}|${right.centreName}`),
    );
}

function centreSheetName(centre: CentreDutyOrderCentre, used: Set<string>): string {
  const base = (centre.centreCode || centre.centreName || "Centre")
    .replace(/[\\/*?:\[\]]/g, " ")
    .trim()
    .slice(0, 31) || "Centre";
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    const marker = `-${suffix}`;
    name = `${base.slice(0, 31 - marker.length)}${marker}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

function staffLine(member: CentreDutyOrderMember): string {
  const details = [member.designation, member.subject, member.schoolName, member.contactNumber]
    .filter(Boolean)
    .join(", ");
  const dutyTimes = member.dutyTimes.join("; ");
  return [member.teacherName, details, dutyTimes].filter(Boolean).join(" — ");
}

function officerCell(members: CentreDutyOrderMember[]): string {
  return members.length ? members.map(staffLine).join("\n") : "Not allotted";
}

function styleTitleRow(row: ExcelJS.Row): void {
  row.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  row.alignment = { horizontal: "center", vertical: "middle" };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173F5F" } };
}

function styleLabelRow(sheet: ExcelJS.Worksheet, rowNumber: number): void {
  const row = sheet.getRow(rowNumber);
  row.getCell(1).font = { bold: true };
  row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1F6" } };
  row.getCell(3).alignment = { vertical: "top", wrapText: true };
  row.height = Math.max(22, Math.ceil(String(row.getCell(3).value ?? "").split("\n").length * 18));
}

function applyDutyOrderPrintSetup(sheet: ExcelJS.Worksheet): void {
  sheet.views = [{ showGridLines: false }];
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.1 },
  };
  sheet.columns = [
    { width: 7 },
    { width: 30 },
    { width: 17 },
    { width: 18 },
    { width: 34 },
    { width: 17 },
    { width: 20 },
    { width: 17 },
  ];
}

/** Creates the centre-by-centre theory duty order in the supplied Gobi format. */
export async function buildCentreWiseTheoryDutyWorkbook(
  input: CentreDutyOrderInput,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Erode Exam Duty";
  const centres = buildCentreDutyOrder(input);
  const usedNames = new Set<string>();

  for (const centre of centres) {
    const sheet = workbook.addWorksheet(centreSheetName(centre, usedNames));
    applyDutyOrderPrintSetup(sheet);
    sheet.mergeCells("A1:H1");
    sheet.getCell("A1").value = "THEORY EXAMINATION - DUTY ORDER";
    styleTitleRow(sheet.getRow(1));
    sheet.mergeCells("A2:H2");
    sheet.getCell("A2").value = input.title;
    sheet.getCell("A2").alignment = { horizontal: "center" };
    sheet.mergeCells("A3:B3");
    sheet.mergeCells("C3:H3");
    sheet.getCell("A3").value = "Centre";
    sheet.getCell("C3").value = [centre.centreCode, centre.centreName].filter(Boolean).join(" - ");
    styleLabelRow(sheet, 3);
    sheet.mergeCells("A4:B4");
    sheet.mergeCells("C4:H4");
    sheet.getCell("A4").value = "Chief examiner";
    sheet.getCell("C4").value = officerCell(centre.chiefExaminers);
    styleLabelRow(sheet, 4);
    sheet.mergeCells("A5:B5");
    sheet.mergeCells("C5:H5");
    sheet.getCell("A5").value = "Departmental officer";
    sheet.getCell("C5").value = officerCell(centre.departmentalOfficers);
    styleLabelRow(sheet, 5);
    sheet.mergeCells("A6:B6");
    sheet.mergeCells("C6:H6");
    sheet.getCell("A6").value = "Office helpers (non-teaching)";
    sheet.getCell("C6").value = officerCell(centre.officeHelpers);
    styleLabelRow(sheet, 6);
    sheet.mergeCells("A7:H7");
    sheet.getCell("A7").value = "Hall invigilators";
    sheet.getCell("A7").font = { bold: true };
    sheet.getCell("A7").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1F6" } };
    const header = sheet.addRow([
      "S.No",
      "Name of invigilator",
      "Post",
      "Subject",
      "School",
      "Contact number",
      "Duty dates",
      "Type",
    ]);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173F5F" } };
    header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    header.height = 30;
    centre.hallTeam.forEach((member, index) => {
      const row = sheet.addRow([
        index + 1,
        member.teacherName,
        member.designation,
        member.subject,
        member.schoolName,
        member.contactNumber,
        member.dutyTimes.join("; "),
        formatDutyRole(member.roleCode),
      ]);
      row.alignment = { vertical: "top", wrapText: true };
    });
    if (!centre.hallTeam.length) {
      const row = sheet.addRow(["", "No hall invigilators allotted", "", "", "", "", "", ""]);
      row.alignment = { vertical: "top", wrapText: true };
      sheet.mergeCells(`B${row.number}:H${row.number}`);
    }
  }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Creates the short centre-wise reference list requested for chief and departmental officers. */
export async function buildChiefAndDepartmentWorkbook(
  input: CentreDutyOrderInput,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Erode Exam Duty";
  const sheet = workbook.addWorksheet("Chief and department");
  sheet.views = [{ state: "frozen", ySplit: 3, showGridLines: false }];
  sheet.mergeCells("A1:D1");
  sheet.getCell("A1").value = "CHIEF EXAMINER AND DEPARTMENTAL OFFICER";
  styleTitleRow(sheet.getRow(1));
  sheet.mergeCells("A2:D2");
  sheet.getCell("A2").value = input.title;
  sheet.getCell("A2").alignment = { horizontal: "center" };
  const header = sheet.addRow([
    "Centre code",
    "Centre name",
    "Chief examiner",
    "Departmental officer",
  ]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173F5F" } };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  for (const centre of buildCentreDutyOrder(input)) {
    const row = sheet.addRow([
      centre.centreCode,
      centre.centreName,
      officerCell(centre.chiefExaminers),
      officerCell(centre.departmentalOfficers),
    ]);
    row.alignment = { vertical: "top", wrapText: true };
    row.height = Math.max(
      22,
      Math.ceil(
        Math.max(
          String(row.getCell(3).value ?? "").split("\n").length,
          String(row.getCell(4).value ?? "").split("\n").length,
        ) * 18,
      ),
    );
  }
  sheet.columns = [{ width: 16 }, { width: 42 }, { width: 58 }, { width: 58 }];
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export interface PracticalExaminerSchedule {
  batchKey: string;
  schoolId: string;
  subjectId: string;
  examDate: string;
  sessionCode: string;
  internalExaminerId: string;
  externalExaminerId: string;
}

export interface PracticalExaminerWorkbookInput {
  title: string;
  schools: School[];
  teachers: Teacher[];
  schedules: PracticalExaminerSchedule[];
}

/** A single simple practical list: one row per school and subject. */
export async function buildPracticalExaminerWorkbook(
  input: PracticalExaminerWorkbookInput,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Erode Exam Duty";
  const sheet = workbook.addWorksheet("Practical examiners");
  sheet.views = [{ state: "frozen", ySplit: 3, showGridLines: false }];
  sheet.mergeCells("A1:F1");
  sheet.getCell("A1").value = "PRACTICAL EXAMINATION - EXAMINER LIST";
  styleTitleRow(sheet.getRow(1));
  sheet.mergeCells("A2:F2");
  sheet.getCell("A2").value = input.title;
  sheet.getCell("A2").alignment = { horizontal: "center" };
  const header = sheet.addRow([
    "School",
    "Subject",
    "Batches",
    "Date and session",
    "Internal examiner",
    "External examiner",
  ]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173F5F" } };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  const schoolById = new Map(input.schools.map((school) => [school.schoolId, school]));
  const teacherById = new Map(input.teachers.map((teacher) => [teacher.teacherId, teacher]));
  const grouped = new Map<string, PracticalExaminerSchedule[]>();
  for (const schedule of input.schedules) {
    const key = `${schedule.schoolId}|${schedule.subjectId}`;
    const current = grouped.get(key) ?? [];
    current.push(schedule);
    grouped.set(key, current);
  }
  const rows = [...grouped.entries()].sort(([left], [right]) => textSort(left, right));
  for (const [, schedules] of rows) {
    const first = schedules[0];
    if (!first) continue;
    const internal = uniqueSorted(
      schedules.map((schedule) => teacherById.get(schedule.internalExaminerId)?.name ?? "Teacher not found"),
    ).join("\n");
    const external = uniqueSorted(
      schedules.map((schedule) => teacherById.get(schedule.externalExaminerId)?.name ?? "Teacher not found"),
    ).join("\n");
    const row = sheet.addRow([
      schoolById.get(first.schoolId)?.schoolName ?? "School not found",
      first.subjectId,
      new Set(schedules.map((schedule) => schedule.batchKey)).size,
      uniqueSorted(schedules.map((schedule) => dutyTime(schedule.examDate, schedule.sessionCode))).join("; "),
      internal,
      external,
    ]);
    row.alignment = { vertical: "top", wrapText: true };
  }
  sheet.columns = [{ width: 42 }, { width: 22 }, { width: 10 }, { width: 34 }, { width: 30 }, { width: 30 }];
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
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
