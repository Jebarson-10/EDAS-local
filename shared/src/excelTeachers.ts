import type { TeacherImportRow } from "./validation.js";

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
