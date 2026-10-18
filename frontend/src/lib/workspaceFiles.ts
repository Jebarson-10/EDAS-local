import ExcelJS from "exceljs";
import { buildWorkspaceReportWorkbook } from "./workspaceReportWorkbook";
import { workspaceReportFilename } from "./workspaceReportData";
export { workspaceRoleLabel } from "./workspaceReportData";
import {
  WORKSPACE_IMPORT_HEADERS,
  WORKSPACE_PRACTICAL_SUBJECTS,
  WORKSPACE_PRACTICAL_SOURCES,
  type ExamWorkspace,
  type WorkspaceRun,
  type WorkspaceImportKind,
} from "@exam-duty/shared";

export function downloadFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const inputGuide = [
  [
    "Import order",
    "Import School Master first, then Teacher Master. Their existing headings and title rows are supported.",
  ],
  [
    "UDISE and centres",
    "UDISE identifies a school. Add a row in Centres for each standard in which it is an exam centre. UDISE is not a centre code.",
  ],
  [
    "Schools",
    "Your School Master already supplies block, educational district, management, level and coordinates. Correct bad coordinates directly in Schools.",
  ],
  [
    "Staff",
    "Your Teacher Master supplies staff IDs, posts, appointed/handling subjects, class taught and appointment dates. Date of present post determines seniority.",
  ],
  [
    "Dates",
    "Use real Excel dates or DD/MM/YYYY or YYYY-MM-DD. Semicolon-separated date lists in Practical must use YYYY-MM-DD.",
  ],
  [
    "Standards",
    "Enter 10 or 12. Enter separate Centre and Timetable rows for each standard. The staff and school masters are shared within the cycle.",
  ],
  [
    "Centre students",
    "Enter the total centre strength. Clubbed UDISE Codes lists linked schools separated by semicolons. Do not put UDISE in Centre Code.",
  ],
  [
    "Timetable",
    "Use MORNING or AFTERNOON. A blank Centre Code applies to all centres of that standard. A specified code applies to that centre only.",
  ],
  [
    "Custodian / collection points",
    "Enter CUSTODIAN or COLLECTION. Every centre must belong to one custodian point. Start with four custodian points, or enter your required number.",
  ],
  [
    "Routes",
    "One row requests one route officer. Select an existing custodian Point ID and the centres within it. Separate Centre Codes with semicolons.",
  ],
  [
    "Practical groups",
    "One row per school, student group and subject. Use the same group ID and student count for subjects taken by the same students. Different groups must represent different students.",
  ],
  [
    "Practical halls",
    "Available Halls is the number of usable subject rooms at the receiving school. Use the same number for every row sharing that receiving school and subject.",
  ],
  [
    "Small practical groups",
    "For fewer than 15 students, select Receiving UDISE Code manually from Allowed Clubbed UDISE Codes, within the same educational district.",
  ],
  [
    "Practical dates",
    "List every available exam date separated by semicolons. Morning and afternoon can be used; a student takes only one practical a day.",
  ],
  [
    "History",
    "Enter Staff ID, destination school UDISE, date and duty for the preceding two years. Do not invent missing history.",
  ],
  [
    "Other post names",
    "Unrecognised post names remain as supplied. They are not silently promoted to PG, BT, HM or office staff.",
  ],
  [
    "Empty rows",
    "Delete nothing from headings. Leave unused sheets empty. Do not fill unknown values with zero or made-up details.",
  ],
];
export const workspaceInputSections: {
  kind: WorkspaceImportKind;
  title: string;
  description: string;
}[] = [
  {
    kind: "Schools",
    title: "1. Schools",
    description:
      "Upload School Master. Includes full school name, UDISE, block, educational district, school level and coordinates.",
  },
  {
    kind: "Staff",
    title: "2. Teachers and office staff",
    description:
      "Upload Teacher Master after schools. Use its existing Staff ID, post, subjects, class taught and present-post appointment date.",
  },
  {
    kind: "Centres",
    title: "3. Centres and student strength",
    description:
      "One row per centre and standard. Enter centre code, school UDISE, total students and linked schools. Individual student names are not needed.",
  },
  {
    kind: "Timetable",
    title: "4. Timetable",
    description:
      "One row per exam date, session and subject. Leave Centre Code blank when it applies to all centres of that standard.",
  },
  {
    kind: "Points",
    title: "5. Custodian and collection points",
    description:
      "Enter each point, its school location, standard and centres served. A separate row creates another point.",
  },
  {
    kind: "Routes",
    title: "6. Routes",
    description:
      "One row per route officer required. Enter the custodian point and the centres in that point to visit.",
  },
  {
    kind: "Practical",
    title: "7. Practical student groups",
    description:
      "One row per school, group and subject. Include student count, available rooms, receiving school and available exam dates.",
  },
  {
    kind: "History",
    title: "8. Previous duties (optional)",
    description:
      "Only duties imported here are considered for the two-year restriction. Other cycles are not consulted by default.",
  },
];
export async function downloadWorkspaceTemplate(kind?: WorkspaceImportKind) {
  const book = new ExcelJS.Workbook();
  const guide = book.addWorksheet("Instructions");
  guide.addRow(["Input", "How to fill it"]);
  guide.addRows(inputGuide);
  guide.getColumn(1).width = 28;
  guide.getColumn(2).width = 110;
  guide.eachRow((row) => {
    row.alignment = { wrapText: true, vertical: "middle" };
    row.height = 40;
  });
  for (const [name, headers] of Object.entries(WORKSPACE_IMPORT_HEADERS)) {
    if (kind && name !== kind) continue;
    const sheet = book.addWorksheet(
      name === "History" ? "Previous Duties" : name,
    );
    sheet.addRow([...headers]);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns.forEach((column) => {
      column.width = 26;
      column.numFmt = "@";
    });
    for (let n = 0; n < 5; n++) sheet.addRow(headers.map(() => ""));
  }
  for (const sheet of book.worksheets) {
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF183B4C" },
    };
    sheet.getRow(1).height = 28;
  }
  downloadFile(
    kind ? `Erode-${kind}-Input.xlsx` : "Erode-Exam-Inputs.xlsx",
    (await book.xlsx.writeBuffer()) as ArrayBuffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
export async function downloadPracticalSubjects() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Practical subjects");
  sheet.addRow(["Standard", "Subject", "Examiner guidance"]);
  for (const standard of ["10", "12"] as const)
    for (const subject of WORKSPACE_PRACTICAL_SUBJECTS[standard])
      sheet.addRow([standard, subject, standard === "10" ? "BT Assistant handling Class 10 Science" : "Eligible post and matching subject from Teacher Master; confirm the school's offered subjects"]);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [{ width: 12 }, { width: 48 }, { width: 95 }];
  const sources = book.addWorksheet("Sources");
  sources.addRow(["Reference", "Source"]);
  sources.addRows(WORKSPACE_PRACTICAL_SOURCES.map((s) => [s.title, s.url]));
  sources.addRow(["Use", "Subject names are a reference, not student enrolment or an official timetable. Import the actual student counts, groups, rooms and permitted dates before official allotment."]);
  sources.columns = [{ width: 85 }, { width: 130 }];
  downloadFile("Tamil-Nadu-Practical-Subject-Reference.xlsx", (await book.xlsx.writeBuffer()) as ArrayBuffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
export async function downloadWorkspaceReport(
  w: ExamWorkspace,
  run: WorkspaceRun,
  chiefsOnly = false,
) {
  const book = buildWorkspaceReportWorkbook(w, run, chiefsOnly);
  downloadFile(
    workspaceReportFilename(run, chiefsOnly),
    (await book.xlsx.writeBuffer()) as ArrayBuffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
