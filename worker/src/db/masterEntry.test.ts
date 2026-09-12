import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import { createSqliteClient } from "./client.js";
import { applyMigrations } from "./migrate.js";
import { upsertMasterRecord, listSchools, listCentres, listRelationships, listTeachers, buildCanonicalBackup, transactionalRestore } from "./repos.js";

describe("school centre codes and code-free teachers", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof createSqliteClient>;
  let blockId: string;
  beforeEach(async () => {
    sqlite = new Database(":memory:"); db = createSqliteClient(sqlite);
    await applyMigrations(db, join(process.cwd(), ".."));
    blockId = (await upsertMasterRecord(db, { kind:"block", blockCode:"B", blockName:"Test block" })).id;
  });
  afterEach(() => sqlite.close());
  const school = (blockId: string, schoolCode = "") => ({ kind:"school" as const, schoolCode, schoolName:"Test school", blockId, latitude:11.3, longitude:77.7 });

  it("keeps multiple uncoded schools separate and does not create centres", async () => {
    const first = await upsertMasterRecord(db, school(blockId));
    const second = await upsertMasterRecord(db, school(blockId));
    expect(first.id).not.toBe(second.id);
    expect((await listSchools(db)).map((s) => s.school_code)).toEqual(["", ""]);
    expect(await listCentres(db)).toHaveLength(0);
    await upsertMasterRecord(db, { ...school(blockId), schoolId:first.id, schoolName:"Renamed" });
    expect(await listSchools(db)).toHaveLength(2);
  });

  it("creates the centre and host link, then retires it when code is cleared", async () => {
    const first = await upsertMasterRecord(db, school(blockId, "350"));
    const centre = (await listCentres(db))[0]!;
    expect(centre.centre_code).toBe("350");
    expect((await listRelationships(db))[0]).toMatchObject({school_id:first.id, centre_id:centre.centre_id, relationship_type:"HOST"});
    await upsertMasterRecord(db, { ...school(blockId, "350"), schoolId:first.id, schoolName:"Renamed", latitude:11.5 });
    expect((await listCentres(db))[0]).toMatchObject({centre_name:"Renamed",latitude:11.5});
    await upsertMasterRecord(db, { ...school(blockId), schoolId:first.id });
    expect((await listCentres(db))[0]).toMatchObject({centre_id:centre.centre_id,active:0});
    expect((await listRelationships(db))[0]!.effective_to).toBeTruthy();
    expect((await listSchools(db))[0]!.school_code).toBe("");
    await upsertMasterRecord(db, { ...school(blockId,"350"), schoolId:first.id });
    expect((await listCentres(db))[0]).toMatchObject({centre_id:centre.centre_id,active:1});
    expect(await listRelationships(db)).toHaveLength(2);
  });

  it("restores a backup containing several blank-code schools without merging them", async () => {
    await upsertMasterRecord(db, school(blockId));
    await upsertMasterRecord(db, school(blockId));
    const before = await listSchools(db);
    const backup = await buildCanonicalBackup(db);
    const result = await transactionalRestore(db, backup, {adminConfirmed:true,includeHistory:true});
    expect(result.ok).toBe(true);
    expect(await listSchools(db)).toEqual(before);
    expect(await listCentres(db)).toHaveLength(0);
  });

  it("generates private teacher identities and updates by selection even for identical names", async () => {
    const s = await upsertMasterRecord(db, school(blockId));
    const teacher = { kind:"teacher" as const, name:"Same name",schoolId:s.id,designation:"PG",subject:"PHY",seniorityRank:1,homeLatitude:11.3,homeLongitude:77.7 };
    const first = await upsertMasterRecord(db, teacher);
    const second = await upsertMasterRecord(db, teacher);
    expect(first.id).not.toBe(second.id);
    const original = (await listTeachers(db)).find((t) => t.teacher_id === first.id)!;
    await upsertMasterRecord(db,{ ...teacher,teacherId:first.id,name:"Edited teacher" });
    expect(await listTeachers(db)).toHaveLength(2);
    expect((await listTeachers(db)).find((t) => t.teacher_id === first.id)).toMatchObject({employee_code:original.employee_code,name:"Edited teacher"});
  });
});
