import { normalizeImportValue } from "./importValues.js";
import { normalizeSubject } from "./subjects.js";
import {
  workspaceBaseSchema,
  type ExamWorkspace,
  type WorkspaceImportKind,
} from "./examWorkspace.js";

const key = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function importCell(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === "object") {
    const c = v as {
      result?: unknown;
      richText?: { text: string }[];
      text?: string;
    };
    if ("result" in c) return importCell(c.result);
    if (c.richText)
      return c.richText
        .map((t) => t.text)
        .join("")
        .trim();
    if (c.text) return c.text.trim();
    throw new Error("Excel cell has no readable saved value.");
  }
  const s = String(v ?? "").trim();
  return /^(null|n\/a|other)$/i.test(s) ? "" : s;
}
export function workspacePost(value: string): string {
  const k = key(value);
  const posts: Record<string, string> = {
    headteacherhss: "HM_HSS",
    headteacherhs: "HM_HS",
    headmasterhss: "HM_HSS",
    headmasterhs: "HM_HS",
    principal: "PRINCIPAL",
    headmaster: "HM",
    headmistress: "HM",
    hm: "HM",
    pgteacher: "PG",
    pgassistant: "PG",
    pgasst: "PG",
    pg: "PG",
    seniorpg: "PG",
    graduateteacherbtassistant: "BT",
    btassistant: "BT",
    btasst: "BT",
    bt: "BT",
    juniorassistant: "JA",
    ja: "JA",
    officeassistant: "OA",
    officeassistantss: "OA",
    oa: "OA",
    recordclerk: "RC",
    rc: "RC",
    physicaldirectorgrade1: "PD1",
    physicaldirectorgrade2: "PD2",
    pd1: "PD1",
    pd2: "PD2",
    deo: "DEO",
    districteducationalofficer: "DEO",
    computerinstructorgradei: "COMPUTER_INSTRUCTOR",
    computerinstructorgradeii: "COMPUTER_INSTRUCTOR",
    secondarygradeteacher: "SGT",
    sgt: "SGT",
  };
  if (posts[k]) return posts[k]!;
  if (/^vocational|^(fulltime|parttime)vocational/.test(k)) return "VOCATIONAL";
  return value.toUpperCase(); // Preserve unrecognised posts; never guess eligibility.
}
export function workspaceSubject(v: string): string {
  const k = key(v);
  if (k === "microbiology") return "MICROBIOLOGY";
  if (["generalnursing", "nursinggeneral"].includes(k)) return "GENERAL NURSING";
  if (["agriculturescience", "agriculturalscience"].includes(k)) return "AGRICULTURAL SCIENCE";
  if (["textileanddressdesigning", "textilesanddressdesigning", "textiledressdesigning", "textilesdressdesigning"].includes(k)) return "TEXTILES AND DRESS DESIGNING";
  if (["computerapplication", "computerapplications", "ca"].includes(k))
    return "CA";
  if (["botany", "bot"].includes(k)) return "BOT";
  if (["zoology", "zoo"].includes(k)) return "ZOO";
  if (k.includes("employability")) return "EMPLOYABILITY";
  const normalized = normalizeSubject(v);
  // Keep full vocational paper names: truncating two papers to the same 16
  // characters would incorrectly treat them as the same qualification.
  return normalized.code === normalized.name.slice(0, 16)
    ? normalized.name
    : normalized.code;
}
function date(v: string) {
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v))
    return new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000)
      .toISOString()
      .slice(0, 10);
  return normalizeImportValue("joiningDate", v.slice(0, 10)) as string;
}
const list = (v: string) =>
  v
    .split(/[;,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
const cleanNumber = (v: string) =>
  v.trim() === "" ? null : Number(v.replace(/,/g, ""));
export function inspectWorkspaceSheet(lines: unknown[][]) {
  const headerIndex = lines.findIndex(
    (row) =>
      row.filter((v) =>
        [
          "udisecode",
          "staffid",
          "standard",
          "dutydate",
          "schoolname",
          "examdate",
          "routeid",
        ].includes(key(v)),
      ).length >= 2,
  );
  if (headerIndex < 0)
    throw new Error(
      "Cannot find column headings. Use the School Master, Teacher Master or the downloadable input template.",
    );
  const headers = lines[headerIndex]!.map(importCell);
  const keys = headers.map(key);
  let kind: WorkspaceImportKind;
  if (keys.includes("staffname")) kind = "Staff";
  else if (keys.includes("schoolname")) kind = "Schools";
  else if (keys.includes("demandid")) kind = "Practical";
  else if (keys.includes("pointtype")) kind = "Points";
  else if (keys.includes("routeid")) kind = "Routes";
  else if (keys.includes("dutydate")) kind = "History";
  else if (keys.includes("examdate")) kind = "Timetable";
  else if (keys.includes("centrecode")) kind = "Centres";
  else throw new Error("These headings do not match a supported input sheet.");
  const rows = lines
    .slice(headerIndex + 1)
    .map((row, i) => ({
      rowNumber: headerIndex + i + 2,
      raw: Object.fromEntries(headers.map((h, j) => [h, importCell(row[j])])),
      values: Object.fromEntries(keys.map((h, j) => [h, importCell(row[j])])),
    }))
    .filter((row) => Object.values(row.values).some(Boolean));
  return { kind, rows };
}

/** Full-sheet preview is atomic: errors never save just part of a workbook. */
export function importWorkspaceSheet(
  workspace: ExamWorkspace,
  lines: unknown[][],
): {
  workspace: ExamWorkspace;
  kind: WorkspaceImportKind;
  count: number;
  errors: string[];
  warnings: string[];
} {
  const { kind, rows } = inspectWorkspaceSheet(lines);
  const next = structuredClone(workspace);
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    try {
      const v = row.values;
      const get = (...names: string[]) =>
        names.map((n) => v[key(n)] ?? "").find(Boolean) ?? "";
      const std = get("Standard");
      const udise = get("UDISE Code");
      const n = (name: string) => cleanNumber(get(name));
      const appointmentDate = (heading: string) => {
        const value = get(heading);
        try {
          const parsed = date(value);
          if (parsed && Number(parsed.slice(0, 4)) < 1900)
            throw new Error("Year is earlier than 1900.");
          return parsed;
        } catch {
          warnings.push(
            `Row ${row.rowNumber}: ${heading} is ${value}. Correct this date; the original value is preserved and the usable date is left blank.`,
          );
          return null;
        }
      };
      let collection: keyof ExamWorkspace;
      let entry: Record<string, unknown>;
      let identity: (r: Record<string, unknown>) => string;
      switch (kind) {
        case "Schools": {
          const cat = get("Category", "School level");
          const management = get("Management Type", "Management");
          entry = {
            udise,
            name: get("School Name"),
            block: get("Block"),
            educationalDistrict: get("Educational District"),
            level: /higher|h\.sec|hss|^12$|^3\s*-|^5\s*-|^10\s*-/i.test(cat)
              ? "HIGHER_SECONDARY"
              : /secondary|^high$|^10$|^6\s*-|^7\s*-/i.test(cat)
                ? "HIGH"
                : "OTHER",
            management: /un.?aided|private|self.?financ/i.test(management)
              ? "PRIVATE"
              : /aided/i.test(management)
                ? "AIDED"
                : /government|department of education/i.test(management)
                  ? "GOVERNMENT"
                  : "UNKNOWN",
            latitude: n("Latitude"),
            longitude: n("Longitude"),
            raw: row.raw,
          };
          collection = "schools";
          identity = (r) => String(r.udise);
          break;
        }
        case "Staff": {
          const taught = get("Class Taught").toLowerCase();
          const standards: string[] = [];
          if (/higher secondary|\b12\b/.test(taught)) standards.push("12");
          if (
            /\b10\b/.test(taught) ||
            /secondary/.test(taught.replace(/higher secondary/g, ""))
          )
            standards.push("10");
          const category = /non.?teaching/i.test(get("Type of Staff"))
            ? "NON_TEACHING"
            : "TEACHING";
          entry = {
            staffId: get("Staff ID"),
            udise,
            name: get("Staff NAME"),
            post: workspacePost(get("Duty Post", "Designation")),
            originalPost: get("Designation"),
            category,
            appointedSubject: workspaceSubject(get("Appointed Subject")),
            handlingSubjects: Array.from({ length: 6 }, (_, i) =>
              get(`Handling Subject${i + 1}`),
            )
              .filter(Boolean)
              .map(workspaceSubject),
            standards,
            serviceDate: appointmentDate("Date Of Join"),
            postDate: appointmentDate("Date of present post"),
            raw: row.raw,
          };
          if (!next.schools.some((s) => s.udise === udise))
            throw new Error(
              `School UDISE ${udise} is missing. Import School Master first.`,
            );
          collection = "staff";
          identity = (r) => String(r.staffId);
          break;
        }
        case "Centres":
          entry = {
            standard: std,
            code: get("Centre Code"),
            udise,
            students: n("Students"),
            clubbedUdise: list(get("Clubbed UDISE Codes")),
          };
          collection = "centres";
          identity = (r) => `${r.standard}|${r.code}`;
          break;
        case "Timetable":
          entry = {
            standard: std,
            date: date(get("Exam Date")),
            session: get("Session").toUpperCase(),
            subject: workspaceSubject(get("Subject")),
            centreCode: get("Centre Code"),
          };
          collection = "timetable";
          identity = (r) =>
            `${r.standard}|${r.date}|${r.session}|${r.subject}|${r.centreCode}`;
          break;
        case "Points":
          entry = {
            standard: std,
            id: get("Point ID"),
            kind: get("Point Type").toUpperCase(),
            name: get("Point Name"),
            udise,
            centreCodes: list(get("Centre Codes")),
          };
          collection = "points";
          identity = (r) => `${r.standard}|${r.id}`;
          break;
        case "Routes":
          entry = {
            standard: std,
            id: get("Route ID"),
            pointId: get("Custodian Point ID"),
            centreCodes: list(get("Centre Codes")),
          };
          collection = "routes";
          identity = (r) => `${r.standard}|${r.id}`;
          break;
        case "Practical":
          entry = {
            standard: std,
            id: get("Demand ID"),
            udise,
            subject: workspaceSubject(get("Subject")),
            students: n("Students"),
            cohort: get("Student Group"),
            centreUdise: get("Receiving UDISE Code") || udise,
            allowedCentreUdise: list(get("Allowed Clubbed UDISE Codes")),
            halls: n("Available Halls"),
            dates: list(get("Exam Dates")).map((d) => date(d)),
          };
          collection = "practical";
          identity = (r) => `${r.standard}|${r.id}`;
          break;
        case "History":
          entry = {
            staffId: get("Staff ID"),
            centreUdise: get("Duty School UDISE Code"),
            date: date(get("Duty Date")),
            role: get("Duty"),
          };
          collection = "history";
          identity = (r) => `${r.staffId}|${r.centreUdise}|${r.date}|${r.role}`;
          break;
      }
      const schema = workspaceBaseSchema.shape[collection] as zodArray;
      const checked = schema.element.safeParse(entry);
      if (!checked.success)
        throw new Error(
          checked.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        );
      const rowId = identity(entry);
      if (seen.has(rowId))
        throw new Error(
          `Repeated record ${rowId}. Keep one row for this record.`,
        );
      seen.add(rowId);
      const entries = next[collection] as Record<string, unknown>[];
      const ix = entries.findIndex((existing) => identity(existing) === rowId);
      if (ix < 0) entries.push(checked.data);
      else entries[ix] = checked.data;
    } catch (error) {
      errors.push(
        `Row ${row.rowNumber}: ${error instanceof Error ? error.message : "Check values"}`,
      );
    }
  }
  return {
    workspace: errors.length ? workspace : next,
    kind,
    count: rows.length,
    errors,
    warnings,
  };
}
type zodArray = {
  element: {
    safeParse: (v: unknown) =>
      | { success: true; data: Record<string, unknown> }
      | {
          success: false;
          error: { issues: { path: (string | number)[]; message: string }[] };
        };
  };
};
