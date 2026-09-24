import {beforeEach,afterEach,describe,it,expect} from "vitest";
import Database from "better-sqlite3";
import {join} from "node:path";
import {createSqliteClient} from "./client";
import {applyMigrations} from "./migrate";
import {buildCanonicalBackup, listCentres, listSchools, transactionalRestore, upsertExamCycle, upsertMasterRecord, importOfficialSchoolMasterData} from "./repos";
import {saveCentreChecklist,getCentreChecklist,checklistCentres,checklistRelationships,savePracticalStudents,getPracticalStudents} from "./centreChecklist";
import {saveCustodianPlan, getCustodianPlan} from "./centreChecklist";

describe("official examination input persistence",()=>{
  let sqlite:Database.Database;let db:ReturnType<typeof createSqliteClient>;let block:string;
  beforeEach(async()=>{sqlite=new Database(":memory:");db=createSqliteClient(sqlite);await applyMigrations(db,join(process.cwd(),".."));block=(await upsertMasterRecord(db,{kind:"block",blockCode:"TEST",blockName:"Synthetic block"})).id;
    const version=(await db.prepare("SELECT rule_version_id FROM rule_versions LIMIT 1").first<{rule_version_id:string}>())!.rule_version_id;
    for(const [id,standard] of [["sslc","10"],["hsc","12"]])await upsertExamCycle(db,{examCycleId:id!,standard:standard!,name:"Synthetic examination",academicYear:"2027",ruleVersionId:version,status:"DRAFT",createdBy:"test"});
  });
  afterEach(()=>sqlite.close());
  const payload=()=>({examCycleId:"sslc",standard:"10" as const,academicYear:"2027",reviewed:true as const,rows:[
    {centreCode:"990001",centreName:"Synthetic Host",sourceSchoolCode:"990ABCD0001",schoolName:"Synthetic Host",studentCount:300,blockId:block,hostSchoolKey:"990ABCD0001"},
    {centreCode:"990001",centreName:"Synthetic Host",sourceSchoolCode:"990ABCD0002",schoolName:"Synthetic Feeder",studentCount:201,blockId:block,hostSchoolKey:"990ABCD0001"},
  ]});
  it("saves host/clubbed schools and derives the cycle strength without assigning invented coordinates",async()=>{
    expect(await saveCentreChecklist(db,payload(),"test")).toMatchObject({centres:1,schools:2,students:501});
    const centres=await listCentres(db);const selected=await checklistCentres(db,"sslc",centres);
    expect(selected[0]).toMatchObject({capacity:501,latitude:null,longitude:null});
    expect((await listSchools(db)).filter(s=>s.school_code==="990001")).toHaveLength(1);
    expect((await checklistRelationships(db,"sslc",[])).map(r=>r.relationship_type).sort()).toEqual(["CLUBBED","HOST"]);
    expect(await getCentreChecklist(db,"hsc")).toBeNull();
    expect(await checklistCentres(db,"hsc",centres)).toEqual([]);
  });
  it("rejects wrong standard, duplicate school and unknown blocks without partial writes",async()=>{
    await expect(saveCentreChecklist(db,{...payload(),examCycleId:"hsc"},"test")).rejects.toThrow("standard 10");
    const data=payload();data.rows.push(data.rows[0]!);
    await expect(saveCentreChecklist(db,data,"test")).rejects.toThrow("Repeated");
    const wrong=payload();wrong.rows[1]!.blockId="missing";
    await expect(saveCentreChecklist(db,wrong,"test")).rejects.toThrow("block");
    expect(await listSchools(db)).toHaveLength(0);
  });
  it("matches staff-return school references across district prefixes and saves repeat imports without duplicates",async()=>{
    await importOfficialSchoolMasterData(db,[{schoolName:"Synthetic Host",sourceSchoolCode:"ABCD0001",blockCode:"TEST"}]);
    await saveCentreChecklist(db,payload(),"test");await saveCentreChecklist(db,payload(),"test");
    expect(await listSchools(db)).toHaveLength(2);expect(await listCentres(db)).toHaveLength(1);
    await importOfficialSchoolMasterData(db,[{schoolName:"Host written differently",sourceSchoolCode:"ABCD0001",blockCode:""}]);
    expect(await listSchools(db)).toHaveLength(2);
  });
  it("round-trips school references, centre lists and exact practical student counts in backup",async()=>{
    await saveCentreChecklist(db,payload(),"test");const school=String((await listSchools(db))[0]!.school_id);
    await savePracticalStudents(db,{examCycleId:"sslc",rows:[{schoolId:school,subjectId:"PHYSICS",studentCount:73}]},"test");
    const centreId = String((await listCentres(db))[0]!.centre_id);
    await saveCustodianPlan(db, {examCycleId:"sslc", rows:[{centreId,schoolIds:[school],count:1}], reason:"Synthetic setup"}, "test");
    const backup=await buildCanonicalBackup(db);
    expect(backup.centre_checklists).toHaveLength(1);
    expect(backup.practical_student_returns).toHaveLength(1);
    expect(backup.custodian_plans).toHaveLength(1);
    await db.prepare("DELETE FROM custodian_plans").run();
    await db.prepare("DELETE FROM centre_checklists").run();await db.prepare("DELETE FROM practical_student_returns").run();
    expect((await transactionalRestore(db,backup,{adminConfirmed:true,includeHistory:true})).ok).toBe(true);
    expect((await getCentreChecklist(db,"sslc"))?.rows).toHaveLength(2);
    expect((await getPracticalStudents(db,"sslc"))[0]?.studentCount).toBe(73);
    expect(await getCustodianPlan(db,"sslc")).toEqual([{centreId,schoolIds:[school],count:1}]);
    expect((await listSchools(db))[0]!.source_school_code).toBeTruthy();
  });
  it("refuses changes to a published examination",async()=>{
    await db.prepare("UPDATE exam_cycles SET status='PUBLISHED' WHERE exam_cycle_id='sslc'").run();
    await expect(saveCentreChecklist(db,payload(),"test")).rejects.toThrow();
    await expect(saveCustodianPlan(db,{examCycleId:"sslc",rows:[],reason:"Attempt to edit published exam"},"test")).rejects.toThrow();
    expect(await listSchools(db)).toHaveLength(0);
  });
  it("rejects repeated custodian school coverage and leaves the saved plan unchanged", async () => {
    await saveCentreChecklist(db,payload(),"test");
    const centreId=String((await listCentres(db))[0]!.centre_id);
    const schoolId=String((await listSchools(db))[0]!.school_id);
    await expect(saveCustodianPlan(db,{examCycleId:"sslc",rows:[{centreId,schoolIds:[schoolId,schoolId],count:1}],reason:"Synthetic invalid plan"},"test")).rejects.toThrow("only one");
    expect(await getCustodianPlan(db,"sslc")).toEqual([]);
  });
});
