import { centreChecklistBodySchema, practicalStudentsBodySchema, custodianPlanBodySchema, schoolNameKey, schoolReferenceKey, normalizeSubject } from "@exam-duty/shared";
import type { z } from "zod";
import { runAtomic, type DbClient, type DbStatement } from "./client";
import { assertExamCycleMutable } from "./repos";

export type SavedChecklistRow = z.infer<typeof centreChecklistBodySchema>["rows"][number] & {
  schoolId: string; centreId: string; relationshipType: "HOST" | "CLUBBED";
};

export async function getCentreChecklist(db: DbClient, cycleId: string) {
  const saved = await db.prepare("SELECT * FROM centre_checklists WHERE exam_cycle_id=?").bind(cycleId)
    .first<{ standard: string; academic_year: string; rows_json: string; updated_at: string }>();
  return saved ? { standard: saved.standard, academicYear: saved.academic_year, updatedAt: saved.updated_at, rows: JSON.parse(saved.rows_json) as SavedChecklistRow[] } : null;
}

export async function saveCentreChecklist(db: DbClient, input: z.infer<typeof centreChecklistBodySchema>, userId: string) {
  const gate = await assertExamCycleMutable(db, input.examCycleId, "save the centre list");
  if (!gate.ok) throw new Error(gate.error);
  const cycle = await db.prepare("SELECT standard, academic_year FROM exam_cycles WHERE exam_cycle_id=?").bind(input.examCycleId).first<{standard: string; academic_year: string}>();
  if (cycle?.standard !== input.standard || cycle?.academic_year !== input.academicYear) {
    throw new Error(`This file is for standard ${input.standard}, ${input.academicYear}. Select the matching examination before saving.`);
  }
  const schools = (await db.prepare("SELECT school_id, school_name, school_code, source_school_code, block_id, latitude, longitude FROM schools").all<{
    school_id: string; school_name: string; school_code: string; source_school_code: string | null; block_id: string; latitude: number | null; longitude: number | null;
  }>()).results;
  const blocks = new Set((await db.prepare("SELECT block_id FROM blocks").all<{block_id:string}>()).results.map(b => b.block_id));
  const centres = (await db.prepare("SELECT centre_id, centre_code FROM centres").all<{centre_id:string;centre_code:string}>()).results;
  const statements: DbStatement[] = [];
  const now = new Date().toISOString();
  const resolved = new Map<string, typeof schools[number]>();
  const groups = new Map<string, typeof input.rows>();
  const unique = new Set<string>();
  for (const row of input.rows) {
    if (!blocks.has(row.blockId)) throw new Error(`Choose a saved block for ${row.schoolName}.`);
    const key = schoolReferenceKey(row.sourceSchoolCode);
    const pair = `${row.centreCode}|${key}`;
    if (unique.has(pair)) throw new Error(`Repeated school ${row.sourceSchoolCode} at centre ${row.centreCode}.`);
    unique.add(pair);
    if (resolved.has(key)) throw new Error(`School ${row.sourceSchoolCode} appears under more than one centre. Review its placement.`);
    const matches = row.schoolId ? schools.filter(s => s.school_id === row.schoolId) : schools.filter(s =>
      s.source_school_code && schoolReferenceKey(s.source_school_code) === key);
    if (matches.length > 1 || (row.schoolId && !matches.length)) throw new Error(`Choose the correct saved school for ${row.schoolName}.`);
    const sameName = matches.length ? [] : schools.filter(s => schoolNameKey(s.school_name) === schoolNameKey(row.schoolName));
    if (sameName.length > 1) throw new Error(`More than one saved school matches ${row.schoolName}. Choose one.`);
    let school = matches[0] ?? sameName[0];
    if (school && [...resolved.values()].some(s => s.school_id === school.school_id)) throw new Error(`The same saved school was selected more than once: ${row.schoolName}.`);
    if (!school) {
      const id = `sch_${crypto.randomUUID()}`;
      school = { school_id: id, school_code: `__school_${id}`, school_name: row.schoolName, source_school_code: row.sourceSchoolCode, block_id: row.blockId, latitude: null, longitude: null };
      statements.push(db.prepare(`INSERT INTO schools (school_id, school_code, source_school_code, school_name, block_id, active, data_quality, created_at, updated_at) VALUES (?,?,?,?,?,1,'Imported',?,?)`)
        .bind(id, school.school_code, row.sourceSchoolCode, row.schoolName, row.blockId, now, now));
    } else {
      statements.push(db.prepare("UPDATE schools SET source_school_code=?, updated_at=? WHERE school_id=?").bind(row.sourceSchoolCode, now, school.school_id));
    }
    resolved.set(key, school);
    const group = groups.get(row.centreCode) ?? [];
    group.push(row); groups.set(row.centreCode, group);
  }
  const saved: SavedChecklistRow[] = [];
  for (const [code, group] of groups) {
    if (new Set(group.map(r => r.hostSchoolKey)).size !== 1 || new Set(group.map(r => r.centreName)).size !== 1) throw new Error(`Check centre ${code}: its host school or name differs between rows.`);
    const hostKey = schoolReferenceKey(group[0]!.hostSchoolKey);
    const host = resolved.get(hostKey) ?? schools.find(s => s.school_id === group[0]!.hostSchoolKey);
    if (!host) throw new Error(`Choose the host school at centre ${code}. Add it in Schools & teachers if it is not listed.`);
    const hostRow = group.find(r => resolved.get(schoolReferenceKey(r.sourceSchoolCode))?.school_id === host.school_id);
    const centreId = centres.find(c => c.centre_code === code)?.centre_id ?? `ctr_${crypto.randomUUID()}`;
    const capacity = group.reduce((sum, r) => sum + r.studentCount, 0);
    if (capacity <= 0) throw new Error(`Centre ${code} has no students. Check the counts.`);
    statements.push(db.prepare(`INSERT INTO centres (centre_id,centre_code,centre_name,block_id,latitude,longitude,capacity,active,data_quality,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,1,'Imported',?,?) ON CONFLICT(centre_code) DO UPDATE SET centre_name=excluded.centre_name,block_id=excluded.block_id,latitude=excluded.latitude,longitude=excluded.longitude,active=1,updated_at=excluded.updated_at`)
      .bind(centreId, code, group[0]!.centreName, host.block_id, host.latitude, host.longitude, capacity, now, now));
    // The actual centre code belongs only to its host school. School references
    // of the other contributing schools stay separate.
    const conflicting = schools.find(s => s.school_code === code && s.school_id !== host.school_id);
    if (conflicting) throw new Error(`Centre code ${code} already belongs to ${conflicting.school_name}. Correct the host selection.`);
    statements.push(db.prepare("UPDATE schools SET school_code=?, updated_at=? WHERE school_id=?").bind(code, now, host.school_id));
    for (const row of group) saved.push({ ...row, schoolId: resolved.get(schoolReferenceKey(row.sourceSchoolCode))!.school_id, centreId, relationshipType: resolved.get(schoolReferenceKey(row.sourceSchoolCode))!.school_id === host.school_id ? "HOST" : "CLUBBED" });
    if (!hostRow) saved.push({ ...group[0]!, sourceSchoolCode: host.source_school_code ?? host.school_id, schoolName:host.school_name, studentCount:0, schoolId:host.school_id, centreId, relationshipType:"HOST" });
  }
  statements.push(db.prepare(`INSERT INTO centre_checklists (exam_cycle_id,standard,academic_year,rows_json,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(exam_cycle_id) DO UPDATE SET standard=excluded.standard,academic_year=excluded.academic_year,rows_json=excluded.rows_json,updated_at=excluded.updated_at`)
    .bind(input.examCycleId, input.standard, input.academicYear, JSON.stringify(saved), now));
  statements.push(db.prepare(`INSERT INTO audit_logs (audit_id,user_id,action,entity,entity_id,new_value,reason,timestamp) VALUES (?,?,'IMPORT','centre_checklist',?,?,?,?)`)
    .bind(crypto.randomUUID(), userId, input.examCycleId, JSON.stringify({centres:groups.size,schools:saved.length}), "Reviewed centre and school checklist", now));
  await runAtomic(db, statements);
  return { centres: groups.size, schools: saved.length, students: saved.reduce((n,r) => n+r.studentCount,0) };
}

