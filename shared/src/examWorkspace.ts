import { z } from "zod";

export const WORKSPACE_RULE_VERSION = "ERODE-2026-10-16";
const id = z.string().trim().min(1).max(200);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Enter a real calendar date.");
const standard = z.enum(["10", "12"]);
const session = z.enum(["MORNING", "AFTERNOON"]);
const raw = z.record(z.string()).default({});
export const workspaceSchoolSchema = z.object({
  udise: id,
  name: id,
  block: id,
  educationalDistrict: id,
  level: z.enum(["HIGH", "HIGHER_SECONDARY", "OTHER"]),
  management: z.enum(["GOVERNMENT", "AIDED", "PRIVATE", "UNKNOWN"]),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  raw,
});
export const workspaceStaffSchema = z.object({
  staffId: id,
  udise: id,
  name: id,
  post: id,
  originalPost: id,
  category: z.enum(["TEACHING", "NON_TEACHING"]),
  appointedSubject: z.string(),
  handlingSubjects: z.array(z.string()),
  standards: z.array(standard),
  serviceDate: date.nullable(),
  postDate: date.nullable(),
  raw,
});
export const workspaceCentreSchema = z.object({
  code: id,
  udise: id,
  standard,
  students: z.number().int().positive(),
  clubbedUdise: z.array(id).default([]),
});
export const workspaceTimetableSchema = z.object({
  standard,
  date,
  session,
  subject: id,
  centreCode: z.string().default(""),
});
export const workspacePointSchema = z.object({
  id,
  standard,
  kind: z.enum(["CUSTODIAN", "COLLECTION"]),
  name: id,
  udise: id,
  centreCodes: z.array(id).default([]),
});
export const workspaceRouteSchema = z.object({
  id,
  standard,
  pointId: id,
  centreCodes: z.array(id).min(1),
});
export const workspacePracticalSchema = z.object({
  id,
  standard,
  udise: id,
  subject: id,
  students: z.number().int().positive(),
  cohort: id,
  centreUdise: id,
  allowedCentreUdise: z.array(id).default([]),
  halls: z.number().int().positive(),
  dates: z.array(date).min(1),
});
export const workspaceHistorySchema = z.object({
  staffId: id,
  centreUdise: id,
  date,
  role: id,
});
export const workspaceSettingsSchema = z.object({
  radiusKm: z.literal(10).default(10),
  languageException: z.boolean().default(true),
  extraHalls: z.literal(2).default(2),
  backupStaff: z.literal(3).default(3),
  squadHalls: z.literal(8).default(8),
  seniority: z.literal("POST_DATE").default("POST_DATE"),
  custodianPost12: z.string().default("DEO"),
  practical10SameRules: z.boolean().nullable().default(true),
  retainHistory: z.boolean().nullable().default(false),
  // Officer-entered decisions are explicit in each run snapshot.
  confirmed: z.boolean().default(false),
});
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
export type WorkspaceSchool = z.infer<typeof workspaceSchoolSchema>;
export type WorkspaceStaff = z.infer<typeof workspaceStaffSchema>;
export type WorkspaceCentre = z.infer<typeof workspaceCentreSchema>;
export type WorkspacePoint = z.infer<typeof workspacePointSchema>;
export type WorkspaceRoute = z.infer<typeof workspaceRouteSchema>;
export type WorkspacePractical = z.infer<typeof workspacePracticalSchema>;
export type WorkspaceHistory = z.infer<typeof workspaceHistorySchema>;
export type WorkspaceStandard = "10" | "12";
export type WorkspaceSession = "MORNING" | "AFTERNOON";
export type WorkspaceRole =
  | "CUSTODIAN"
  | "SECONDARY_CUSTODIAN"
  | "LIAISON"
  | "SECONDARY_LIAISON"
  | "ROUTE"
  | "CHIEF"
  | "DEPARTMENT"
  | "SQUAD"
  | "INVIGILATOR"
  | "BACKUP"
  | "JUNIOR_ASSISTANT"
  | "OFFICE_ASSISTANT"
  | "INTERNAL"
  | "EXTERNAL";
