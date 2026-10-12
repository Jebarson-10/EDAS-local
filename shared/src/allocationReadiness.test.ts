import { describe, expect, it } from "vitest";
import { blockReadiness } from "./allocationReadiness.js";

describe("block readiness", () => {
  it("needs saved school and centre blocks, regardless of coordinates", () => {
    const result = blockReadiness({
      centres: [{centreId:"c1",centreCode:"1",centreName:"C1",blockId:"b",active:true},
        {centreId:"c2",centreCode:"2",centreName:"C2",blockId:"",active:true}],
      schools: [{schoolId:"s",schoolCode:"",schoolName:"School",blockId:"b",active:true}],
      teachers: [{teacherId:"t1",employeeCode:"1",name:"A",schoolId:"s",designation:"PG",isActive:true,dataQuality:"Confirmed"},
        {teacherId:"t2",employeeCode:"2",name:"B",schoolId:"missing",designation:"PG",isActive:true,dataQuality:"Confirmed"}],
    });
    expect(result).toEqual({centreIdsMissingBlock:["c2"],teacherIdsMissingSchoolBlock:["t2"]});
  });
});
