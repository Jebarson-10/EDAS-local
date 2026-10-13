import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_PARAMETERS, type School, type Teacher } from "@exam-duty/shared";
import { allocateTheory, allocateHall, schedulePractical, type TheoryRequirement, type TheoryDataset } from "@exam-duty/allocation-engine";
import { validateTheoryAllocation } from "./theory/validate.js";
import { validateHallAllocation } from "./hall/validate.js";
import { validatePracticalAllocation } from "./practical/validate.js";

const rules = { ...DEFAULT_RULE_PARAMETERS, standby_percentage: 0 };
const school = (schoolId: string, blockId: string): School => ({schoolId,blockId,schoolCode:"",schoolName:schoolId,active:true});
const staff = (teacherId: string, schoolId: string, designation = "PG"): Teacher => ({
  teacherId,employeeCode:teacherId,name:teacherId,schoolId,designation,subject:"PHY",isActive:true,dataQuality:"Confirmed",
});
function data(teachers: Teacher[]): TheoryDataset {
  return {teachers,schools:[school("host","b1"),school("local","b1"),school("cross","b2")],
    centres:[{centreId:"c",centreCode:"001",centreName:"Centre",blockId:"b1",active:true}],
    relationships:[{centreId:"c",schoolId:"host",relationshipType:"HOST",effectiveFrom:"2020-01-01"}],
    exemptions:[],history:[],calendar:[],academicYear:"2027",asOfDate:"2027-03-01"};
}

describe("same-block allotment replaces every distance check", () => {
  it.each([
    ["CHIEF_EXAMINATION","HM","TEACHING"],
    ["DEPARTMENT_OFFICER","PG","TEACHING"],
    ["OFFICE_STAFF","Record Clerk","NON_TEACHING"],
    ["CUSTODIAN","BT","TEACHING"],
  ] as const)("keeps %s inside the current-school block without coordinates", (roleCode,post,staffCategory) => {
    const dataset=data([
      {...staff("a-cross","cross",post),staffCategory,seniorityRank:1,homeLatitude:11.3,homeLongitude:77.7},
      {...staff("z-local","local",post),staffCategory,seniorityRank:20},
    ]);
    const requirement: TheoryRequirement={requirementKey:roleCode,centreId:"c",roleCode,examDate:"2027-03-01",sessionCode:"MORNING",preferredDesignations:[post],fallbackDesignations:[],staffCategory};
    const result=allocateTheory([requirement],dataset,rules);
    expect(result.assignments.map(a=>a.teacherId)).toEqual(["z-local"]);
    expect(validateTheoryAllocation([requirement],result,dataset,rules).errors).toBe(0);
    const forged={...result,assignments:result.assignments.map(a=>({...a,teacherId:"a-cross"}))};
    expect(validateTheoryAllocation([requirement],forged,dataset,rules).issues.some(i=>i.ruleCode==="RULE-THEORY-BLOCK")).toBe(true);
    const shortage=allocateTheory([requirement],{...dataset,teachers:[dataset.teachers[0]!]},{...rules,maximum_distance_km:999999,missing_coordinates_policy:"WARN"});
    expect(shortage.assignments).toHaveLength(0);
    expect(shortage.shortages[0]?.exclusionTallies["RULE-THEORY-BLOCK"]).toBeGreaterThan(0);
    dataset.schools[1]!.blockId="";
    expect(allocateTheory([requirement],dataset,rules).assignments).toHaveLength(0);
  });

  it("keeps hall and standby candidates within the same block and independently rejects a forged assignment", () => {
    const dataset={...data([staff("a-cross","cross"),staff("z-local","local")]),centreSchoolIds:new Map([["c",new Set(["host"])]])};
    const demand=[{centreId:"c",totalStudents:20,examDate:"2027-03-01",sessionCode:"MORNING" as const}];
    const hallRules={...rules,standby_percentage:10};
    const result=allocateHall(demand,dataset,hallRules);
    expect(result.shortages[0]?.shortage).toBe(5);
    expect(result.assignments.map(a=>a.teacherId)).toEqual(["z-local"]);
    const forged={...result,assignments:result.assignments.map(a=>({...a,teacherId:"a-cross"}))};
    expect(validateHallAllocation(forged,demand,hallRules,dataset).issues.some(i=>i.ruleCode==="RULE-HALL-BLOCK")).toBe(true);
    dataset.schools[1]!.blockId="";
    expect(allocateHall(demand,dataset,hallRules).assignments).toHaveLength(0);
  });

  it("uses internal and external practical examiners in the practical school's block", () => {
    const dataset={...data([staff("internal","host"),staff("a-cross","cross"),staff("z-local","local")]),
      pairHistory:[],availableDates:["2027-03-01"],standard:"12",
      internalEligible:(t:Teacher,id:string)=>t.schoolId===id,
      externalEligible:(t:Teacher,id:string)=>t.schoolId!==id};
    const demands=[{schoolId:"host",subjectId:"PHY",studentCount:50}];
    const result=schedulePractical(demands,dataset,rules);
    expect(result.schedules[0]?.externalExaminerId).toBe("z-local");
    expect(validatePracticalAllocation(result,rules,dataset).errors).toBe(0);
    const forged={...result,schedules:result.schedules.map(s=>({...s,externalExaminerId:"a-cross"}))};
    expect(validatePracticalAllocation(forged,rules,dataset).issues.some(i=>i.ruleCode==="RULE-PRACTICAL-BLOCK")).toBe(true);
    dataset.schools[1]!.blockId="";
    const shortage=schedulePractical(demands,dataset,rules);
    expect(shortage.schedules).toHaveLength(0);
    expect(shortage.diagnostics?.[0]?.exclusionTallies["Different block or missing school block"]).toBe(2);
  });
});
