import type { TeacherImportRow } from "./validation.js";

/** Only spelling variants of established designations; acting posts stay unchanged. */
export function normalizeImportedDesignation(value: unknown): string {
  const text = String(value ?? "").trim();
  const key = text.toUpperCase().replace(/[\s._'’]+/g, "");
  return ({ HEADMASTER:"HM", HEADMISTRESS:"HM", HM:"HM", PRINCIPAL:"PRINCIPAL", PGASST:"PG", PGASSISTANT:"PG", PGTEACHER:"PG", PG:"PG", SENIORPG:"SENIOR_PG", SENIORPGTEACHER:"SENIOR_PG" } as Record<string,string>)[key] ?? text;
}

/** Codes are optional: ordinary uploads match by teacher name and school. */
export function prepareTeacherUpload(rawRows: unknown[], useEmployeeCodes = false) {
  const rows = rawRows.map((raw) => {
    const row = raw && typeof raw === "object" ? {...raw} as Record<string,unknown> : {};
    if (!useEmployeeCodes) delete row.employeeCode;
    else if (row.employeeCode != null) row.employeeCode = String(row.employeeCode).trim();
    row.designation = normalizeImportedDesignation(row.designation);
    return row;
  });
  const notes: string[] = [];
  const missing = (key: string) => rows.filter((r) => r[key] == null || String(r[key]).trim() === "").length;
  if (missing("subject")) notes.push(`${missing("subject")} teachers have no subject. Add it where required for their duty.`);
  if (missing("seniorityRank")) notes.push(`${missing("seniorityRank")} teachers have no seniority rank. Add ranks before seniority-based allotment.`);
  const locations = rows.filter((r) => r.homeLatitude == null || r.homeLongitude == null).length;
  if (locations) notes.push(`${locations} teachers have no complete home location. Add missing locations before distance checks.`);
  const unconfirmed = [...new Set(rows.map((r) => String(r.designation)).filter((d) => d && !["HM","PRINCIPAL","PG","SENIOR_PG","OTHER"].includes(d)))];
  if (unconfirmed.length) notes.push(`Confirm these designations in Schools & teachers: ${unconfirmed.join(", ")}. They are kept as written, not treated as regular headmasters or PG teachers.`);
  return { rows, notes };
}

/** Normalized column aliases for teacher Excel sheets (synthetic / provisional headers). */
const HEADER_MAP: Record<string, keyof TeacherImportRow | "ignore"> = {
  employeecode: "employeeCode",
  employee_code: "employeeCode",
  empcode: "employeeCode",
  "employee code": "employeeCode",
  name: "name",
  teachername: "name",
  teacher_name: "name",
  schoolcode: "schoolCode",
  school_code: "schoolCode",
  "school code": "schoolCode",
  centrecode: "schoolCode",
  "centre code": "schoolCode",
  schoolname: "schoolName",
  "school name": "schoolName",
  "teacher name": "name",
  "seniority rank": "seniorityRank",
  "joining date": "joiningDate",
  "home latitude": "homeLatitude",
  "home longitude": "homeLongitude",
  designation: "designation",
  subject: "subject",
  seniorityrank: "seniorityRank",
  seniority_rank: "seniorityRank",
  joiningdate: "joiningDate",
  joining_date: "joiningDate",
  homelatitude: "homeLatitude",
  home_latitude: "homeLatitude",
  home_lat: "homeLatitude",
  homelongitude: "homeLongitude",
  home_longitude: "homeLongitude",
  home_lon: "homeLongitude",
  isactive: "isActive",
  is_active: "isActive",
  active: "isActive",
};

function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function coerceCell(key: keyof TeacherImportRow, value: unknown): unknown {
  if (value == null || value === "") return key === "isActive" ? undefined : null;
  if (key === "seniorityRank") {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (key === "homeLatitude" || key === "homeLongitude") {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (key === "isActive") {
    if (typeof value === "boolean") return value;
    const s = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "y", "active"].includes(s)) return true;
    if (["0", "false", "no", "n", "inactive"].includes(s)) return false;
    return value;
  }
  if (key === "joiningDate" && value instanceof Date) return value.toISOString().slice(0, 10);
  if (key === "designation") return normalizeImportedDesignation(value);
  return String(value).trim();
}

/**
 * Convert a worksheet AOA (array-of-arrays) into teacher import row objects.
 * First non-empty row is treated as headers.
 */
export function parseTeacherRowsFromAoa(aoa: unknown[][]): {
  rows: Record<string, unknown>[];
  headerErrors: string[];
} {
  const headerErrors: string[] = [];
  if (!aoa.length) return { rows: [], headerErrors: ["Empty sheet"] };

  let headerIdx = aoa.findIndex((r) =>
    (r ?? []).some((c) => String(c ?? "").trim() !== ""),
  );
  if (headerIdx < 0) return { rows: [], headerErrors: ["No header row"] };

  const headerRow = aoa[headerIdx] ?? [];
  const mapping: Array<keyof TeacherImportRow | null> = headerRow.map((h) => {
    const key = HEADER_MAP[normalizeHeader(h)];
    if (!key || key === "ignore") return null;
    return key;
  });

  if (!mapping.includes("name")) headerErrors.push("Required column name not found");
  if (!mapping.includes("schoolCode") && !mapping.includes("schoolName")) {
    headerErrors.push("Add a School name column (or Centre code for an exam centre).");
  }
  if (!mapping.includes("designation")) {
    headerErrors.push("Required column designation not found");
  }

  const rows: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const line = aoa[i] ?? [];
    if (!line.some((c) => String(c ?? "").trim() !== "")) continue;
    const obj: Record<string, unknown> = {};
    mapping.forEach((field, col) => {
      if (!field) return;
      obj[field] = coerceCell(field, line[col]);
    });
    rows.push(obj);
  }
  return { rows, headerErrors };
}