export async function checklistCentres(db: DbClient, cycleId: string, masters: Array<Record<string, unknown>>) {
  const saved = await getCentreChecklist(db, cycleId);
  if (!saved) {
    // A list imported for SSLC (or another year) must not supply centres or
    // strengths to an examination with no reviewed list of its own.
    const others = await db.prepare("SELECT rows_json FROM centre_checklists WHERE exam_cycle_id<>?").bind(cycleId).all<{rows_json: string}>();
    const scopedIds = new Set(others.results.flatMap(row => (JSON.parse(row.rows_json) as SavedChecklistRow[]).map(r => r.centreId)));
    return masters.filter(c => !scopedIds.has(String(c.centre_id)));
  }
  return masters.filter(c => saved.rows.some(r => r.centreId === c.centre_id)).map(c => ({...c, capacity: saved.rows.filter(r => r.centreId === c.centre_id).reduce((n,r) => n+r.studentCount,0)}));
}

export async function checklistRelationships(db: DbClient, cycleId: string, masters: Array<Record<string, unknown>>) {
  const saved = await getCentreChecklist(db, cycleId);
  return saved ? saved.rows.map(r => ({ centre_id: r.centreId, school_id: r.schoolId, relationship_type: r.relationshipType, effective_from: "1900-01-01", effective_to: null })) : masters;
}

