/** Read-only audit of an operator's OVER ALL return. Prints counts, never staff identities. */
import ExcelJS from "exceljs";
import {parseOfficialStaffWorkbook, inferSchoolLevel, officePost} from "../shared/src/index.ts";
async function main() {
const path=process.argv[2];
if (!path) throw new Error("Pass the OVER ALL workbook path.");
const workbook=new ExcelJS.Workbook();
await workbook.xlsx.readFile(path);
const parsed=parseOfficialStaffWorkbook(workbook.worksheets.map(sheet => ({
  name:sheet.name,
  lines:Array.from({length:sheet.rowCount},(_,i)=>(sheet.getRow(i+1).values as unknown[]).slice(1,46)),
})));
const pg=parsed.rows.filter(r=>["PG","SENIOR_PG"].includes(String(r.designation)));
const hm=parsed.rows.filter(r=>["HM","PRINCIPAL"].includes(String(r.designation)));
const office=parsed.rows.filter(r=>r.staffCategory==="NON_TEACHING");
const schoolKey=(r:Record<string,unknown>)=>String(r.sourceSchoolCode || r.schoolName).trim().toUpperCase().replace(/\s+/g," ");
const schoolBlocks=new Map<string,Set<string>>();
for(const r of parsed.rows){ const block=(r.officialDetails as Record<string,string>)?.["Reporting block"]; if(block){const blocks=schoolBlocks.get(schoolKey(r))??new Set<string>();blocks.add(block);schoolBlocks.set(schoolKey(r),blocks);} }
const report={
  sheets:parsed.detectedSheetNames,
  staffRows:parsed.rows.length,
  pgStaff:pg.length,
  pgMissingAppointmentDate:pg.filter(r=>!r.joiningDate).length,
  chiefSchoolLevels:{
    higherSecondary:hm.filter(r=>inferSchoolLevel(String(r.schoolName))==="HIGHER_SECONDARY").length,
    highSchool:hm.filter(r=>inferSchoolLevel(String(r.schoolName))==="HIGH").length,
    needsManualConfirmation:hm.filter(r=>!inferSchoolLevel(String(r.schoolName))).length,
  },
  officeStaff:office.length,
  officePosts:Object.fromEntries(["JUNIOR_ASSISTANT","OFFICE_ASSISTANT","RECORD_CLERK"].map(post=>[post,office.filter(r=>officePost(String(r.designation))===post).length])),
  otherOrUnclearOfficePosts:office.filter(r=>!officePost(String(r.designation))).length,
  unresolvedSchoolBlocks:new Set(parsed.rows.filter(r=>!schoolBlocks.has(schoolKey(r))).map(schoolKey)).size,
  conflictingSchoolBlocks:[...schoolBlocks.values()].filter(blocks=>blocks.size>1).length,
  missingBlockOnIndividualRows:parsed.rows.filter(r=>!r.officialDetails || !(r.officialDetails as Record<string,string>)["Reporting block"]).length,
  pgMissingHandlingSubject:pg.filter(r=>!r.subject).length,
  warnings:parsed.warnings.length,
  separateInputsRequired:["13A centre codes and student strength","Timetable dates, sessions and subjects","Dated previous duties","Practical students per school and subject","Health/leave decisions"],
};
console.log(JSON.stringify(report,null,2));

}
void main().catch(error => {console.error(error.message);process.exitCode=1;});
