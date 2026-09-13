import { describe, expect, it } from "vitest";
import { guessImportColumns, mapImportColumns, planColumnImport } from "./columnImport.js";

const data = {blocks:[{blockId:"b",blockName:"Test block",blockCode:"B1"}],schools:[{schoolId:"s",schoolName:"Test school",schoolCode:"",blockId:"b",latitude:11,longitude:77,active:true}]};
describe("heading-based imports", () => {
  it("keeps reordered columns together, accepts everyday headings and numeric codes", () => {
    const mapping=guessImportColumns(["Teacher Post","School","Teacher","Centre Code","S.No"]);
    const parsed=mapImportColumns([["PG ASST","Test school","Teacher A",123,1],["HEAD MASTER","Other school","Teacher B",456,2]],mapping);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([{designation:"PG",schoolName:"Test school",name:"Teacher A",schoolCode:"123"},{designation:"HM",schoolName:"Other school",name:"Teacher B",schoolCode:"456"}]);
  });
  it("asks about unknown, unheaded and duplicate columns", () => {
    expect(mapImportColumns([["a","b"]],guessImportColumns(["Teacher","mystery"])).errors.join()).toContain("Choose what column 2");
    expect(mapImportColumns([["a","b"]],["name","name"]).errors.join()).toContain("Two columns");
    expect(guessImportColumns([""])).toEqual([""]);
  });
  it("lets Name mean school or block when selected", () => {
    expect(guessImportColumns(["Name"],"school")).toEqual(["schoolName"]);
    expect(guessImportColumns(["Name"],"block")).toEqual(["blockName"]);
  });
  it("reads saved formula results and rich text, rejects missing results", () => {
    expect(mapImportColumns([[{richText:[{text:"Teacher A"}]},{formula:"1+1",result:2}]],["name","seniorityRank"]).rows[0]).toEqual({name:"Teacher A",seniorityRank:2});
    expect(mapImportColumns([[{formula:"1+1"}]],["name"]).errors.join()).toContain("cannot be read");
  });
  it("plans new blocks then schools, and links teachers from each row", () => {
    const result=planColumnImport([{name:"Teacher A",designation:"PG",schoolName:"New school",blockCode:"B2",blockName:"New block",latitude:11,longitude:77,schoolCode:"001"}],data);
    expect(result.errors).toEqual([]);
    expect(result.records.map((r) => r.kind)).toEqual(["block","school"]);
    expect(result.teachers[0]).toMatchObject({name:"Teacher A",schoolName:"New school",schoolCode:"001"});
  });
  it("reuses saved school details and does not invent coordinates or block codes", () => {
    const result=planColumnImport([{name:"A",designation:"PG",schoolName:"Test school"}],data);
    expect(result.errors).toEqual([]);expect(result.records).toEqual([]);
    expect(planColumnImport([{schoolName:"New school",blockCode:"B1"}],data).errors.join()).toContain("latitude");
    expect(planColumnImport([{blockName:"Unknown"}],data).errors.join()).toContain("Block code");
  });
  it("deduplicates shared schools but rejects conflicting details", () => {
    const row={schoolName:"New school",blockCode:"B1",latitude:11,longitude:77};
    expect(planColumnImport([row,row],data).records).toHaveLength(1);
    expect(planColumnImport([row,{...row,latitude:12}],data).errors.join()).toContain("different details");
  });
  it("does not merge a current school with a different duty centre", () => {
    expect(planColumnImport([{schoolName:"Test school",centreName:"Other school"}],data).errors.join()).toContain("differ");
  });
  it("preserves blank centre code for non-centres and existing code when omitted", () => {
    expect(planColumnImport([{schoolName:"Test school"}],data).records[0]).toMatchObject({schoolCode:""});
    const coded={...data,schools:[{...data.schools[0]!,schoolCode:"001"}]};
    expect(planColumnImport([{schoolName:"Test school"}],coded).records[0]).toMatchObject({schoolCode:"001"});
  });
  it("recognises Tamil headings and blocks invalid numeric/boolean values", () => {
    expect(guessImportColumns(["ஆசிரியர் பெயர்","பதவி","பள்ளி"])).toEqual(["name","designation","schoolName"]);
    expect(mapImportColumns([["not a number"]],["latitude"]).errors.join()).toContain("11.34");
    expect(mapImportColumns([["perhaps"]],["isActive"]).errors.join()).toContain("Yes or No");
  });
  it("uses a supplied centre code for the teacher's existing school", () => {
    const result=planColumnImport([{name:"Teacher A",designation:"PG",schoolName:"Test school",schoolCode:"001"}],data);
    expect(result.errors).toEqual([]);
    expect(result.records[0]).toMatchObject({schoolId:"s",schoolCode:"001"});
    expect(result.teachers[0]).toMatchObject({schoolCode:"001"});
  });
  it("rejects a centre code paired with the wrong block", () => {
    const coded={blocks:[...data.blocks,{blockId:"b2",blockCode:"B2",blockName:"Other block"}],schools:[{...data.schools[0]!,schoolCode:"001"}]};
    expect(planColumnImport([{schoolName:"New school",schoolCode:"001",blockCode:"B2",latitude:11,longitude:77}],coded).errors.join()).toContain("another block");
  });
  it("recognises Teacher Code and EMIS code headings in English and Tamil", () => {
    expect(guessImportColumns(["Teacher Code", "EMIS Code", "ஆசிரியர் குறியீடு"])).toEqual([
      "teacherCode",
      "teacherCode",
      "teacherCode",
    ]);
    const parsed = mapImportColumns([["TC-101", "PG", "Teacher A", "Test school"]], [
      "teacherCode",
      "designation",
      "name",
      "schoolName",
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      teacherCode: "TC-101",
      name: "Teacher A",
      designation: "PG",
      schoolName: "Test school",
    });
  });
});
