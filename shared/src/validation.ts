import { z } from "zod";

export const employeeCodeSchema = z.string().min(1).max(64);
export const designationSchema = z.string().min(1).max(64);

export const teacherImportRowSchema = z.object({
  employeeCode: employeeCodeSchema,
  name: z.string().min(1).max(200),
  schoolCode: z.string().min(1).max(64),
  designation: designationSchema,
  subject: z.string().max(64).optional().nullable(),
  seniorityRank: z.number().int().nonnegative().optional().nullable(),
  joiningDate: z.string().optional().nullable(),
  homeLatitude: z.number().min(-90).max(90).optional().nullable(),
  homeLongitude: z.number().min(-180).max(180).optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

export type TeacherImportRow = z.infer<typeof teacherImportRowSchema>;

export function validateCoordinates(
  lat: number | null | undefined,
  lon: number | null | undefined,
): string | null {
  if (lat == null && lon == null) return null;
  if (lat == null || lon == null)
    return "Latitude and longitude must both be provided";
  if (lat < -90 || lat > 90) return "Invalid latitude";
  if (lon < -180 || lon > 180) return "Invalid longitude";
  return null;
}

const decisionReasonBodySchema = z.object({
  ruleCode: z.string().min(1),
  severity: z.enum(["INFO", "WARNING", "ERROR"]),
  message: z.string().min(1),
  details: z.unknown().optional(),
  teacherId: z.string().min(1).optional(),
  centreId: z.string().min(1).optional(),
  examDate: z.string().min(1).optional(),
  sessionCode: z.string().min(1).optional(),
  /** Generate validator alias for examDate — Zod would otherwise strip it. */
  date: z.string().min(1).optional(),
  /** Conflict-engine / generate alias for sessionCode. */
  session: z.string().min(1).optional(),
  /**
   * Generate display slot (role, requirementKey, or joined duties).
   * Not a session — stored on details, never used as sessionCode.
   */
  duty: z.string().min(1).optional(),
});

export type AllocationIssueInput = z.infer<typeof decisionReasonBodySchema>;

export type PersistedValidationFinding = {
  ruleCode: string;
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
  details?: unknown;
  teacherId?: string;
  centreId?: string;
  examDate?: string;
  sessionCode?: string;
};

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function detailsRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

/**
 * Map generate-shaped issue fields onto persist slots.
 * `date` → examDate, `session` → sessionCode. `duty` is not a session.
 */
export function normalizeValidationFinding(
  raw: AllocationIssueInput,
): PersistedValidationFinding {
  const examDate = asNonEmptyString(raw.examDate) ?? asNonEmptyString(raw.date);
  const sessionCode =
    asNonEmptyString(raw.sessionCode) ?? asNonEmptyString(raw.session);
  const duty = asNonEmptyString(raw.duty);
  const details = detailsRecord(raw.details);
  if (duty && details.duty == null) details.duty = duty;
  if (examDate && details.examDate == null) details.examDate = examDate;
  if (sessionCode && details.sessionCode == null) {
    details.sessionCode = sessionCode;
  }
  return {
    ruleCode: raw.ruleCode,
    severity: raw.severity,
    message: raw.message,
    details: Object.keys(details).length > 0 ? details : raw.details,
    teacherId: raw.teacherId,
    centreId: raw.centreId,
    examDate,
    sessionCode,
  };
}

/**
 * Shortage rows share rule+message with an empty teacher/date. Distinguish
 * them by the centre / requirement already on the finding — do not use
 * `details.duty` (conflict issues store joined duty names there).
 */
function findingIdentitySlot(f: PersistedValidationFinding): string {
  const details = detailsRecord(f.details);
  const centre =
    asNonEmptyString(f.centreId) ?? asNonEmptyString(details.centreId) ?? "";
  const requirement = asNonEmptyString(details.requirementKey) ?? "";
  return `${centre}|${requirement}`;
}

function findingDedupeKey(f: PersistedValidationFinding): string {
  return [
    f.ruleCode,
    f.teacherId ?? "",
    f.examDate ?? "",
    f.message,
    findingIdentitySlot(f),
  ].join("|");
}

/**
 * Collapse the generate issue + conflict-engine pair (same rule/teacher/date
 * /message, one row lacks session). Keep distinct shortage centres and
 * same-day conflicts that already have different sessions.
 */
export function mergeValidationFindings(
  findings: PersistedValidationFinding[],
): PersistedValidationFinding[] {
  const groups = new Map<string, PersistedValidationFinding[]>();
  for (const finding of findings) {
    const key = findingDedupeKey(finding);
    const list = groups.get(key) ?? [];
    list.push(finding);
    groups.set(key, list);
  }
  const out: PersistedValidationFinding[] = [];
  for (const list of groups.values()) {
    const withSession: PersistedValidationFinding[] = [];
    const seenSession = new Set<string>();
    let withoutSession: PersistedValidationFinding | undefined;
    for (const finding of list) {
      const session = asNonEmptyString(finding.sessionCode);
      if (session) {
        if (seenSession.has(session)) continue;
        seenSession.add(session);
        withSession.push(finding);
        continue;
      }
      withoutSession = withoutSession
        ? { ...withoutSession, ...finding }
        : finding;
    }
    if (withSession.length > 0) {
      out.push(...withSession);
    } else if (withoutSession) {
      out.push(withoutSession);
    }
  }
  return out;
}

/**
 * Combine generate `validationIssues` + `conflicts` into persist findings.
 * Prefers the conflict-engine row (has session + duties) when both exist.
 */
export function validationFindingsFromRunBody(body: {
  validationIssues?: AllocationIssueInput[];
  conflicts?: Array<{
    ruleCode: string;
    severity: "ERROR" | "WARNING";
    message: string;
    teacherId: string;
    date: string;
    session: string;
    duties?: string[];
  }>;
}): PersistedValidationFinding[] {
  const fromIssues = (body.validationIssues ?? []).map(normalizeValidationFinding);
  const fromConflicts = (body.conflicts ?? []).map((c) =>
    normalizeValidationFinding({
      ruleCode: c.ruleCode,
      severity: c.severity,
      message: c.message,
      teacherId: c.teacherId,
      date: c.date,
      session: c.session,
      details: { duties: c.duties ?? [], source: "conflict-engine" },
    }),
  );
  return mergeValidationFindings([...fromIssues, ...fromConflicts]);
}

/**
 * Findings that persist cannot attach (empty results, NOT NULL result_id)
 * fold into summary.issues — same JSON blob as shortage objects. Does not
 * invent rows from an errors count, and does not overwrite a non-empty
 * generate-supplied issues array.
 */
export function foldUnstoredFindingsIntoSummaryJson(
  summaryJson: string,
  unstored: PersistedValidationFinding[],
): string {
  if (unstored.length === 0) return summaryJson;
  let summary: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(summaryJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      summary = { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    summary = {};
  }
  if (Array.isArray(summary.issues) && summary.issues.length > 0) {
    return summaryJson;
  }
  summary.issues = unstored.map((f) => {
    const rec: Record<string, unknown> = {
      ruleCode: f.ruleCode,
      severity: f.severity,
      message: f.message,
    };
    if (f.teacherId) rec.teacherId = f.teacherId;
    if (f.centreId) rec.centreId = f.centreId;
    if (f.examDate) rec.examDate = f.examDate;
    if (f.sessionCode) rec.sessionCode = f.sessionCode;
    if (f.details != null) rec.details = f.details;
    return rec;
  });
  return JSON.stringify(summary);
}

/** Worker / local API request bodies */
export const allocationRunBodySchema = z.object({
  runId: z.string().min(1),
  examCycleId: z.string().min(1),
  ruleVersionId: z.string().min(1).optional(),
  algorithmVersion: z.string().min(1).optional(),
  module: z.enum(["THEORY", "PRACTICAL", "HALL"]),
  validationStatus: z.string().optional(),
  summary: z.unknown().optional(),
  snapshot: z.unknown().optional(),
  /** Independent validator issues — persisted into allocation_decision_reasons */
  validationIssues: z.array(decisionReasonBodySchema).optional(),
  /** Cross-module session conflicts from the conflict engine */
  conflicts: z
    .array(
      z.object({
        ruleCode: z.string().min(1),
        severity: z.enum(["ERROR", "WARNING"]),
        message: z.string().min(1),
        teacherId: z.string().min(1),
        date: z.string().min(1),
        session: z.string().min(1),
        duties: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  results: z
    .array(
      z.object({
        teacherId: z.string().min(1),
        centreId: z.string().min(1),
        dutyTypeCode: z.string().min(1),
        roleCode: z.string().min(1),
        examDate: z.string().min(1),
        sessionCode: z.string().min(1),
        score: z.number(),
        decisionTrace: z.unknown().optional(),
        usedFallback: z.boolean().optional(),
      }),
    )
    .optional(),
});

export const publishRunBodySchema = z.object({
  examCycleId: z.string().min(1),
  academicYear: z.string().min(1),
});

export const restoreBodySchema = z.object({
  payload: z.record(z.unknown()),
  adminConfirmed: z.literal(true),
  includeHistory: z.boolean().optional(),
  /** When set, must match SHA-256 of JSON.stringify(payload) */
  expectedChecksum: z.string().min(16).optional(),
});

export const importApplyBodySchema = z.object({
  teachers: z
    .array(
      z.object({
        teacherId: z.string().min(1).optional(),
        teacher_id: z.string().min(1).optional(),
        employeeCode: z.string().min(1).optional(),
        employee_code: z.string().min(1).optional(),
        name: z.string().min(1),
        schoolId: z.string().min(1).optional(),
        school_id: z.string().min(1).optional(),
        designation: z.string().min(1),
        subject: z.string().nullable().optional(),
        seniorityRank: z.number().nullable().optional(),
        seniority_rank: z.number().nullable().optional(),
        homeLatitude: z.number().nullable().optional(),
        home_latitude: z.number().nullable().optional(),
        homeLongitude: z.number().nullable().optional(),
        home_longitude: z.number().nullable().optional(),
        isActive: z.boolean().optional(),
        is_active: z.union([z.boolean(), z.number()]).optional(),
        dataQuality: z.string().optional(),
        data_quality: z.string().optional(),
      }),
    )
    .min(1),
  schoolHistory: z
    .array(
      z.object({
        id: z.string().min(1),
        teacherId: z.string().min(1),
        schoolId: z.string().min(1),
        effectiveFrom: z.string().min(1),
        effectiveTo: z.string().nullable().optional(),
        sourceImportId: z.string().nullable().optional(),
        createdAt: z.string().optional(),
      }),
    )
    .optional(),
  designationHistory: z
    .array(
      z.object({
        id: z.string().min(1),
        teacherId: z.string().min(1),
        designation: z.string().min(1),
        effectiveFrom: z.string().min(1),
        effectiveTo: z.string().nullable().optional(),
        sourceImportId: z.string().nullable().optional(),
        createdAt: z.string().optional(),
      }),
    )
    .optional(),
  locationHistory: z
    .array(
      z.object({
        id: z.string().min(1),
        teacherId: z.string().min(1),
        locationType: z.enum(["HOME", "SCHOOL"]),
        latitude: z.number(),
        longitude: z.number(),
        effectiveFrom: z.string().min(1),
        effectiveTo: z.string().nullable().optional(),
        sourceImportId: z.string().nullable().optional(),
        createdAt: z.string().optional(),
      }),
    )
    .optional(),
  /** Per-row outcome of the preview that produced this apply (provenance). */
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int(),
        status: z.enum([
          "NEW",
          "UPDATED",
          "UNCHANGED",
          "INVALID",
          "DUPLICATE",
          "MISSING",
        ]),
        entityType: z.string().max(64).optional(),
        entityKey: z.string().max(128).optional(),
        message: z.string().max(2000).optional(),
        /** Optional raw row; callers may omit it to keep uploads small. */
        payload: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
  importId: z.string().optional(),
  note: z.string().optional(),
  /** When set, refuse apply against a published / locked / archived cycle. */
  examCycleId: z.string().min(1).optional(),
});

export const exportRecordBodySchema = z.object({
  exportType: z.string().min(1).max(64),
  examCycleId: z.string().optional(),
  runId: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const manualOverrideBodySchema = z.object({
  runId: z.string().min(1),
  requirementKey: z.string().min(1),
  centreId: z.string().min(1),
  oldTeacherId: z.string().min(1),
  newTeacherId: z.string().min(1),
  reason: z.string().min(1).max(2000),
});

export const createRuleVersionBodySchema = z.object({
  versionLabel: z.string().min(1).max(64),
  description: z.string().min(1).max(2000),
  cloneFromId: z.string().min(1),
  activate: z.boolean().optional(),
});

export const examCycleStatusBodySchema = z.object({
  status: z.enum([
    "DRAFT",
    "OPEN",
    "ALLOCATION_GENERATED",
    "UNDER_REVIEW",
    "APPROVED",
    "PUBLISHED",
    "LOCKED",
    "ARCHIVED",
  ]),
  reason: z.string().max(2000).optional(),
  /** ADMIN-only escape hatch for synthetic reset / disaster recovery — never invent business transitions. */
  force: z.boolean().optional(),
});

export const activateRuleVersionBodySchema = z.object({
  ruleVersionId: z.string().min(1),
});

/** ISO calendar date (YYYY-MM-DD) as stored in exam_cycles/exam_days. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const createExamCycleBodySchema = z.object({
  examCycleId: z.string().min(1),
  name: z.string().min(1).max(200),
  academicYear: z.string().min(1).max(32),
  ruleVersionId: z.string().min(1),
  status: z.enum(["DRAFT", "OPEN"]).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  amendedFromId: z.string().min(1).optional(),
  amendmentReason: z.string().min(1).max(2000).optional(),
});

/** Officer-configured examination window; null clears a previously set date. */
export const examCycleWindowBodySchema = z.object({
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
});

export const clubbingApplyBodySchema = z.object({
  asOfDate: z.string().min(1),
  importId: z.string().optional(),
  examCycleId: z.string().min(1).optional(),
  relationships: z
    .array(
      z.object({
        centreId: z.string().min(1),
        schoolId: z.string().min(1),
        relationshipType: z.enum(["HOST", "CLUBBED"]),
        effectiveFrom: z.string().min(1),
        effectiveTo: z.string().nullable().optional(),
        subjectScope: z.string().optional(),
      }),
    )
    .min(1),
});

export const centreCapacityBodySchema = z.object({
  examCycleId: z.string().min(1).optional(),
  centres: z
    .array(
      z.object({
        centreId: z.string().min(1),
        capacity: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

/**
 * Direct master-data maintenance. These rows are intentionally stricter than
 * old spreadsheet imports: required location and capacity fields prevent an
 * operator from saving data that the 10 km and student-strength rules cannot
 * use. Updates are upserts; no historical duty data is deleted.
 */
export const manualMasterRecordBodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("block"),
    blockId: z.string().min(1).optional(),
    blockCode: z.string().min(1).max(64),
    blockName: z.string().min(1).max(200),
    active: z.boolean().optional().default(true),
  }),
  z.object({
    kind: z.literal("school"),
    schoolId: z.string().min(1).optional(),
    schoolCode: z.string().min(1).max(64),
    schoolName: z.string().min(1).max(200),
    blockId: z.string().min(1),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    active: z.boolean().optional().default(true),
  }),
  z.object({
    kind: z.literal("centre"),
    centreId: z.string().min(1).optional(),
    centreCode: z.string().min(1).max(64),
    centreName: z.string().min(1).max(200),
    blockId: z.string().min(1),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    capacity: z.number().int().positive(),
    active: z.boolean().optional().default(true),
  }),
  z.object({
    kind: z.literal("teacher"),
    teacherId: z.string().min(1).optional(),
    employeeCode: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    schoolId: z.string().min(1),
    designation: designationSchema,
    subject: z.string().min(1).max(64),
    seniorityRank: z.number().int().nonnegative(),
    joiningDate: isoDate.optional().nullable(),
    homeLatitude: z.number().min(-90).max(90),
    homeLongitude: z.number().min(-180).max(180),
    isActive: z.boolean().optional().default(true),
  }),
]);

export const practicalBatchesBodySchema = z.object({
  examCycleId: z.string().min(1),
  runId: z.string().optional(),
  /** Stamped on examiner_pairs; falls back to the exam cycle's own year. */
  academicYear: z.string().min(1).max(16).optional(),
  batches: z
    .array(
      z.object({
        batchId: z.string().min(1),
        schoolId: z.string().min(1),
        subjectCode: z.string().min(1),
        studentCount: z.number().int().positive(),
        batchIndex: z.number().int().nonnegative(),
        examDate: z.string().optional(),
        sessionCode: z.enum(["MORNING", "AFTERNOON"]).optional(),
        internalExaminerId: z.string().optional(),
        externalExaminerId: z.string().optional(),
      }),
    )
    .min(1),
});

export const exemptionBodySchema = z.object({
  id: z.string().optional(),
  teacherId: z.string().min(1),
  reason: z.string().min(1).max(2000),
  effectiveFrom: z.string().min(1),
  effectiveTo: z.string().nullable().optional(),
  isExempted: z.boolean().optional(),
  source: z.string().max(64).optional(),
});

export const backupBodySchema = z.object({
  payload: z.record(z.unknown()).optional(),
  reason: z.string().max(2000).optional(),
  /** When true (default for archival), assemble payload from D1/SQLite */
  fromServer: z.boolean().optional(),
});

export function parseBody<T>(
  schema: z.ZodType<T>,
  raw: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const r = schema.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      error: r.error.issues.map((i) => i.message).join("; "),
    };
  }
  return { ok: true, data: r.data };
}
