import { formatDutyRole } from "./excelReports.js";
import type { CentreSchoolRelationship, SessionCode } from "./types.js";

export interface SchoolDutyRow {
  schoolId: string;
  schoolName: string;
  schoolReference: string;
  teacherName: string;
  designation: string;
  subject: string;
  duty: string;
  teacherSchool: string;
  dutySchool: string;
  centreCode: string;
  examDate: string;
  session: string;
  batch: string;
}

export function buildSchoolDutyRows(input: {
  schools: Array<{schoolId:string;schoolName:string;schoolCode:string;sourceSchoolCode?:string}>;
  centres: Array<{centreId:string;centreName:string;centreCode:string}>;
  teachers: Array<{teacherId:string;name:string;schoolId:string;designation:string;subject?:string|null}>;
  relationships: CentreSchoolRelationship[];
  assignments: Array<{teacherId:string;centreId:string;roleCode:string;examDate:string;sessionCode:SessionCode}>;
  practical: Array<{schoolId:string;subjectId:string;examDate:string;sessionCode:SessionCode;batchKey:string;internalExaminerId:string;externalExaminerId:string}>;
}): { dutyIn: SchoolDutyRow[]; dutyOut: SchoolDutyRow[] } {
  const schools = new Map(input.schools.map(s=>[s.schoolId,s]));
  const centres = new Map(input.centres.map(c=>[c.centreId,c]));
  const teachers = new Map(input.teachers.map(t=>[t.teacherId,t]));
  const dutyIn:SchoolDutyRow[]=[];const dutyOut:SchoolDutyRow[]=[];
  const jobs = [
    ...input.assignments.map(a=>({...a, subject:"",batch:"",targetSchoolId:""})),
    ...input.practical.flatMap(p=>[
      {...p,teacherId:p.internalExaminerId,centreId:"",roleCode:"PRACTICAL_INTERNAL",subject:p.subjectId,batch:p.batchKey.split("|").at(-1)??"",targetSchoolId:p.schoolId},
      {...p,teacherId:p.externalExaminerId,centreId:"",roleCode:"PRACTICAL_EXTERNAL",subject:p.subjectId,batch:p.batchKey.split("|").at(-1)??"",targetSchoolId:p.schoolId},
    ]),
  ];
  for (const job of jobs) {
    const teacher = teachers.get(job.teacherId);
    if (!teacher) throw new Error("A teacher in this duty list is missing from saved data. Reload before exporting.");
    const home = schools.get(teacher.schoolId);
    if (!home) throw new Error(`School details are missing for ${teacher.name}.`);
    const centre = centres.get(job.centreId);
    const hostId = job.targetSchoolId || input.relationships.find(r=>r.centreId===job.centreId && r.relationshipType==="HOST" && r.effectiveFrom<=job.examDate && (!r.effectiveTo||r.effectiveTo>=job.examDate))?.schoolId;
    const host = hostId ? schools.get(hostId) : undefined;
    const targetName = host?.schoolName ?? centre?.centreName;
    if (!targetName) throw new Error(`Duty location is missing for ${teacher.name}.`);
    const ref = (s:typeof home) => s.sourceSchoolCode || (s.schoolCode.startsWith("__school_") ? "" : s.schoolCode);
    const base = {teacherName:teacher.name,designation:teacher.designation,subject:job.subject || teacher.subject || "",duty:formatDutyRole(job.roleCode),teacherSchool:home.schoolName,dutySchool:targetName,centreCode:centre?.centreCode ?? (host?.schoolCode.startsWith("__school_") ? "" : host?.schoolCode) ?? "",examDate:job.examDate,session:job.sessionCode==="MORNING"?"Morning":"Afternoon",batch:job.batch};
    dutyIn.push({...base,schoolId:hostId||job.centreId,schoolName:targetName,schoolReference:host?ref(host):centre?.centreCode??""});
    if (home.schoolId !== hostId) dutyOut.push({...base,schoolId:home.schoolId,schoolName:home.schoolName,schoolReference:ref(home)});
  }
  const sort = (a:SchoolDutyRow,b:SchoolDutyRow) => a.schoolName.localeCompare(b.schoolName)||a.schoolReference.localeCompare(b.schoolReference)||a.examDate.localeCompare(b.examDate)||Number(a.session==="Afternoon")-Number(b.session==="Afternoon")||a.duty.localeCompare(b.duty)||a.subject.localeCompare(b.subject)||a.teacherName.localeCompare(b.teacherName);
  return {dutyIn:dutyIn.sort(sort),dutyOut:dutyOut.sort(sort)};
}
