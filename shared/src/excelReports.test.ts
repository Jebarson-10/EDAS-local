import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildCompleteAllotmentWorkbook,
  buildOfficialStaffTemplateWorkbook,
  buildTeacherWiseWorkbook,
  formatDutyRole,
  type WorkbookMeta,
} from "./excelReports.js";

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

describe("user-facing duty reports", () => {
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
