import {expect,it} from "vitest";
import {buildSchoolDutyRows} from "./schoolDutyReports.js";

it("groups outgoing staff by their current school even when it is not a centre",()=>{
  const result=buildSchoolDutyRows({schools:[{schoolId:"a",schoolName:"Ordinary School",schoolCode:"",sourceSchoolCode:"REF1"},{schoolId:"b",schoolName:"Host School",schoolCode:"C1"}],centres:[{centreId:"c",centreName:"Host School",centreCode:"C1"}],relationships:[{centreId:"c",schoolId:"b",relationshipType:"HOST",effectiveFrom:"2020-01-01"}],teachers:[{teacherId:"t",name:"Example Teacher",schoolId:"a",designation:"PG"},{teacherId:"i",name:"Internal",schoolId:"b",designation:"PG"}],assignments:[{teacherId:"t",centreId:"c",roleCode:"DEPARTMENT_OFFICER",examDate:"2027-03-01",sessionCode:"MORNING"}],practical:[{schoolId:"b",subjectId:"PHY",examDate:"2027-02-01",sessionCode:"AFTERNOON",batchKey:"b|PHY|1",internalExaminerId:"i",externalExaminerId:"t"}]});
  expect(result.dutyIn).toHaveLength(3);
  expect(result.dutyOut).toHaveLength(2);
  expect(result.dutyOut.every(r=>r.schoolId==="a" && r.schoolReference==="REF1")).toBe(true);
  expect(result.dutyIn.every(r=>r.schoolName==="Host School")).toBe(true);
});
