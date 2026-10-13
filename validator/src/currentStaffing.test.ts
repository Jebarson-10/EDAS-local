import {describe,expect,it} from "vitest";
import {DEFAULT_RULE_PARAMETERS,buildCentreStaffingRequirements,buildHallDemands,type Teacher} from "@exam-duty/shared";
import {allocateTheory,allocateHall,calculateHallRequirements,type TheoryDataset} from "@exam-duty/allocation-engine";
import {validateTheoryAllocation,validateHallAllocation} from "./index.js";
const rules=DEFAULT_RULE_PARAMETERS;
const teacher=(teacherId:string,designation:string,subject="MAT",joiningDate="2010-06-01"):Teacher=>({
  teacherId,employeeCode:teacherId,name:teacherId,schoolId:"local",designation,subject,joiningDate,isActive:true,dataQuality:"Confirmed",
  staffCategory:["HM","PRINCIPAL","PG","BT"].includes(designation)?"TEACHING":"NON_TEACHING",
});
function fixture(strength=200){
  const dataset:TheoryDataset={
    teachers:[teacher("hm","HM"),teacher("older","PG","PHY","2001-06-01"),teacher("younger","PG","ENG","2018-06-01"),teacher("ja","Junior Assistant"),teacher("oa","OA"),teacher("rc","Record Clerk"),teacher("lab","Lab Assistant")],
    schools:[{schoolId:"host",schoolCode:"C1",schoolName:"GHSS Host",blockId:"b1",active:true},{schoolId:"local",schoolCode:"",schoolName:"GHSS Local",blockId:"b1",active:true}],
    centres:[{centreId:"c",centreCode:"C1",centreName:"GHSS Host",blockId:"b1",capacity:strength,active:true}],
    relationships:[{centreId:"c",schoolId:"host",relationshipType:"HOST",effectiveFrom:"2020-01-01"}],
    exemptions:[],history:[],calendar:[],academicYear:"2027",asOfDate:"2027-03-01",
  };
  const timetable=["2027-03-01","2027-03-03"].map((examDate,i)=>({timetableEntryId:String(i),examDate,sessionCode:"MORNING" as const,subjectLabel:i?"Science":"English",requiresChief:true,requiresHall:true}));
  const plan=buildCentreStaffingRequirements({timetable,centres:dataset.centres,relationships:dataset.relationships,rules,standard:"12"});
  return {dataset,timetable,requirements:plan.requirements};
}
describe("confirmed October 2026 centre staffing",()=>{
  it("calculates two extra halls and exactly three backups at every non-empty centre",()=>{
    expect(calculateHallRequirements(200,20,10)).toEqual({requiredHalls:12,standby:3});
    expect(calculateHallRequirements(201,20,10)).toEqual({requiredHalls:13,standby:3});
    expect(calculateHallRequirements(20,20,99)).toEqual({requiredHalls:3,standby:3});
    expect(calculateHallRequirements(0,20,10)).toEqual({requiredHalls:0,standby:0});
  });
  it("keeps one higher-secondary chief throughout the timetable and selects PG staff by appointment date",()=>{
    const {dataset,requirements}=fixture();
    dataset.teachers.find(t=>t.teacherId==="older")!.seniorityRank=9999;
    dataset.teachers.find(t=>t.teacherId==="younger")!.seniorityRank=1;
    const result=allocateTheory(requirements,dataset,rules);
    expect(result.feasible).toBe(true);
    expect(result.assignments.filter(a=>a.roleCode==="CHIEF_EXAMINATION").map(a=>a.teacherId)).toEqual(["hm","hm"]);
    expect(result.assignments.filter(a=>a.roleCode==="DEPARTMENT_OFFICER").every(a=>a.teacherId==="older")).toBe(true);
    expect(result.assignments.filter(a=>a.roleCode==="OFFICE_STAFF").map(a=>a.teacherId).sort()).toEqual(["ja","ja","oa","oa"]);
    expect(validateTheoryAllocation(requirements,result,dataset,rules).errors).toBe(0);
    const forged={...result,assignments:result.assignments.map(a=>a.roleCode==="DEPARTMENT_OFFICER"?{...a,teacherId:"younger"}:a)};
    expect(validateTheoryAllocation(requirements,forged,dataset,rules).issues.some(i=>i.ruleCode==="RULE-DEPARTMENT-SENIORITY")).toBe(true);
  });
  it("does not swap chiefs on different dates when no HM is available for the entire timetable",()=>{
    const {dataset,requirements}=fixture();
    dataset.teachers.push(teacher("second-hm","HM"));
    dataset.exemptions=[{teacherId:"hm",isExempted:true,effectiveFrom:"2027-03-03",reason:"Leave"},{teacherId:"second-hm",isExempted:true,effectiveFrom:"2027-03-01",effectiveTo:"2027-03-01",reason:"Leave"}];
    const result=allocateTheory(requirements,dataset,rules);
    expect(result.assignments.filter(a=>a.roleCode==="CHIEF_EXAMINATION")).toHaveLength(0);
    expect(result.shortages.filter(s=>s.requirementKey.includes("CHIEF_EXAMINATION"))).toHaveLength(2);
  });
  it("independently rejects a forged change of chief and a high-school HM",()=>{
    const {dataset,requirements}=fixture();
    dataset.teachers.push(teacher("second-hm","HM"));
    const result=allocateTheory(requirements,dataset,rules);
    let changed=false;
    const forged={...result,assignments:result.assignments.map(a=>{
      if(a.roleCode==="CHIEF_EXAMINATION"&&!changed){changed=true;return {...a,teacherId:"second-hm"};}return a;
    })};
    expect(validateTheoryAllocation(requirements,forged,dataset,rules).issues.some(i=>i.ruleCode==="RULE-THEORY-CONTINUITY")).toBe(true);
    dataset.schools[1]!.schoolLevel="HIGH";
    const highSchool=allocateTheory(requirements,dataset,rules);
    expect(highSchool.assignments.filter(a=>a.roleCode==="CHIEF_EXAMINATION")).toHaveLength(0);
  });
  it("requires a PG appointment date, two distinct officers above 500 and RC only for the OA vacancy",()=>{
    const {dataset,requirements}=fixture(501);
    dataset.teachers=dataset.teachers.filter(t=>t.teacherId!=="oa");
    dataset.teachers.push({...teacher("no-date","PG"),joiningDate:null,seniorityRank:0});
    const result=allocateTheory(requirements,dataset,rules);
    expect(result.feasible).toBe(true);
    for(const date of ["2027-03-01","2027-03-03"]){
      expect(new Set(result.assignments.filter(a=>a.roleCode==="DEPARTMENT_OFFICER"&&a.examDate===date).map(a=>a.teacherId))).toEqual(new Set(["older","younger"]));
      expect(result.assignments.find(a=>a.roleCode==="OFFICE_STAFF"&&a.examDate===date&&a.usedFallbackBand)?.teacherId).toBe("rc");
    }
    dataset.teachers=dataset.teachers.filter(t=>t.teacherId!=="ja");
    const missingJa=allocateTheory(requirements,dataset,rules);
    expect(missingJa.assignments.some(a=>a.teacherId==="lab")).toBe(false);
    expect(missingJa.shortages.filter(s=>s.requirementKey.endsWith("OFFICE_STAFF|1"))).toHaveLength(2);
  });
  it("excludes the examined subject from both invigilation and backup and validates actual per-session counts",()=>{
    const {dataset,timetable}=fixture();
    dataset.teachers=Array.from({length:18},(_,i)=>teacher("math-"+String(i).padStart(2,"0"),"BT","MAT"));
    dataset.teachers.push(teacher("english","PG","English"),teacher("science","BT","Science"),{...teacher("additional-english","PG","BIO"),officialDetails:{"Additional handling subjects":"ENGLISH"}});
    const demands=buildHallDemands({timetable,centres:dataset.centres,relationships:dataset.relationships});
    const hallData={...dataset,centreSchoolIds:new Map([["c",new Set(["host"])]])};
    const result=allocateHall(demands,hallData,rules);
    expect(result.feasible).toBe(true);
    expect(result.assignments).toHaveLength(30);
    expect(result.assignments.filter(a=>a.examDate==="2027-03-01").some(a=>["english","additional-english"].includes(a.teacherId))).toBe(false);
    expect(result.assignments.filter(a=>a.examDate==="2027-03-03").some(a=>["science","additional-english"].includes(a.teacherId))).toBe(false);
    expect(validateHallAllocation(result,demands,rules,hallData).errors).toBe(0);
    const forged={...result,assignments:result.assignments.map((a,i)=>i===0?{...a,teacherId:"english"}:a)};
    expect(validateHallAllocation(forged,demands,rules,hallData).issues.some(i=>i.ruleCode==="RULE-HALL-EXAM-SUBJECT")).toBe(true);
    const missing={...result,assignments:result.assignments.slice(1)};
    expect(validateHallAllocation(missing,demands,rules,hallData).issues.some(i=>i.ruleCode==="RULE-HALL-STAFF-COUNT")).toBe(true);
  });
});
