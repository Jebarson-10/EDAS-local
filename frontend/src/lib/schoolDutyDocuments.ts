import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } from "docx";
import type { DutyInLetter, DutyOutLetter, SchoolDutyRow } from "@exam-duty/shared";

const paragraph = (text:string,bold=false) => new Paragraph({spacing:{after:100},children:text.split("\n").map((line,index)=>new TextRun({text:line,break:index>0?1:undefined,bold,font:"Nirmala UI",size:20}))});
function table(headers:string[],rows:string[][],widths:number[]) {
  const border = {style:BorderStyle.SINGLE,size:4,color:"D9D9D9"};
  return new Table({width:{size:10506,type:WidthType.DXA},columnWidths:widths,layout:TableLayoutType.FIXED,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},rows:[headers,...rows].map((values,i)=>new TableRow({tableHeader:i===0,cantSplit:true,children:values.map((value,column)=>new TableCell({width:{size:widths[column]!,type:WidthType.DXA},verticalAlign:VerticalAlign.CENTER,shading:i===0?{fill:"E7EEF2"}:undefined,margins:{top:100,bottom:100,left:80,right:80},children:[paragraph(value,i===0)]}))}))});
}
function heading(title:string,school:string,reference:string,exam:string) {
  return [new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:exam,bold:true,size:24})]}),paragraph("ERODE DISTRICT",true),paragraph(title,true),paragraph(`School number: ${reference || "—"}`),paragraph(`School name: ${school}`)];
}
const page = {size:{width:11906,height:16838},margin:{top:850,bottom:850,left:700,right:700}};
const end = () => [paragraph(""),new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:"CHIEF EDUCATIONAL OFFICER, ERODE",bold:true})]})];

export async function practicalLettersDocx(direction:"in"|"out",letters:DutyInLetter[]|DutyOutLetter[]) {
  if (!letters.length) throw new Error("There are no practical duties to print yet.");
  const sections=letters.map(letter=>({properties:{page},children:[
    ...heading(direction==="in"?"APPOINTMENT OF EXTERNAL EXAMINER":"EXTERNAL EXAMINER DUTY FOR TEACHERS",letter.schoolName,letter.schoolNumber,letter.academicYearLabel),
    table(direction==="in"?["No","From date","To date","Subject","Batches","External examiner / school","Internal examiner"]:["Subject","Teacher name","External duty school","Batches","From date","To date"],
      "appointments" in letter ? letter.appointments.map((a,i)=>[String(i+1),a.fromDate,a.toDate,a.subject,String(a.batchCount),`${a.externalName}\n${a.externalSchoolName}${a.externalPlace?`\n${a.externalPlace}`:""}`,a.internalName]) : letter.assignments.map(a=>[a.subject,a.teacherName,`${a.dutySchoolName}${a.dutyPlace?`\n${a.dutyPlace}`:""}`,String(a.batchCount),a.fromDate,a.toDate]),
      direction==="in"?[450,1250,1250,1250,900,3306,2100]:[1400,2200,3506,900,1250,1250]),
    ...end(),
  ]}));
  return Packer.toBlob(new Document({sections}));
}

export async function schoolDutyDocx(direction:"in"|"out",rows:SchoolDutyRow[],exam:string) {
  if (!rows.length) throw new Error("There are no school duties to print yet.");
  const groups = new Map<string,SchoolDutyRow[]>();
  for(const row of rows){const group=groups.get(row.schoolId)??[];group.push(row);groups.set(row.schoolId,group);}
  return Packer.toBlob(new Document({sections:[...groups.values()].map(group=>({properties:{page},children:[
    ...heading(direction==="in"?"DUTY-IN: STAFF COMING TO THIS SCHOOL":"DUTY-OUT: STAFF GOING FROM THIS SCHOOL",group[0]!.schoolName,group[0]!.schoolReference,exam),
    table(["Teacher / post","Duty / subject",direction==="in"?"From school":"Duty school / centre","Date","Session / batch"],group.map(r=>[`${r.teacherName}\n${r.designation}`,`${r.duty}\n${r.subject}`,direction==="in"?r.teacherSchool:`${r.dutySchool}\n${r.centreCode}`,r.examDate,`${r.session}${r.batch?` / ${r.batch}`:""}`]),[2400,2000,3356,1250,1500]),...end(),
  ]}))}));
}
