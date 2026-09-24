/** Render real export functions with synthetic data. Never uses client records. */
import {mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {practicalLettersDocx,schoolDutyDocx} from "../frontend/src/lib/schoolDutyDocuments";
import type {SchoolDutyRow} from "@exam-duty/shared";

async function main() {
const output=resolve(process.argv[2] ?? ".qa-reports");
await mkdir(output,{recursive:true});
const common={academicYearLabel:"HSC PRACTICAL EXAMINATION MARCH 2027",districtLabel:"ERODE",schoolNumber:"TEST001",schoolName:"Synthetic Government Higher Secondary School",city:"Test location",place:"Test location",signatoryTitle:"CHIEF EDUCATIONAL OFFICER",signatoryPlace:"ERODE"};
const appointments=["PHYSICS","COMPUTER SCIENCE","BIOLOGY"].map((subject,i)=>({fromDate:"2027-03-01",toDate:"2027-03-01",subject,batchCount:2,externalName:i===1?"தமிழ் ஆசிரியர்":"Synthetic External Examiner",externalSchoolName:"Synthetic Government Girls Higher Secondary School in a Long Named Locality",externalPlace:"Test location",internalName:"Synthetic Internal Examiner"}));
const rows:SchoolDutyRow[]=Array.from({length:9},(_,i)=>({schoolId:i<7?"s1":"s2",schoolName:i<7?common.schoolName:"Second Synthetic School",schoolReference:i<7?"TEST001":"TEST002",teacherName:i===1?"தமிழ் ஆசிரியர்":"Synthetic Teacher "+(i+1),designation:"PG Assistant",subject:"COMPUTER SCIENCE",duty:i%2?"Departmental Officer":"Custodian",teacherSchool:"Synthetic Government Girls Higher Secondary School in a Long Named Locality",dutySchool:common.schoolName,centreCode:"990001",examDate:"2027-03-01",session:i%2?"Afternoon":"Morning",batch:""}));
for(const [name,blob] of [
  ["practical-in",await practicalLettersDocx("in",[{...common,appointments}])],
  ["practical-out",await practicalLettersDocx("out",[{...common,assignments:appointments.map(a=>({subject:a.subject,teacherName:a.externalName,dutySchoolName:a.externalSchoolName,dutyPlace:a.externalPlace,batchCount:a.batchCount,fromDate:a.fromDate,toDate:a.toDate}))}])],
  ["school-in",await schoolDutyDocx("in",rows,"HSC EXAMINATION 2027")],
  ["school-out",await schoolDutyDocx("out",rows,"HSC EXAMINATION 2027")],
] as const) {await writeFile(join(output,`${name}.docx`),Buffer.from(await blob.arrayBuffer()));console.log(name);}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
