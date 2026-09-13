import { normalizeImportValue } from "./importValues.js";

export type TimetableUploadEntry = {
  examDate: string;
  sessionCode: "MORNING" | "AFTERNOON";
  schoolName: string;
  schoolId: string | null;
  subjectLabel: string;
  requiresChief: boolean;
  requiresHall: boolean;
  notes: string | null;
};

export type TimetableUploadResult = { entries: TimetableUploadEntry[]; errors: string[] };

const normal = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[\s_.\-()/]+/g, "");
const aliases: Record<string, keyof RawTimetable | "ignore"> = {
  date: "examDate", examdate: "examDate", "exam date": "examDate",
  session: "sessionCode", sessioncode: "sessionCode", "session code": "sessionCode",
  school: "schoolName", schoolname: "schoolName", "school name": "schoolName", centre: "schoolName", center: "schoolName",
  subject: "subjectLabel", paper: "subjectLabel", subjectpaper: "subjectLabel", "subject paper": "subjectLabel",
  chief: "requiresChief", chiefduty: "requiresChief", "chief duty": "requiresChief",
  hall: "requiresHall", hallduty: "requiresHall", "hall duty": "requiresHall",
  notes: "notes", note: "notes", remarks: "notes", "s no": "ignore", sno: "ignore",
};
type RawTimetable = { examDate?: unknown; sessionCode?: unknown; schoolName?: unknown; subjectLabel?: unknown; requiresChief?: unknown; requiresHall?: unknown; notes?: unknown };

function cellValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const cell = value as {result?: unknown; richText?: {text:string}[]; text?: string};
  if ("result" in cell) return cell.result;
  if (cell.richText) return cell.richText.map((v) => v.text).join("");
  if (cell.text != null) return cell.text;
  return value;
}

function yesNo(value: unknown, label: string): boolean {
  try { return Boolean(normalizeImportValue("isActive", value)); }
  catch { throw new Error(`${label}: enter Yes or No (1 or 0 also works).`); }
}

function session(value: unknown): "MORNING" | "AFTERNOON" {
  const text = normal(value);
  if (["morning","am","forenoon"].includes(text)) return "MORNING";
  if (["afternoon","pm","evening"].includes(text)) return "AFTERNOON";
  throw new Error("Session: choose Morning or Afternoon.");
}

/** Reads a timetable sheet. It does not save or replace the timetable. */
export function parseTimetableAoa(
  aoa: unknown[][],
  schools: Array<{schoolId:string; schoolName:string; schoolCode?:string}>,
): TimetableUploadResult {
  const errors: string[]=[]; const entries: TimetableUploadEntry[]=[];
  const headerIndex=aoa.findIndex((row) => row.some((v) => String(v ?? "").trim()));
  if (headerIndex<0) return {entries,errors:["This sheet is empty."]};
  const mapping=(aoa[headerIndex] ?? []).map((h) => aliases[normal(h)] ?? "");
  for (const required of ["examDate","sessionCode","subjectLabel"] as const) if (!mapping.includes(required)) errors.push(`Add a ${({examDate:"Date",sessionCode:"Session",subjectLabel:"Subject / paper"} as Record<string,string>)[required]} column.`);
  if (errors.length) return {entries,errors};
  const seen=new Set<string>();
  for(let i=headerIndex+1;i<aoa.length;i++) {
    const values=aoa[i] ?? [];
    if(!values.some((v) => String(v ?? "").trim())) continue;
    const raw:RawTimetable={};
    mapping.forEach((field,col) => {if(field && field!=="ignore") raw[field]=cellValue(values[col]);});
    try {
      let examDate: string;
      try { examDate=String(normalizeImportValue("joiningDate",raw.examDate)); }
      catch { throw new Error("Date: enter day/month/year, for example 15/03/2026, or choose an Excel date."); }
      const sessionCode=session(raw.sessionCode);
      const subjectLabel=String(raw.subjectLabel ?? "").trim(); if(!subjectLabel) throw new Error("Subject / paper: add the paper name.");
      const schoolName=String(raw.schoolName ?? "").trim();
      const allSchools=!schoolName || ["allschools","all","districtwide"].includes(normal(schoolName));
      const matches=allSchools?[]:schools.filter((s) => normal(s.schoolName)===normal(schoolName) || (s.schoolCode && normal(s.schoolCode)===normal(schoolName)));
      if(matches.length>1) throw new Error(`School "${schoolName}": more than one saved school matches.`);
      if(!allSchools && matches.length===0) throw new Error(`School "${schoolName}" is not in your saved school list.`);
      const key=`${examDate}|${sessionCode}`; if(seen.has(key)) throw new Error(`Duplicate session: ${examDate} ${sessionCode.toLowerCase()}.`); seen.add(key);
      entries.push({examDate,sessionCode,schoolName:allSchools?"All schools":matches[0]!.schoolName,schoolId:allSchools?null:matches[0]!.schoolId,subjectLabel,requiresChief:raw.requiresChief==null||String(raw.requiresChief).trim()===""?true:yesNo(raw.requiresChief,"Chief duty"),requiresHall:raw.requiresHall==null||String(raw.requiresHall).trim()===""?true:yesNo(raw.requiresHall,"Hall duty"),notes:String(raw.notes ?? "").trim() || null});
    } catch(e) {errors.push(`Row ${i+1}: ${e instanceof Error ? e.message : "Check this row."}`);}
  }
  if (entries.length > 500) return { entries: [], errors: ["This timetable has more than 500 sessions. Split it into smaller files."] };
  if(!entries.length && !errors.length) errors.push("There are no timetable rows below the headings.");
  return {entries,errors};
}
