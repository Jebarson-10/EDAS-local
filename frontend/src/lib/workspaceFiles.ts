import ExcelJS from "exceljs";
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
const roleLabel: Record<string, string> = {
  CHIEF: "Chief superintendent",
  DEPARTMENT: "Departmental officer",
  INVIGILATOR: "Hall invigilator",
  BACKUP: "Backup invigilator",
  JUNIOR_ASSISTANT: "Junior assistant",
  OFFICE_ASSISTANT: "Office assistant",
  CUSTODIAN: "Custodian",
  SECONDARY_CUSTODIAN: "Secondary custodian",
  LIAISON: "Liaison officer",
  SECONDARY_LIAISON: "Secondary liaison officer",
  ROUTE: "Route officer",
  SQUAD: "Squad",
  INTERNAL: "Internal examiner",
  EXTERNAL: "External examiner",
};
export const workspaceRoleLabel = (role: string) => roleLabel[role] ?? role;
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
  const book = new ExcelJS.Workbook();
  const staff = new Map(w.staff.map((t) => [t.staffId, t]));
  const schools = new Map(w.schools.map((s) => [s.udise, s]));
  if (run.module === "PRACTICAL") {
    const sheet = book.addWorksheet("Practical duties");
    sheet.addRow([
      "Centre code",
      "Receiving school",
      "Student school",
      "Subject",
      "Batch",
      "Students",
      "Date",
      "Session",
      "Internal examiner",
      "External examiner",
      "External school",
    ]);
    for (const a of run.assignments
      .filter((a) => a.role === "EXTERNAL")
      .sort(
        (a, b) =>
          a.centreUdise.localeCompare(b.centreUdise) ||
          a.date.localeCompare(b.date) ||
          a.subject.localeCompare(b.subject) ||
          (a.batch ?? 0) - (b.batch ?? 0),
      )) {
      const internal = run.assignments.find(
        (i) =>
          i.demandId === a.demandId &&
          i.batch === a.batch &&
          i.role === "INTERNAL",
      );
      const demand = w.practical.find(
        (p) => p.id === a.demandId && p.standard === run.standard,
      );
      sheet.addRow([
        a.centreCode,
        schools.get(a.centreUdise)?.name,
        schools.get(demand?.udise ?? "")?.name,
        a.subject,
        a.batch,
        a.students,
        a.date,
        a.session,
        staff.get(internal?.staffId ?? "")?.name,
        staff.get(a.staffId)?.name,
        schools.get(staff.get(a.staffId)?.udise ?? "")?.name,
      ]);
    }
  } else {
    const sheet = book.addWorksheet(
      chiefsOnly ? "Chief and department" : "Centre duties",
    );
    sheet.addRow([
      "Centre code",
      "Centre school",
      "Duty",
      "Staff name",
      "Staff post",
      "From school",
      "Dates",
      "Session",
    ]);
    const order = [
      "CHIEF",
      "DEPARTMENT",
      "INVIGILATOR",
      "BACKUP",
      "JUNIOR_ASSISTANT",
      "OFFICE_ASSISTANT",
    ];
    const rows = run.assignments.filter((a) =>
      (chiefsOnly ? ["CHIEF", "DEPARTMENT"] : order).includes(a.role),
    );
    const grouped = new Map<string, typeof rows>();
    for (const a of rows) {
      const k = `${a.centreCode}|${a.role}|${a.staffId}|${a.session}`;
      const values = grouped.get(k) ?? [];
      values.push(a);
      grouped.set(k, values);
    }
    for (const group of [...grouped.values()].sort(
      (a, b) =>
        a[0]!.centreCode.localeCompare(b[0]!.centreCode, "en", {
          numeric: true,
        }) ||
        order.indexOf(a[0]!.role) - order.indexOf(b[0]!.role) ||
        a[0]!.staffId.localeCompare(b[0]!.staffId),
    )) {
      const a = group[0]!,
        teacher = staff.get(a.staffId);
      sheet.addRow([
        a.centreCode,
        schools.get(a.centreUdise)?.name,
        workspaceRoleLabel(a.role),
        teacher?.name,
        teacher?.originalPost,
        schools.get(teacher?.udise ?? "")?.name,
        [...new Set(group.map((g) => g.date))].sort().join(", "),
        a.session,
      ]);
    }
    if (!chiefsOnly) {
      const officers = book.addWorksheet("Other officers");
      officers.addRow([
        "Point or centre",
        "Duty",
        "Staff",
        "School",
        "Date",
        "Session",
      ]);
      for (const a of run.assignments.filter((a) => !order.includes(a.role)))
        officers.addRow([
          a.centreCode,
          workspaceRoleLabel(a.role),
          staff.get(a.staffId)?.name,
          schools.get(staff.get(a.staffId)?.udise ?? "")?.name,
          a.date,
          a.session,
        ]);
    }
  }
  for (const sheet of book.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns.forEach((c) => {
      c.width = 27;
    });
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF183B4C" },
    };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.pageSetup = {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:1",
    };
    sheet.headerFooter = {
      oddHeader: `${run.standard}th ${run.module.toLowerCase()} duties${run.published ? "" : " - DRAFT"}`,
      oddFooter: "Page &P of &N",
    };
    sheet.eachRow((row) => {
      row.alignment = { wrapText: true, vertical: "middle" };
      row.height = 42;
    });
  }
  const manual = run.assignments.filter((a) => a.manual);
  if (manual.length) {
    const changes = book.addWorksheet("Manual changes");
    changes.addRow(["Centre or point", "Duty", "Staff", "Date", "Session", "Distance exception", "Reason", "Approved at", "Previous list"]);
    for (const a of manual) changes.addRow([a.centreCode, workspaceRoleLabel(a.role), staff.get(a.staffId)?.name,
      a.date, a.session, a.manual!.distanceException ? "Approved" : "No", a.manual!.reason, a.manual!.approvedAt, a.manual!.parentRunId]);
    changes.views = [{ state: "frozen", ySplit: 1 }];
    changes.columns.forEach((c) => { c.width = 28; });
    changes.getColumn(7).width = 65;
    changes.getRow(1).font = { bold: true };
  }
  if (run.shortages.length || run.errors.length) {
    const issues = book.addWorksheet("Unfilled duties");
    issues.addRow(["Centre or point", "Duty", "Missing", "Dates", "Reason"]);
    for (const gap of run.shortages)
      issues.addRow([
        gap.target,
        workspaceRoleLabel(gap.role),
        gap.missing,
        gap.date,
        Object.entries(gap.reasons)
          .map(([reason, n]) => `${reason}: ${n}`)
          .join("; "),
      ]);
    for (const error of run.errors) issues.addRow(["", "", "", "", error]);
    issues.columns.forEach((c) => {
      c.width = 30;
    });
    issues.getColumn(5).width = 75;
    issues.eachRow((row) => {
      row.alignment = { wrapText: true, vertical: "top" };
      row.height = 45;
    });
  }
  downloadFile(
    `${run.standard}-${run.module.toLowerCase()}-${chiefsOnly ? "chiefs-" : ""}${!run.published || run.shortages.length || run.errors.length ? "DRAFT-" : ""}${run.id.slice(0, 8)}.xlsx`,
    (await book.xlsx.writeBuffer()) as ArrayBuffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
