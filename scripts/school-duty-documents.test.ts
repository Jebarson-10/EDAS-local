import {describe,it,expect} from "vitest";
import JSZip from "jszip";
import {practicalLettersDocx,schoolDutyDocx} from "../frontend/src/lib/schoolDutyDocuments";
import type {SchoolDutyRow} from "@exam-duty/shared";

const row:SchoolDutyRow={schoolId:"a",schoolName:"Synthetic School",schoolReference:"TEST001",teacherName:"தமிழ் ஆசிரியர்",designation:"PG Assistant",subject:"PHYSICS",duty:"Custodian",teacherSchool:"Another Synthetic School",dutySchool:"Synthetic School",centreCode:"990001",examDate:"2027-03-01",session:"Morning",batch:"1"};
async function xml(blob:Blob){const zip=await JSZip.loadAsync(await blob.arrayBuffer());return zip.file("word/document.xml")!.async("string");}
describe("printable school duty exports",()=>{
  it.each(["in","out"] as const)("builds %s with explicit printable widths, line breaks and a section per school",async direction=>{
    const text=await xml(await schoolDutyDocx(direction,[row,{...row,schoolId:"b",schoolName:"Second Synthetic School"}],"HSC 2027"));
    expect(text.match(/<w:sectPr>/g)).toHaveLength(2);
    expect(text).toContain('w:type="fixed"');expect(text).toContain('w:w="10506"');
    expect(text).toContain("தமிழ் ஆசிரியர்");expect(text).toContain("2027-03-01");
    expect(text).toContain("<w:br/>");expect(text).toContain("w:tblHeader");
  });
  it("keeps practical batch counts, exact dates and both examiner names",async()=>{
    const text=await xml(await practicalLettersDocx("in",[{academicYearLabel:"HSC 2027",districtLabel:"ERODE",schoolNumber:"TEST001",schoolName:"Synthetic School",city:"",signatoryTitle:"CEO",signatoryPlace:"ERODE",appointments:[{fromDate:"2027-03-01",toDate:"2027-03-01",subject:"PHYSICS",batchCount:2,externalName:"Synthetic External",externalSchoolName:"Synthetic Other School",internalName:"Synthetic Internal"}]}]));
    for(const value of ["2027-03-01","PHYSICS","Synthetic External","Synthetic Internal"])expect(text).toContain(value);
  });
  it("explains empty reports rather than generating an invalid Word document",async()=>{
    await expect(schoolDutyDocx("in",[],"HSC")).rejects.toThrow("no school duties");
    await expect(practicalLettersDocx("out",[])).rejects.toThrow("no practical duties");
  });
});
