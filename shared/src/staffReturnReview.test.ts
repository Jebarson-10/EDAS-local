import {expect,it} from "vitest";
import {pendingStaffHealthReviews} from "./staffReturnReview";
import type {Teacher} from "./types";
it("requires a decision for health remarks and accepts an explicit exemption or availability review",()=>{
  const teacher:Teacher={teacherId:"t",name:"Synthetic",employeeCode:"e",schoolId:"s",designation:"PG",isActive:true,dataQuality:"Imported",officialDetails:{"Health, leave or remarks":"Maternity leave"}};
  expect(pendingStaffHealthReviews([teacher],[])).toHaveLength(1);
  expect(pendingStaffHealthReviews([teacher],[{teacherId:"t",isExempted:false,reason:"Staff return reviewed: Maternity leave",effectiveFrom:"1900-01-01"}])).toHaveLength(0);
  expect(pendingStaffHealthReviews([{...teacher,officialDetails:{"Health, leave or remarks":"NIL"}}],[])).toHaveLength(0);
});
