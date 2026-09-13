import { describe, it, expect } from "vitest";
import { previewTeacherImport } from "./importPreview.js";
import { applyTeacherImport } from "./importApply.js";
import { parseTeacherRowsFromAoa, prepareTeacherUpload, normalizeImportedDesignation } from "./excelTeachers.js";
import { buildTeachersTemplateWorkbook, parseTeachersWorkbook } from "./excelReports.js";
const schools = [{schoolId:"s1",schoolCode:"",schoolName:"Ordinary school"},{schoolId:"s2",schoolCode:"350",schoolName:"Centre school"}];
describe("imports without employee codes", () => {
  it("recognises numbered legacy uploads with school names in the code column", () => {
    const parsed = parseTeacherRowsFromAoa([
      ["employeeCode","name","schoolCode","designation","subject","seniorityRank","isActive"],
      [1,"Teacher A","Ordinary school","HEAD MASTER",null,null,1],
      [2,"Teacher B","Centre school","PG'ASST",null,null,1],
    ]);
    const prepared = prepareTeacherUpload(parsed.rows);
    expect(prepared.rows[0]).not.toHaveProperty("employeeCode");
    expect(prepared.rows.map((r) => r.designation)).toEqual(["HM","PG"]);
    const preview = previewTeacherImport(prepared.rows,[],schools);
    expect(preview.newTeachers).toBe(2); expect(preview.invalidRows).toBe(0);
    const result = applyTeacherImport({preview,schools,teachers:[],asOfDate:"2026-09-13"});
    const reordered = prepareTeacherUpload([...parsed.rows].reverse());
    expect(previewTeacherImport(reordered.rows,result.teachers.map((t)=>({...t,schoolCode:t.schoolId})),schools).unchanged).toBe(2);
    expect(prepared.notes.some((n) => n.includes("seniority"))).toBe(true);
    expect(prepareTeacherUpload(parsed.rows,true).rows[0]?.employeeCode).toBe("1");
  });
  it("keeps acting headmaster posts distinct until the user confirms them", () => {
    expect(normalizeImportedDesignation("HEADMASTER")).toBe("HM");
    expect(normalizeImportedDesignation("PG ASST")).toBe("PG");
    expect(normalizeImportedDesignation("HEAD MASTER I/C")).toBe("HEAD MASTER I/C");
    expect(prepareTeacherUpload([{designation:"HEADMASTER I/C"}]).notes.some((n)=>n.includes("Confirm these designations"))).toBe(true);
  });
  it("does not guess missing or ambiguous schools from a name under schoolCode", () => {
    const row = {name:"Teacher",schoolCode:"Ordinary school",schoolName:null,designation:"PG"};
    expect(previewTeacherImport([row],[],schools).newTeachers).toBe(1);
    const missing = previewTeacherImport([row],[],[]);
    expect(missing.invalidRows).toBe(1);
    expect(missing.rows[0]?.teacherName).toBe("Teacher");
    expect(missing.rows[0]?.message).toContain("Ordinary school");
    expect(previewTeacherImport([row],[],[...schools,{...schools[0]!,schoolId:"duplicate"}]).invalidRows).toBe(1);
  });
  it("round-trips the user template with simple headings and a blank centre code", async () => {
    const workbook = await buildTeachersTemplateWorkbook([{name:"Teacher",schoolName:"Ordinary school",designation:"PG",subject:"PHY",seniorityRank:1,homeLatitude:11.3,homeLongitude:77.7}]);
    const parsed = await parseTeachersWorkbook(workbook);
    expect(parsed.headerErrors).toEqual([]);
    expect(parsed.rows[0]).not.toHaveProperty("employeeCode");
    expect(previewTeacherImport(parsed.rows,[],schools).newTeachers).toBe(1);
  });
  it("accepts school names in Excel with no employee code column", () => {
    const parsed = parseTeacherRowsFromAoa([["Teacher name","School name","Designation"],["Teacher","Ordinary school","PG"]]);
    expect(parsed.headerErrors).toEqual([]);
    const preview = previewTeacherImport(parsed.rows,[],schools);
    expect(preview.newTeachers).toBe(1);
    const applied = applyTeacherImport({preview,schools,teachers:[],asOfDate:"2026-09-12"});
    expect(applied.teachers[0]?.schoolId).toBe("s1");
    const again = previewTeacherImport(parsed.rows,applied.teachers.map((t)=>({...t,schoolCode:t.schoolId})),schools);
    expect(again.unchanged).toBe(1);
    expect(again.newTeachers).toBe(0);
  });
  it("resolves a centre code but rejects unknown or conflicting schools", () => {
    expect(previewTeacherImport([{name:"A",schoolCode:"350",designation:"PG"}],[],schools).newTeachers).toBe(1);
    expect(previewTeacherImport([{name:"A",schoolCode:"350",schoolName:"Ordinary school",designation:"PG"}],[],schools).invalidRows).toBe(1);
    expect(previewTeacherImport([{name:"A",schoolName:"Missing",designation:"PG"}],[],schools).invalidRows).toBe(1);
  });
  it("does not silently merge duplicate names", () => {
    const row = {name:"Same",schoolName:"Ordinary school",designation:"PG"};
    const preview = previewTeacherImport([row,row],[],schools);
    expect(preview.newTeachers).toBe(0); expect(preview.duplicates).toBe(2);
    const existing = ["1","2"].map((employeeCode)=>({employeeCode,name:"Same",schoolCode:"s1",designation:"PG",isActive:true}));
    expect(previewTeacherImport([row],existing,schools).invalidRows).toBe(1);
  });
});
