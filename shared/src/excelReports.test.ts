import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildCentreDutyOrder,
  buildCentreWiseTheoryDutyWorkbook,
  buildChiefAndDepartmentWorkbook,
  buildCompleteAllotmentWorkbook,
  buildOfficialStaffTemplateWorkbook,
  buildPracticalExaminerWorkbook,
  buildTeacherWiseWorkbook,
  formatDutyRole,
  type WorkbookMeta,
} from "./excelReports.js";
import type { Centre, School, Teacher } from "./types.js";

const meta: WorkbookMeta = {
  title: "Test report",
  examCycle: "HSC 2027",
  generatedAt: "2027-01-01T00:00:00.000Z",
  ruleVersion: "rules-1",
  allocationRun: "run-1",
  officer: "ADMIN",
  dataVersion: "test",
};

async function readSheet(buffer: ArrayBuffer, name: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.getWorksheet(name)!;
}

const reportSchool: School = {
  schoolId: "school-1",
  schoolCode: "220001",
  schoolName: "Example Government Higher Secondary School",
  blockId: "block-1",
  active: true,
};

const reportCentre: Centre = {
  centreId: "centre-1",
  centreCode: "220001",
  centreName: "Example Government Higher Secondary School",
  blockId: "block-1",
  capacity: 501,
  active: true,
};

function reportTeacher(
  teacherId: string,
  name: string,
  designation: string,
  subject = "",
): Teacher {
  return {
    teacherId,
    employeeCode: teacherId,
    name,
    schoolId: reportSchool.schoolId,
    designation,
    subject,
    isActive: true,
    dataQuality: "Imported",
    officialDetails: { "Mobile number": "9000000000" },
  };
}

const reportTeachers = [
  reportTeacher("chief", "Chief Teacher", "HM"),
  reportTeacher("department-1", "Department One", "PG", "Physics"),
  reportTeacher("department-2", "Department Two", "PG", "Chemistry"),
  reportTeacher("office-1", "Office One", "Office staff"),
  reportTeacher("office-2", "Office Two", "Office staff"),
  reportTeacher("hall", "Hall Teacher", "BT", "Mathematics"),
  reportTeacher("standby", "Standby Teacher", "SPL", "Tamil"),
];

const theoryDutyInput = {
  title: "HSC 2027",
  centres: [reportCentre],
  schools: [reportSchool],
  teachers: reportTeachers,
  theoryAssignments: [
    { centreId: "centre-1", teacherId: "chief", roleCode: "CHIEF_EXAMINATION" as const, examDate: "2027-03-01", sessionCode: "MORNING" },
    { centreId: "centre-1", teacherId: "chief", roleCode: "CHIEF_EXAMINATION" as const, examDate: "2027-03-02", sessionCode: "AFTERNOON" },
    { centreId: "centre-1", teacherId: "department-1", roleCode: "DEPARTMENT_OFFICER" as const, examDate: "2027-03-01", sessionCode: "MORNING" },
    { centreId: "centre-1", teacherId: "department-2", roleCode: "DEPARTMENT_OFFICER" as const, examDate: "2027-03-01", sessionCode: "MORNING" },
    { centreId: "centre-1", teacherId: "office-1", roleCode: "OFFICE_STAFF" as const, examDate: "2027-03-01", sessionCode: "MORNING" },
    { centreId: "centre-1", teacherId: "office-2", roleCode: "OFFICE_STAFF" as const, examDate: "2027-03-01", sessionCode: "MORNING" },
  ],
  hallAssignments: [
    { centreId: "centre-1", teacherId: "hall", roleCode: "HALL_INVIGILATOR" as const, examDate: "2027-03-01", sessionCode: "MORNING" },
    { centreId: "centre-1", teacherId: "hall", roleCode: "HALL_INVIGILATOR" as const, examDate: "2027-03-02", sessionCode: "AFTERNOON" },
    { centreId: "centre-1", teacherId: "standby", roleCode: "HALL_STANDBY" as const, examDate: "2027-03-01", sessionCode: "MORNING" },
  ],
};