export interface WorkspaceAssignment {
  key: string;
  standard: WorkspaceStandard;
  date: string;
  session: WorkspaceSession;
  targetId: string;
  centreCode: string;
  centreUdise: string;
  role: WorkspaceRole;
  staffId: string;
  subject: string;
  batch?: number;
  students?: number;
  cohort?: string;
  demandId?: string;
  fallback?: boolean;
  manual?: {
    parentRunId: string;
    reason: string;
    distanceException: boolean;
    approvedAt: string;
    policyVersion: "ERODE-MANUAL-2026-10-18";
  };
}
export interface WorkspaceShortage {
  key: string;
  role: string;
  target: string;
  date: string;
  missing: number;
  reasons: Record<string, number>;
  /** Exact empty theory post, including every date of a fixed-period duty. */
  vacancy?: Omit<WorkspaceAssignment, "staffId" | "manual">[];
}
export interface WorkspaceRun {
  id: string;
  standard: WorkspaceStandard;
  module: "THEORY" | "PRACTICAL";
  createdAt: string;
  ruleVersion: string;
  seed: string;
  inputRevision: number;
  assignments: WorkspaceAssignment[];
  shortages: WorkspaceShortage[];
  errors: string[];
  published: boolean;
  parentRunId?: string;
}
export const workspaceBaseSchema = z.object({
  id,
  name: id,
  revision: z.number().int().min(0),
  ruleVersion: z.literal(WORKSPACE_RULE_VERSION),
  settings: workspaceSettingsSchema,
  schools: z.array(workspaceSchoolSchema),
  staff: z.array(workspaceStaffSchema),
  centres: z.array(workspaceCentreSchema),
  timetable: z.array(workspaceTimetableSchema),
  points: z.array(workspacePointSchema),
  routes: z.array(workspaceRouteSchema),
  practical: z.array(workspacePracticalSchema),
  history: z.array(workspaceHistorySchema),
  imports: z.array(
    z.object({ name: id, at: z.string(), rows: z.number().int().min(0) }),
  ),
});
export const workspaceSchema = workspaceBaseSchema.superRefine((w, ctx) => {
  const unique = (
    collection: string,
    rows: unknown[],
    identity: (row: any) => string,
  ) => {
    const found = new Set<string>();
    rows.forEach((row, index) => {
      const key = identity(row);
      if (found.has(key))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [collection, index],
          message: `Repeated ${collection} record: ${key}`,
        });
      found.add(key);
    });
  };
  unique("schools", w.schools, (s) => s.udise);
  unique("staff", w.staff, (t) => t.staffId);
  unique("centres", w.centres, (c) => `${c.standard}|${c.code}`);
  unique("centres", w.centres, (c) => `${c.standard}|${c.udise}`);
  unique("points", w.points, (p) => `${p.standard}|${p.id}`);
  unique("routes", w.routes, (r) => `${r.standard}|${r.id}`);
  unique("practical", w.practical, (p) => `${p.standard}|${p.id}`);
  unique(
    "timetable",
    w.timetable,
    (t) => `${t.standard}|${t.date}|${t.session}|${t.subject}|${t.centreCode}`,
  );
});
export type ExamWorkspace = z.infer<typeof workspaceSchema>;
export function emptyExamWorkspace(id: string, name: string): ExamWorkspace {
  return {
    id,
    name,
    revision: 0,
    ruleVersion: WORKSPACE_RULE_VERSION,
    settings: workspaceSettingsSchema.parse({}),
    schools: [],
    staff: [],
    centres: [],
    timetable: [],
    points: [],
    routes: [],
    practical: [],
    history: [],
    imports: [],
  };
}

export const WORKSPACE_IMPORT_HEADERS = {
  Schools: [
    "UDISE Code",
    "School Name",
    "Block",
    "Educational District",
    "Category",
    "Management Type",
    "Latitude",
    "Longitude",
  ],
  Staff: [
    "UDISE Code",
    "Staff ID",
    "Staff NAME",
    "Type of Staff",
    "Designation",
    "Appointed Subject",
    "Handling Subject1",
    "Handling Subject2",
    "Handling Subject3",
    "Handling Subject4",
    "Handling Subject5",
    "Handling Subject6",
    "Class Taught",
    "Date Of Join",
    "Date of present post",
  ],
  Centres: [
    "Standard",
    "Centre Code",
    "UDISE Code",
    "Students",
    "Clubbed UDISE Codes",
  ],
  Timetable: ["Standard", "Exam Date", "Session", "Subject", "Centre Code"],
  Points: [
    "Standard",
    "Point ID",
    "Point Type",
    "Point Name",
    "UDISE Code",
    "Centre Codes",
  ],
  Routes: ["Standard", "Route ID", "Custodian Point ID", "Centre Codes"],
  Practical: [
    "Standard",
    "Demand ID",
    "UDISE Code",
    "Subject",
    "Students",
    "Student Group",
    "Receiving UDISE Code",
    "Allowed Clubbed UDISE Codes",
    "Available Halls",
    "Exam Dates",
  ],
  History: ["Staff ID", "Duty School UDISE Code", "Duty Date", "Duty"],
} as const;
export type WorkspaceImportKind = keyof typeof WORKSPACE_IMPORT_HEADERS;
