import { normalizeImportedDesignation } from "./excelTeachers.js";
import { manualMasterRecordBodySchema as manualMasterRecordSchema } from "./validation.js";
import type { z } from "zod";
import { normalizeImportValue, friendlyImportIssue } from "./importValues.js";

export const importFields = {
  name: "Teacher name", designation: "Teacher post", subject: "Subject",
  schoolName: "School name", schoolCode: "Centre code", centreName: "Centre name",
  blockName: "Block name", blockCode: "Block code",
  latitude: "School latitude", longitude: "School longitude", capacity: "Student count",
  homeLatitude: "Home latitude", homeLongitude: "Home longitude",
  seniorityRank: "Seniority rank", joiningDate: "Joining date", isActive: "Teacher active",
  teacherCode: "Teacher code", employeeCode: "Old employee code", ignore: "Do not import this column",
} as const;
export type ImportField = keyof typeof importFields;
const key = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[\s_.\-()]+/g, "");
const aliases: Record<string, ImportField> = {};
for (const [field, title] of Object.entries(importFields)) {
  aliases[key(field)] = field as ImportField;
  aliases[key(title)] = field as ImportField;
}
for (const [field, titles] of Object.entries({
  name: ["teacher", "staff name", "name of teacher", "ஆசிரியர் பெயர்"],
  designation: ["post", "teacher designation", "staff post", "பதவி"],
  schoolName: ["school", "name of school", "பள்ளி", "பள்ளி பெயர்"],
  schoolCode: ["school code", "center code", "centre no", "centre number", "centree code", "மைய எண்"],
  centreName: ["centre", "center", "centree", "center name", "மையம்"],
  blockName: ["block", "name of block", "ஒன்றியம்"],
  subject: ["teacher subject", "பாடம்"],
  capacity: ["students", "strength", "student strength", "total students"],
  homeLatitude: ["home lat"], homeLongitude: ["home lon", "home lng"],
  latitude: ["lat", "centre latitude"], longitude: ["lon", "lng", "centre longitude"],
  seniorityRank: ["seniority", "rank"], isActive: ["active"],
  teacherCode: ["teacher code", "ஆசிரியர் குறியீடு", "emis code", "tch code"],
  ignore: ["s no", "sl no", "serial number", "serial no"],
})) for (const title of titles) aliases[key(title)] = field as ImportField;

export function guessImportColumns(headers: unknown[], kind: "teacher" | "school" | "block" = "teacher") {
  return headers.map((h): ImportField | "" => key(h) === "name" && kind !== "teacher"
    ? kind === "school" ? "schoolName" : "blockName" : aliases[key(h)] ?? "");
}

function cellValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const cell = value as { result?: unknown; richText?: {text: string}[]; text?: string };
  if ("result" in cell) return cell.result;
  if (cell.richText) return cell.richText.map((r) => r.text).join("");
  if (cell.text != null) return cell.text;
  throw new Error("A cell cannot be read. Replace formulas without saved results or Excel errors with plain values.");
}

export function mapImportColumns(lines: unknown[][], mapping: (ImportField | "")[]) {
  const errors: string[] = [];
  const seen = new Set<string>();
  mapping.forEach((field, i) => {
    if (!field) errors.push(`Choose what column ${i + 1} contains, or choose Do not import.`);
    else if (field !== "ignore") {
      if (seen.has(field)) errors.push(`Two columns are set to ${importFields[field]}. Choose only one.`);
      seen.add(field);
    }
  });
  const rows: Record<string, unknown>[] = [];
  lines.forEach((line, i) => {
    if (!line.some((v) => v != null && String(v).trim() !== "")) return;
    const row: Record<string, unknown> = {};
    try {
      mapping.forEach((field, col) => {
        if (!field || field === "ignore") return;
        const value = cellValue(line[col]);
        if (value == null || String(value).trim() === "") return;
        if (["latitude", "longitude", "homeLatitude", "homeLongitude", "capacity", "seniorityRank"].includes(field)) {
          row[field] = normalizeImportValue(field,value);
        } else if (field === "isActive") {
          row[field] = normalizeImportValue(field,value);
        } else if (field === "joiningDate") row[field] = normalizeImportValue(field,value);
        else row[field] = field === "designation" ? normalizeImportedDesignation(value) : String(value).trim();
      });
      if (Object.keys(row).length) rows.push(row);
    } catch (e) { errors.push(`Row ${i + 2}: ${e instanceof Error ? e.message : "Cannot read values"}`); }
  });
  if (!rows.length) errors.push("No data rows to import.");
  return { rows, errors };
}