describe("user-facing duty reports", () => {
  it("groups every required theory role under one centre without repeating staff by session", () => {
    const centres = buildCentreDutyOrder(theoryDutyInput);
    expect(centres).toHaveLength(1);
    expect(centres[0]?.chiefExaminers).toHaveLength(1);
    expect(centres[0]?.chiefExaminers[0]?.dutyTimes).toEqual([
      "2027-03-01 Morning",
      "2027-03-02 Afternoon",
    ]);
    expect(centres[0]?.departmentalOfficers).toHaveLength(2);
    expect(centres[0]?.officeHelpers).toHaveLength(2);
    expect(centres[0]?.hallTeam).toHaveLength(2);
    expect(centres[0]?.hallTeam[0]?.teacherName).toBe("Hall Teacher");
    expect(centres[0]?.hallTeam[1]?.roleCode).toBe("HALL_STANDBY");
  });

  it("creates a centre-by-centre duty order in the requested officer and hall layout", async () => {
    const buffer = await buildCentreWiseTheoryDutyWorkbook(theoryDutyInput);
    const sheet = await readSheet(buffer, "220001");
    expect(sheet.getCell("A1").text).toBe("THEORY EXAMINATION - DUTY ORDER");
    expect(sheet.getCell("A3").text).toBe("Centre");
    expect(sheet.getCell("C3").text).toContain("220001");
    expect(sheet.getCell("A4").text).toBe("Chief examiner");
    expect(sheet.getCell("C4").text).toContain("Chief Teacher");
    expect(sheet.getCell("A5").text).toBe("Departmental officer");
    expect(sheet.getCell("C5").text).toContain("Department One");
    expect(sheet.getCell("A6").text).toBe("Office helpers (non-teaching)");
    expect(sheet.getCell("C6").text).toContain("Office One");
    expect(sheet.getRow(8).values).toContain("Name of invigilator");
    expect(sheet.getRow(9).values).toContain("Hall Teacher");
    expect(sheet.getRow(10).values).toContain("Standby Teacher");
    expect(sheet.getRow(9).values).toContain("2027-03-01 Morning; 2027-03-02 Afternoon");
  });

  it("creates the optional chief and departmental officer reference without unrelated duty rows", async () => {
    const buffer = await buildChiefAndDepartmentWorkbook(theoryDutyInput);
    const sheet = await readSheet(buffer, "Chief and department");
    expect(sheet.getRow(3).values).toEqual([
      undefined,
      "Centre code",
      "Centre name",
      "Chief examiner",
      "Departmental officer",
    ]);
    expect(sheet.getRow(4).getCell(3).text).toContain("Chief Teacher");
    expect(sheet.getRow(4).getCell(4).text).toContain("Department One");
    expect(sheet.getRow(4).values).not.toContain("Hall Teacher");
  });

  it("creates one practical row per school and subject with examiner names and batch count", async () => {
    const buffer = await buildPracticalExaminerWorkbook({
      title: "HSC 2027",
      schools: [reportSchool],
      teachers: reportTeachers,
      schedules: [
        { batchKey: "physics-1", schoolId: "school-1", subjectId: "Physics", examDate: "2027-02-21", sessionCode: "MORNING", internalExaminerId: "department-1", externalExaminerId: "department-2" },
        { batchKey: "physics-2", schoolId: "school-1", subjectId: "Physics", examDate: "2027-02-21", sessionCode: "AFTERNOON", internalExaminerId: "department-1", externalExaminerId: "department-2" },
      ],
    });
    const sheet = await readSheet(buffer, "Practical examiners");
    expect(sheet.getRow(3).values).toContain("Batches");
    expect(sheet.getRow(4).values).toContain(2);
    expect(sheet.getRow(4).values).toContain("Department One");
    expect(sheet.getRow(4).values).toContain("Department Two");
    expect(sheet.getRow(4).values).not.toContain("department-1");
  });

  it("uses simple duty names for known and future role codes", () => {
    expect(formatDutyRole("CHIEF_EXAMINATION")).toBe("Chief examiner");
    expect(formatDutyRole("DEPARTMENT_OFFICER")).toBe("Departmental officer");
    expect(formatDutyRole("OFFICE_STAFF")).toBe("Office staff");
    expect(formatDutyRole("Office staff")).toBe("Office staff");
    expect(formatDutyRole("SOME_FUTURE_ROLE")).toBe("Some Future Role");
  });

  it("does not put internal employee or teacher codes in the teacher-wise workbook", async () => {
    const buffer = await buildTeacherWiseWorkbook(meta, [
      {
        Teacher: "Test Teacher",
        EmployeeCode: "INTERNAL-EMPLOYEE-CODE",
        TeacherCode: "INTERNAL-TEACHER-CODE",
        School: "Test School",
        DutyType: "THEORY",
        Centre: "Centre A",
        Date: "2027-03-01",
        Session: "MORNING",
        Role: "CHIEF_EXAMINATION",
      },
    ]);
    const sheet = await readSheet(buffer, "Teacher-wise");
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    const values = (sheet.getRow(2).values as unknown[]).slice(1);

    expect(headers).toEqual([
      "Teacher",
      "School",
      "Duty",
      "Centre",
      "Date",
      "Session",
      "Duty role",
      "Subject",
    ]);
    expect(values).toContain("Chief examiner");
    expect(values).not.toContain("INTERNAL-EMPLOYEE-CODE");
    expect(values).not.toContain("INTERNAL-TEACHER-CODE");
  });

  it("keeps the complete workbook code-free while showing readable centre roles", async () => {
    const buffer = await buildCompleteAllotmentWorkbook(
      meta,
      [
        {
          Teacher: "Test Teacher",
          EmployeeCode: "INTERNAL-EMPLOYEE-CODE",
          TeacherCode: "INTERNAL-TEACHER-CODE",
          School: "Test School",
          DutyType: "THEORY",
          Centre: "Centre A",
          Date: "2027-03-01",
          Session: "MORNING",
          Role: "OFFICE_STAFF",
        },
      ],
      [],
      [
        {
          Centre: "Centre A",
          Movement: "Coming to this centre",
          Teacher: "Test Teacher",
          "Teacher school": "Test School",
          "Duty role": "OFFICE_STAFF",
          "Duty centre": "Centre A",
          Date: "2027-03-01",
          Session: "MORNING",
        },
      ],
    );
    const teacherSheet = await readSheet(buffer, "Teacher-wise");
    const centreSheet = await readSheet(buffer, "Centre-wise");
    const teacherHeaders = (teacherSheet.getRow(1).values as unknown[]).slice(1);
    const teacherValues = (teacherSheet.getRow(2).values as unknown[]).slice(1);
    const centreValues = (centreSheet.getRow(2).values as unknown[]).slice(1);

    expect(teacherHeaders).not.toContain("EmployeeCode");
    expect(teacherValues).not.toContain("INTERNAL-EMPLOYEE-CODE");
    expect(teacherValues).not.toContain("INTERNAL-TEACHER-CODE");
    expect(teacherValues).toContain("Office staff");
    expect(centreValues).toContain("Office staff");
  });

  it("keeps the centre-wise list sorted with incoming and outgoing staff", async () => {
    const workbook = await buildCompleteAllotmentWorkbook(meta, [], [], [
      { Centre: "Centre B", Movement: "Coming to this centre", Teacher: "Teacher B", "Teacher school": "School B", "Duty role": "DEPARTMENT_OFFICER", "Duty centre": "Centre B", Date: "2027-03-02", Session: "MORNING" },
      { Centre: "Centre A", Movement: "Going out from this centre", Teacher: "Teacher A", "Teacher school": "School A", "Duty role": "CHIEF_EXAMINATION", "Duty centre": "Centre B", Date: "2027-03-01", Session: "MORNING" },
    ]);
    const workbookData = new ExcelJS.Workbook();
    await workbookData.xlsx.load(workbook);
    const sheet = workbookData.getWorksheet("Centre-wise")!;
    expect(sheet.getRow(2).getCell(1).value).toBe("Centre A");
    expect(sheet.getRow(2).getCell(5).value).toBe("Chief examiner");
  });

  it("creates the seven official staff-return sheets", async () => {
    const buffer = await buildOfficialStaffTemplateWorkbook();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(
      ["HM", "PG", "BT", "BT NON", "SGT", "SPL", "NON TEACHING"],
    );
    expect(workbook.getWorksheet("PG")?.getRow(2).values).toContain("11,12TH HANDLING SUBJECT");
    expect(workbook.getWorksheet("BT")?.getRow(2).values).toContain("10TH HANDLING SUBJECT");
  });
});
