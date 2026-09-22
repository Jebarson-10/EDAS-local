import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildCompleteAllotmentWorkbook,
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
          Teachers: "2",
          Roles: "CHIEF_EXAMINATION, DEPARTMENT_OFFICER, OFFICE_STAFF",
          Dates: "2027-03-01",
          Sessions: "MORNING",
          Standby: "0",
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
    expect(centreValues).toContain(
      "Chief examiner, Departmental officer, Office staff",
    );
  });
});