type MasterRecord = z.infer<typeof manualMasterRecordSchema>;
type SchoolRef = {schoolId: string; schoolCode: string; schoolName: string; blockId: string; latitude: number; longitude: number; active: boolean};
type BlockRef = {blockId: string; blockCode: string; blockName: string};
const matchName = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Plans current-data changes only. New blocks use temporary references resolved after saving. */
export function planColumnImport(rows: Record<string, unknown>[], data: {blocks: BlockRef[]; schools: SchoolRef[]}) {
  const blocks = [...data.blocks];
  const schools = [...data.schools];
  const records: MasterRecord[] = [];
  const teachers: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const planned = new Map<string, string>();
  function add(id: string, record: unknown) {
    const parsed = manualMasterRecordSchema.safeParse(record);
    if (!parsed.success) throw new Error(parsed.error.issues.map(friendlyImportIssue).join("; "));
    const signature = JSON.stringify(parsed.data);
    if (planned.has(id) && planned.get(id) !== signature) throw new Error("Repeated school or block has different details. Make the repeated details agree.");
    if (!planned.has(id)) { records.push(parsed.data); planned.set(id, signature); }
  }
  rows.forEach((row, i) => {
    try {
      const str = (f: string) => String(row[f] ?? "").trim();
      if (["designation","subject","seniorityRank","joiningDate","homeLatitude","homeLongitude","isActive","teacherCode","employeeCode"].some((f) => row[f] !== undefined) && !str("name")) throw new Error("Add Teacher name for this row, or leave out the teacher-only columns.");
      let block: BlockRef | undefined;
      if (str("blockCode") || str("blockName")) {
        const hits = blocks.filter((b) => str("blockCode") ? b.blockCode === str("blockCode") : matchName(b.blockName) === matchName(row.blockName));
        if (hits.length > 1) throw new Error("More than one block has this name. Add Block code.");
        block = hits[0];
        if (block && str("blockName") && matchName(block.blockName) !== matchName(row.blockName)) throw new Error("Block name and code do not match.");
        if (!block) {
          if (!str("blockCode") || !str("blockName")) throw new Error("For a new block, add both Block name and Block code.");
          block = {blockId:`import-block:${str("blockCode")}`, blockCode:str("blockCode"), blockName:str("blockName")};
          add(block.blockId, {kind:"block", blockCode:block.blockCode, blockName:block.blockName});
          blocks.push(block);
        }
      }
      if (str("schoolName") && str("centreName") && matchName(row.schoolName) !== matchName(row.centreName)) throw new Error("School and Centre names differ. Use the combined-schools import to link different schools; do not merge them here.");
      const name = str("schoolName") || str("centreName");
      const code = str("schoolCode");
      if (!name && !code && !str("name")) return;
      let hits = code ? schools.filter((s) => s.schoolCode === code) : [];
      if (hits.length && block && hits.some((s) => s.blockId !== block!.blockId)) throw new Error("Centre code belongs to a school in another block. Check the code and block.");
      if (!hits.length) hits = schools.filter((s) => matchName(s.schoolName) === matchName(name || code));
      if (block) hits = hits.filter((s) => s.blockId === block!.blockId);
      if (hits.length > 1) throw new Error("More than one school matches. Add Block or Centre code.");
      let school = hits[0];
      if (school && name && matchName(school.schoolName) !== matchName(name)) throw new Error("School name and Centre code do not match.");
      const schoolDetails = ["latitude","longitude","capacity"].some((f) => row[f] !== undefined);
      const changesCode = school && code && code !== school.schoolCode && matchName(code) !== matchName(school.schoolName);
      if (!school || schoolDetails || changesCode || (!str("name") && name)) {
        if (!school && !name) throw new Error("Add School name.");
        const blockId = block?.blockId ?? school?.blockId;
        if (!blockId) throw new Error("Add the school's Block name or Block code.");
        const latitude = row.latitude ?? school?.latitude;
        const longitude = row.longitude ?? school?.longitude;
        if (latitude == null || longitude == null) throw new Error("Add School latitude and School longitude. Coordinates are required for new schools.");
        // In old teacher sheets schoolCode sometimes contains the school name, not a centre code.
        const schoolCode = school && code && matchName(code) === matchName(school.schoolName) ? school.schoolCode : code || school?.schoolCode || "";
        if (row.capacity != null && !schoolCode) throw new Error("Student count needs a Centre code. Leave it out for a school that is not a centre.");
        const id = school?.schoolId ?? `import-school:${blockId}:${matchName(name)}`;
        const record = {kind:"school", schoolId:school?.schoolId.startsWith("import-school:") ? undefined : school?.schoolId, schoolName:name || school!.schoolName, schoolCode, blockId, latitude, longitude, capacity:row.capacity, active:school?.active ?? true};
        add(id, record);
        if (!school) { school = {schoolId:id,schoolName:name,schoolCode,blockId,latitude:Number(latitude),longitude:Number(longitude),active:true}; schools.push(school); }
        else school = {...school,schoolCode};
      }
      if (str("name")) {
        if (!str("designation")) throw new Error("Add Teacher post for this teacher.");
        teachers.push({...row, schoolName:school!.schoolName, schoolCode:school!.schoolCode});
      }
    } catch (e) { errors.push(`Data row ${i + 1}: ${e instanceof Error ? e.message : "Check this row"}`); }
  });
  return {records, teachers, errors};
}