export async function getPracticalStudents(db:DbClient,cycleId:string) {
  const row=await db.prepare("SELECT rows_json FROM practical_student_returns WHERE exam_cycle_id=?").bind(cycleId).first<{rows_json:string}>();
  return row ? JSON.parse(row.rows_json) as z.infer<typeof practicalStudentsBodySchema>["rows"] : [];
}
export async function savePracticalStudents(db:DbClient,input:z.infer<typeof practicalStudentsBodySchema>,userId:string) {
  const gate=await assertExamCycleMutable(db,input.examCycleId,"save practical student numbers");
  if(!gate.ok) throw new Error(gate.error);
  const schools=new Set((await db.prepare("SELECT school_id FROM schools WHERE active=1").all<{school_id:string}>()).results.map(s=>s.school_id));
  const seen=new Set<string>();
  const rows=input.rows.map(r=>({...r,subjectId:normalizeSubject(r.subjectId).code}));
  for(const row of rows){
    if(!schools.has(row.schoolId)) throw new Error("Choose an active saved school for each practical subject.");
    const key=`${row.schoolId}|${row.subjectId}`;
    if(seen.has(key)) throw new Error("A school and subject appears twice. Combine its student numbers into one row.");
    seen.add(key);
  }
  const now=new Date().toISOString();
  await runAtomic(db,[db.prepare(`INSERT INTO practical_student_returns (exam_cycle_id,rows_json,updated_at) VALUES (?,?,?) ON CONFLICT(exam_cycle_id) DO UPDATE SET rows_json=excluded.rows_json,updated_at=excluded.updated_at`).bind(input.examCycleId,JSON.stringify(rows),now),db.prepare(`INSERT INTO audit_logs (audit_id,user_id,action,entity,entity_id,new_value,reason,timestamp) VALUES (?,?,'IMPORT','practical_students',?,?,?,?)`).bind(crypto.randomUUID(),userId,input.examCycleId,JSON.stringify({rows:rows.length}),"Practical student numbers",now)]);
  return {rows};
}

export async function getCustodianPlan(db:DbClient,cycleId:string){
  const row=await db.prepare("SELECT rows_json FROM custodian_plans WHERE exam_cycle_id=?").bind(cycleId).first<{rows_json:string}>();
  return row?JSON.parse(row.rows_json) as z.infer<typeof custodianPlanBodySchema>["rows"]:[];
}
export async function saveCustodianPlan(db:DbClient,input:z.infer<typeof custodianPlanBodySchema>,userId:string){
  const gate=await assertExamCycleMutable(db,input.examCycleId,"save custodian points");if(!gate.ok)throw new Error(gate.error);
  const schools=new Set((await db.prepare("SELECT school_id FROM schools WHERE active=1").all<{school_id:string}>()).results.map(s=>s.school_id));
  const centres=new Set((await db.prepare("SELECT centre_id FROM centres WHERE active=1").all<{centre_id:string}>()).results.map(c=>c.centre_id));
  const used=new Set<string>();const points=new Set<string>();
  for(const row of input.rows){
    if(!centres.has(row.centreId)||points.has(row.centreId))throw new Error("Choose a different saved centre for each custodian point.");points.add(row.centreId);
    for(const id of row.schoolIds){if(!schools.has(id)||used.has(id))throw new Error("Each school must appear at only one custodian point.");used.add(id);}
  }
  const now=new Date().toISOString();
  await runAtomic(db,[db.prepare(`INSERT INTO custodian_plans (exam_cycle_id,rows_json,updated_at) VALUES (?,?,?) ON CONFLICT(exam_cycle_id) DO UPDATE SET rows_json=excluded.rows_json,updated_at=excluded.updated_at`).bind(input.examCycleId,JSON.stringify(input.rows),now),db.prepare(`INSERT INTO audit_logs (audit_id,user_id,action,entity,entity_id,new_value,reason,timestamp) VALUES (?,?,'UPDATE','custodian_plan',?,?,?,?)`).bind(crypto.randomUUID(),userId,input.examCycleId,JSON.stringify(input.rows),input.reason,now)]);
  return {rows:input.rows};
}
