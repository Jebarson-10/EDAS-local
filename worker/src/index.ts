/**
 * Cloudflare Worker / Pages Function API.
 * Allocation optimization does NOT run here (Workers CPU limits).
 * Permissions are enforced on every route. SQL lives in ./db/repos.ts
 * (same code path as local better-sqlite3 API).
 */

import {
  countMaster,
  createExamCycle,
  createRuleVersion,
  activateRuleVersion,
  insertAudit,
  insertExportRecord,
  insertSourceImport,
  insertTeacherDesignationHistory,
  insertTeacherLocationHistory,
  insertTeacherSchoolHistory,
  assertExamCycleMutable,
  buildCanonicalBackup,
  listAllocationDecisionReasons,
  listAllocationRunResults,
  listAllocationRuns,
  listBackupRecords,
  getBackupRecord,
  listBlocks,
  listCentres,
  listDutyHistory,
  listExamCycles,
  listExamTimetable,
  listExemptions,
  listRelationships,
  listRuleVersions,
  listRuleParameters,
  getRuleVersion,
  listSchools,
  listSubjects,
  listSourceImports,
  listSourceImportRows,
  insertSourceImportRows,
  listManualOverrides,
  listExportRecords,
  listTeacherDesignationHistory,
  listTeacherLocationHistory,
  listTeacherSchoolHistory,
  listTeachers,
  persistAllocationRun,
  persistPracticalBatches,
  listPracticalBatches,
  listExaminerPairs,
  publishRunToHistory,
  recordManualOverride,
  replaceClubbingRelationships,
  transactionalRestore,
  updateCentreCapacities,
  updateExamCycleStatus,
  setExamCycleWindow,
  replaceExamTimetable,
  updateSourceImportStatus,
  upsertExemption,
  upsertTeachers,
  upsertMasterRecord,
  type BackupPayload,
} from "./db/repos";
import type { DbClient } from "./db/client";
import {
  allocationRunBodySchema,
  activateRuleVersionBodySchema,
  backupBodySchema,
  centreCapacityBodySchema,
  clubbingApplyBodySchema,
  createExamCycleBodySchema,
  examCycleWindowBodySchema,
  examTimetableBodySchema,
  createRuleVersionBodySchema,
  examCycleStatusBodySchema,
  exemptionBodySchema,
  exportRecordBodySchema,
  importApplyBodySchema,
  importFileRowCount,
  manualOverrideBodySchema,
  manualMasterRecordBodySchema,
  parseBody,
  parseImportRowCountHeader,
  practicalBatchesBodySchema,
  publishRunBodySchema,
  restoreBodySchema,
  mutationConflictStatus,
  sha256Hex,
  validationFindingsFromRunBody,
} from "@exam-duty/shared";
import {
  defaultAuthAdapter,
  parseEmailRoleMap,
  type AppRole,
} from "./auth/adapter";
import { checkRateLimit } from "./rateLimit";

export type { AppRole } from "./auth/adapter";

const ROLE_PERMISSIONS: Record<AppRole, string[]> = {
  VIEWER: ["master.read", "audit.read"],
  DATA_OPERATOR: ["master.read", "master.write", "import.apply", "audit.read"],
  OFFICER: [
    "master.read",
    "master.write",
    "import.apply",
    "allocation.generate",
    "allocation.override",
    "allocation.approve",
    "backup.manage",
    "audit.read",
  ],
  ADMIN: [
    "master.read",
    "master.write",
    "import.apply",
    "allocation.generate",
    "allocation.override",
    "allocation.approve",
    "backup.manage",
    "audit.read",
    "users.manage",
    "rules.manage",
  ],
};

export function hasPermission(role: AppRole, permission: string): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export interface Env {
  DB: D1Database;
  FILES?: R2Bucket;
  ENVIRONMENT: string;
  /** Comma-separated allowed browser origins for CORS (staging/production). */
  ALLOWED_ORIGINS?: string;
  /**
   * JSON map of Access email → role (OQ-010). Empty / unset → Access users are VIEWER
   * unless X-Access-Role claim header is present. Never invent mapping in code.
   */
  ACCESS_EMAIL_ROLE_MAP?: string;
  /** Optional override for role claim header name (default X-Access-Role). */
  ACCESS_ROLE_HEADER?: string;
}

export interface AuthContext {
  userId: string;
  email: string;
  role: AppRole;
}

/**
 * Production: Cloudflare Access sets Cf-Access-Authenticated-User-Email.
 * Role: ACCESS_EMAIL_ROLE_MAP (OQ-010) or X-Access-Role claim — never invented.
 * Dev: X-Dev-Role / X-Dev-Email headers. Staging/production refuse spoof headers.
 */
export function resolveAuth(
  request: Request,
  env?: {
    ENVIRONMENT?: string;
    ACCESS_EMAIL_ROLE_MAP?: string;
    ACCESS_ROLE_HEADER?: string;
  },
): AuthContext | null {
  const id = defaultAuthAdapter.resolve(
    request,
    env?.ENVIRONMENT ?? "development",
    {
      emailRoleMap: parseEmailRoleMap(env?.ACCESS_EMAIL_ROLE_MAP),
      accessRoleHeader: env?.ACCESS_ROLE_HEADER,
    },
  );
  if (!id) return null;
  return { userId: id.userId, email: id.email, role: id.role };
}

const SECURITY_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

/** Resolve Access-Control-Allow-Origin; never reflect arbitrary origins in staging/prod. */
export function resolveCorsOrigin(
  request: Request,
  env: { ENVIRONMENT?: string; ALLOWED_ORIGINS?: string },
): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const environment = (env.ENVIRONMENT ?? "development").toLowerCase();
  if (
    environment === "development" ||
    environment === "local" ||
    environment === "local-sqlite"
  ) {
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
      return origin;
    }
  }
  const allow = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.includes(origin)) return origin;
  // Same-origin Pages deploy often needs the pages.dev host listed explicitly.
  return null;
}

function attachCors(request: Request, env: Env, response: Response): Response {
  const allowed = resolveCorsOrigin(request, env);
  if (!allowed) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowed);
  headers.set("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: SECURITY_HEADERS,
  });
}

export function requirePerm(
  auth: AuthContext | null,
  permission: string,
): Response | null {
  if (!auth) return json({ error: "Unauthorized" }, 401);
  if (!hasPermission(auth.role, permission)) {
    return json({ error: "Forbidden", permission }, 403);
  }
  return null;
}

function asDb(env: Env): DbClient {
  return env.DB as unknown as DbClient;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return attachCors(request, env, await handleApi(request, env));
  },
};

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    const allowed = resolveCorsOrigin(request, env);
    if (!allowed && request.headers.get("origin")) {
      return json({ error: "Origin not allowed" }, 403);
    }
    return new Response(null, {
      status: 204,
      headers: {
        ...SECURITY_HEADERS,
        ...(allowed
          ? {
              "access-control-allow-origin": allowed,
              vary: "Origin",
            }
          : {}),
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers":
          "content-type, cf-access-authenticated-user-email, x-access-role, x-dev-role, x-dev-email, x-dev-user, x-filename",
        "access-control-max-age": "86400",
      },
    });
  }
  const auth = resolveAuth(request, env);
  const db = asDb(env);

  if (url.pathname === "/api/health") {
    const environment = env.ENVIRONMENT ?? "unknown";
    let dbOk = false;
    let counts: Record<string, number> | undefined;
    let dbError: string | undefined;
    try {
      counts = await countMaster(db);
      dbOk = true;
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
    let r2Ok = false;
    let r2Error: string | undefined;
    if (env.FILES) {
      try {
        await env.FILES.list({ limit: 1 });
        r2Ok = true;
      } catch (e) {
        r2Error = e instanceof Error ? e.message : String(e);
      }
    } else {
      r2Error = "R2 binding FILES unbound";
    }
    const emailRoleMap = parseEmailRoleMap(env.ACCESS_EMAIL_ROLE_MAP);
    const ok = dbOk;
    return json(
      {
        ok,
        dbOk,
        r2Ok,
        environment,
        counts,
        accessRoleMapConfigured: Object.keys(emailRoleMap).length > 0,
        accessRoleMapEntries: Object.keys(emailRoleMap).length,
        ...(dbError ? { dbError } : {}),
        ...(r2Error ? { r2Error } : {}),
        note: "Allocation engine runs client-side; this API persists and authorizes only",
      },
      ok ? 200 : 503,
    );
  }

  if (url.pathname === "/api/me") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    return json({ user: auth });
  }

  if (url.pathname === "/api/rule-versions" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ versions: await listRuleVersions(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/rule-versions" && request.method === "POST") {
    const denied = requirePerm(auth, "rules.manage");
    if (denied) return denied;
    const parsed = parseBody(createRuleVersionBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const ruleVersionId = `rv_${crypto.randomUUID().slice(0, 8)}`;
    const created = await createRuleVersion(db, {
      ruleVersionId,
      versionLabel: parsed.data.versionLabel,
      description: parsed.data.description,
      createdBy: auth!.userId,
      cloneFromId: parsed.data.cloneFromId,
      activate: parsed.data.activate,
    });
    if (!created.ok) return json(created, 400);
    await insertAudit(db, {
      auditId: crypto.randomUUID(),
      userId: auth!.userId,
      action: "CREATE",
      entity: "rule_version",
      entityId: ruleVersionId,
      newValue: JSON.stringify(parsed.data),
      reason: "New rule version (clone; never silent edit)",
    });
    return json({ ok: true, ruleVersionId, ...parsed.data });
  }

  if (
    url.pathname.match(/^\/api\/rule-versions\/[^/]+\/parameters$/) &&
    request.method === "GET"
  ) {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    const ruleVersionId = url.pathname.split("/")[3]!;
    try {
      const version = await getRuleVersion(db, ruleVersionId);
      if (!version) {
        return json({ error: `Rule version ${ruleVersionId} not found` }, 404);
      }
      return json({
        ruleVersionId,
        versionLabel: version.version_label,
        parameters: await listRuleParameters(db, ruleVersionId),
      });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/stats" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ counts: await countMaster(db) });
    } catch (e) {
      return json(
        {
          error: "stats unavailable",
          detail: e instanceof Error ? e.message : String(e),
        },
        503,
      );
    }
  }

  if (url.pathname === "/api/teachers" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ teachers: await listTeachers(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }
  if (url.pathname === "/api/schools" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ schools: await listSchools(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }
  if (url.pathname === "/api/centres" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ centres: await listCentres(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }
  if (url.pathname === "/api/blocks" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ blocks: await listBlocks(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }
  if (url.pathname === "/api/subjects" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ subjects: await listSubjects(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/master-records" && request.method === "POST") {
    const denied = requirePerm(auth, "master.write");
    if (denied) return denied;
    const parsed = parseBody(manualMasterRecordBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    try {
      const result = await upsertMasterRecord(db, parsed.data);
      await insertAudit(db, {
        auditId: crypto.randomUUID(),
        userId: auth!.userId,
        action: result.created ? "CREATE" : "UPDATE",
        entity: `master_${parsed.data.kind}`,
        entityId: result.id,
        newValue: JSON.stringify(parsed.data),
        reason: "Direct master-data maintenance",
      });
      return json({ ok: true, ...result });
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "Master data save failed" },
        400,
      );
    }
  }

  if (url.pathname === "/api/relationships" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ relationships: await listRelationships(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/history" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ history: await listDutyHistory(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (
    url.pathname === "/api/teacher-history/schools" &&
    request.method === "GET"
  ) {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    return json({ rows: await listTeacherSchoolHistory(db) });
  }
  if (
    url.pathname === "/api/teacher-history/designations" &&
    request.method === "GET"
  ) {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    return json({ rows: await listTeacherDesignationHistory(db) });
  }
  if (
    url.pathname === "/api/teacher-history/locations" &&
    request.method === "GET"
  ) {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    return json({ rows: await listTeacherLocationHistory(db) });
  }

  if (url.pathname === "/api/exemptions" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ exemptions: await listExemptions(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/exemptions" && request.method === "POST") {
    const denied = requirePerm(auth, "master.write");
    if (denied) return denied;
    if (auth!.role !== "ADMIN") {
      return json({ error: "Only ADMIN may record or end an exemption" }, 403);
    }
    const parsed = parseBody(exemptionBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const result = await upsertExemption(db, {
      ...parsed.data,
      createdBy: auth!.userId,
    });
    if (!result.ok) return json(result, 400);
    await insertAudit(db, {
      auditId: crypto.randomUUID(),
      userId: auth!.userId,
      action: "UPDATE",
      entity: "teacher_exemptions",
      entityId: result.id,
      newValue: JSON.stringify(parsed.data),
      reason: parsed.data.reason,
    });
    return json({ ok: true, id: result.id });
  }

  if (url.pathname === "/api/imports/apply" && request.method === "POST") {
    const denied = requirePerm(auth, "import.apply");
    if (denied) return denied;
    const limited = checkRateLimit(`import-apply:${auth!.userId}`, {
      limit: 30,
      windowMs: 60_000,
    });
    if (!limited.ok) {
      return json(
        { error: "Rate limit exceeded", retryAfterSec: limited.retryAfterSec },
        429,
      );
    }
    const parsed = parseBody(importApplyBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    if (parsed.data.examCycleId) {
      const gate = await assertExamCycleMutable(
        db,
        parsed.data.examCycleId,
        "apply import",
      );
      if (!gate.ok) return json(gate, mutationConflictStatus(gate));
    }
    try {
      const n = await upsertTeachers(
        db,
        parsed.data.teachers as Array<Record<string, unknown>>,
      );
      const schoolN = parsed.data.schoolHistory?.length
        ? await insertTeacherSchoolHistory(db, parsed.data.schoolHistory)
        : 0;
      const desigN = parsed.data.designationHistory?.length
        ? await insertTeacherDesignationHistory(
            db,
            parsed.data.designationHistory,
          )
        : 0;
      const locN = parsed.data.locationHistory?.length
        ? await insertTeacherLocationHistory(db, parsed.data.locationHistory)
        : 0;
      let rowsN = 0;
      if (parsed.data.importId) {
        if (parsed.data.rows?.length) {
          const stored = await insertSourceImportRows(
            db,
            parsed.data.importId,
            parsed.data.rows,
          );
          if (stored.ok) rowsN = stored.inserted;
        }
        try {
          await updateSourceImportStatus(db, parsed.data.importId, "APPLIED", {
            rowCount: importFileRowCount(parsed.data.rows),
            summaryJson: JSON.stringify({
              upserted: n,
              schoolHistory: schoolN,
              designationHistory: desigN,
              locationHistory: locN,
            }),
          });
        } catch {
          // import row may not exist for client-only apply paths
        }
      }
      await insertAudit(db, {
        auditId: crypto.randomUUID(),
        userId: auth!.userId,
        action: "IMPORT",
        entity: "teachers",
        entityId: parsed.data.importId ?? "apply",
        newValue: JSON.stringify({
          upserted: n,
          schoolHistory: schoolN,
          designationHistory: desigN,
          locationHistory: locN,
          importRows: rowsN,
          note: parsed.data.note,
        }),
      });
      return json({
        ok: true,
        upserted: n,
        schoolHistory: schoolN,
        designationHistory: desigN,
        locationHistory: locN,
        importRows: rowsN,
      });
    } catch (e) {
      return json(
        {
          error: "Import apply failed",
          detail: e instanceof Error ? e.message : String(e),
        },
        503,
      );
    }
  }

  if (url.pathname === "/api/manual-overrides" && request.method === "POST") {
    const denied = requirePerm(auth, "allocation.override");
    if (denied) return denied;
    const parsed = parseBody(manualOverrideBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const result = await recordManualOverride(db, {
      ...parsed.data,
      changedBy: auth!.userId,
    });
    if (!result.ok) return json(result, mutationConflictStatus(result));
    await insertAudit(db, {
      auditId: crypto.randomUUID(),
      userId: auth!.userId,
      action: "MANUAL_OVERRIDE",
      entity: "allocation_run",
      entityId: parsed.data.runId,
      newValue: JSON.stringify(parsed.data),
      reason: parsed.data.reason,
    });
    return json(result);
  }

  if (url.pathname === "/api/exam-cycles" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ cycles: await listExamCycles(db) });
    } catch (e) {
      // Same 503 as sibling list GETs — do not return 200 + cycles:[] or
      // boot hydrate classifies a D1 miss as an authoritative empty list.
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/exam-cycles" && request.method === "POST") {
    const denied = requirePerm(auth, "allocation.approve");
    if (denied) return denied;
    const parsed = parseBody(createExamCycleBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const created = await createExamCycle(db, {
      examCycleId: parsed.data.examCycleId,
      name: parsed.data.name,
      academicYear: parsed.data.academicYear,
      ruleVersionId: parsed.data.ruleVersionId,
      createdBy: auth!.userId,
      status: parsed.data.status,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      amendedFromId: parsed.data.amendedFromId,
      amendmentReason: parsed.data.amendmentReason,
    });
    if (!created.ok) return json(created, created.conflict ? 409 : 400);
    await insertAudit(db, {
      auditId: crypto.randomUUID(),
      userId: auth!.userId,
      action: "CREATE",
      entity: "exam_cycle",
      entityId: parsed.data.examCycleId,
      newValue: JSON.stringify(parsed.data),
      reason: parsed.data.amendmentReason ?? "Create exam cycle",
    });
    return json({ ok: true, examCycleId: parsed.data.examCycleId });
  }

  if (
    url.pathname.match(/^\/api\/exam-cycles\/[^/]+\/status$/) &&
    request.method === "POST"
  ) {
    const denied = requirePerm(auth, "allocation.approve");
    if (denied) return denied;
    const cycleId = url.pathname.split("/")[3]!;
    const parsed = parseBody(examCycleStatusBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    try {
      const updated = await updateExamCycleStatus(
        db,
        cycleId,
        parsed.data.status,
        parsed.data.force && auth!.role === "ADMIN"
          ? { force: true }
          : undefined,
      );
      if (!updated.ok) return json(updated, 400);
      await insertAudit(db, {
        auditId: crypto.randomUUID(),
        userId: auth!.userId,
        action: "UPDATE",
        entity: "exam_cycle",
        entityId: cycleId,
        newValue: parsed.data.status,
        reason:
          parsed.data.reason ??
          (parsed.data.force
            ? "ADMIN force status (synthetic/recovery)"
            : null),
      });
      return json({
        ok: true,
        examCycleId: cycleId,
        status: parsed.data.status,
      });
    } catch (e) {
      return json(
        {
          error: "D1 update failed",
          detail: e instanceof Error ? e.message : String(e),
        },
        503,
      );
    }
  }

  if (
    url.pathname.match(/^\/api\/exam-cycles\/[^/]+\/window$/) &&
    request.method === "POST"
  ) {
    const denied = requirePerm(auth, "allocation.approve");
    if (denied) return denied;
    const cycleId = url.pathname.split("/")[3]!;
    const parsed = parseBody(examCycleWindowBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    try {
      const updated = await setExamCycleWindow(db, cycleId, parsed.data);
      if (!updated.ok) return json(updated, mutationConflictStatus(updated));
      await insertAudit(db, {
        auditId: crypto.randomUUID(),
        userId: auth!.userId,
        action: "UPDATE",
        entity: "exam_cycle",
        entityId: cycleId,
        newValue: JSON.stringify(parsed.data),
        reason: "Set examination window",
      });
      return json({ ok: true, examCycleId: cycleId, ...parsed.data });
    } catch (e) {
      return json(
        {
          error: "D1 update failed",
          detail: e instanceof Error ? e.message : String(e),
        },
        503,
      );
    }
  }

  if (
    url.pathname.match(/^\/api\/exam-cycles\/[^/]+\/timetable$/) &&
    request.method === "GET"
  ) {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    const cycleId = url.pathname.split("/")[3]!;
    return json({ entries: await listExamTimetable(db, cycleId) });
  }

  if (
    url.pathname.match(/^\/api\/exam-cycles\/[^/]+\/timetable$/) &&
    request.method === "POST"
  ) {
    const denied = requirePerm(auth, "allocation.approve");
    if (denied) return denied;
    const cycleId = url.pathname.split("/")[3]!;
    const parsed = parseBody(examTimetableBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const entries = parsed.data.entries.map((entry) => ({
      ...entry,
      timetableEntryId: entry.timetableEntryId ?? crypto.randomUUID(),
    }));
    const updated = await replaceExamTimetable(db, cycleId, entries);
    if (!updated.ok) return json(updated, mutationConflictStatus(updated));
    await insertAudit(db, {
      auditId: crypto.randomUUID(), userId: auth!.userId, action: "UPDATE",
      entity: "exam_timetable", entityId: cycleId,
      newValue: JSON.stringify(entries), reason: "Set examination timetable",
    });
    return json({ ok: true, examCycleId: cycleId, entries: await listExamTimetable(db, cycleId) });
  }

  if (
    url.pathname === "/api/rule-versions/activate" &&
    request.method === "POST"
  ) {
    const denied = requirePerm(auth, "rules.manage");
    if (denied) return denied;
    const parsed = parseBody(
      activateRuleVersionBodySchema,
      await request.json(),
    );
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const activated = await activateRuleVersion(db, parsed.data.ruleVersionId);
    if (!activated.ok) return json(activated, 400);
    await insertAudit(db, {
      auditId: crypto.randomUUID(),
      userId: auth!.userId,
      action: "UPDATE",
      entity: "rule_version",
      entityId: parsed.data.ruleVersionId,
      newValue: JSON.stringify({ active: true, label: activated.versionLabel }),
      reason: "Activate existing rule version (parameters unchanged)",
    });
    return json({
      ok: true,
      ruleVersionId: parsed.data.ruleVersionId,
      versionLabel: activated.versionLabel,
    });
  }

  if (
    url.pathname === "/api/relationships/clubbing" &&
    request.method === "POST"
  ) {
    const denied = requirePerm(auth, "master.write");
    if (denied) return denied;
    const parsed = parseBody(clubbingApplyBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    if (parsed.data.examCycleId) {
      const gate = await assertExamCycleMutable(
        db,
        parsed.data.examCycleId,
        "apply clubbing",
      );
      if (!gate.ok) return json(gate, mutationConflictStatus(gate));
    }
    const result = await replaceClubbingRelationships(db, {
      asOfDate: parsed.data.asOfDate,
      importId: parsed.data.importId,
      relationships: parsed.data.relationships,
    });
    if (!result.ok) return json(result, 400);
    await insertAudit(db, {
      auditId: crypto.randomUUID(),
      userId: auth!.userId,
      action: "IMPORT",
      entity: "centre_school_relationships",
      entityId: parsed.data.importId ?? "clubbing",
      newValue: JSON.stringify(result),
      reason:
        "Apply practical clubbing (close prior CLUBBED; never delete HOST)",
    });
    return json({
      ok: true,
      inserted: result.inserted,
      closed: result.closed,
    });
  }

  if (url.pathname === "/api/centres/capacity" && request.method === "POST") {
    const denied = requirePerm(auth, "master.write");
    if (denied) return denied;
    const parsed = parseBody(centreCapacityBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    if (parsed.data.examCycleId) {
      const gate = await assertExamCycleMutable(
        db,
        parsed.data.examCycleId,
        "update centre capacity",
      );
      if (!gate.ok) return json(gate, mutationConflictStatus(gate));
    }
    const n = await updateCentreCapacities(db, parsed.data.centres);
    await insertAudit(db, {
      auditId: crypto.randomUUID(),
      userId: auth!.userId,
      action: "UPDATE",
      entity: "centres",
      entityId: "capacity",
      newValue: JSON.stringify({ updated: n }),
      reason: "Centre strength / capacity from booklet import",
    });
    return json({ ok: true, updated: n });
  }

  if (url.pathname === "/api/practical-batches" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    const examCycleId = url.searchParams.get("examCycleId") ?? undefined;
    try {
      return json(await listPracticalBatches(db, examCycleId ?? undefined));
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/practical-batches" && request.method === "POST") {
    const denied = requirePerm(auth, "allocation.generate");
    if (denied) return denied;
    const parsed = parseBody(practicalBatchesBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const gate = await assertExamCycleMutable(
      db,
      parsed.data.examCycleId,
      "persist practical batches",
    );
    if (!gate.ok) return json({ error: gate.error }, 409);
    const result = await persistPracticalBatches(db, parsed.data);
    if (!result.ok) return json(result, 400);
    await insertAudit(db, {
      auditId: crypto.randomUUID(),
      userId: auth!.userId,
      action: "GENERATE_ALLOCATION",
      entity: "practical_batches",
      entityId: parsed.data.examCycleId,
      newValue: JSON.stringify(result),
    });
    return json({
      ok: true,
      batches: result.batches,
      schedules: result.schedules,
      pairs: result.pairs,
    });
  }

  if (url.pathname === "/api/examiner-pairs" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    try {
      return json({ pairs: await listExaminerPairs(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/allocation-runs" && request.method === "GET") {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    const examCycleId = url.searchParams.get("examCycleId") ?? undefined;
    try {
      return json({
        runs: await listAllocationRuns(db, examCycleId ?? undefined),
      });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (
    url.pathname.match(/^\/api\/allocation-runs\/[^/]+\/results$/) &&
    request.method === "GET"
  ) {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    const runId = url.pathname.split("/")[3]!;
    try {
      return json({
        runId,
        results: await listAllocationRunResults(db, runId),
      });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (
    url.pathname.match(/^\/api\/allocation-runs\/[^/]+\/reasons$/) &&
    request.method === "GET"
  ) {
    const denied = requirePerm(auth, "master.read");
    if (denied) return denied;
    const runId = url.pathname.split("/")[3]!;
    try {
      return json({
        runId,
        reasons: await listAllocationDecisionReasons(db, runId),
      });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/allocation-runs" && request.method === "POST") {
    const denied = requirePerm(auth, "allocation.generate");
    if (denied) return denied;
    const parsed = parseBody(allocationRunBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const body = parsed.data;
    try {
      const gate = await assertExamCycleMutable(
        db,
        body.examCycleId,
        "generate allocation",
      );
      if (!gate.ok) return json({ accepted: false, error: gate.error }, 409);
      const validationFindings = validationFindingsFromRunBody(body);
      const persisted = await persistAllocationRun(db, {
        runId: body.runId,
        examCycleId: body.examCycleId,
        ruleVersionId: body.ruleVersionId ?? "rv-2027-1",
        algorithmVersion: body.algorithmVersion ?? "unknown",
        module: body.module,
        validationStatus: body.validationStatus ?? "PENDING",
        createdBy: auth!.userId,
        summaryJson: JSON.stringify(body.summary ?? {}),
        snapshotJson: body.snapshot ? JSON.stringify(body.snapshot) : undefined,
        results: (body.results ?? []).map((r) => ({
          resultId: crypto.randomUUID(),
          teacherId: r.teacherId,
          centreId: r.centreId,
          dutyTypeCode: r.dutyTypeCode,
          roleCode: r.roleCode,
          examDate: r.examDate,
          sessionCode: r.sessionCode,
          score: r.score,
          decisionTraceJson: JSON.stringify(r.decisionTrace ?? {}),
          usedFallback: Boolean(r.usedFallback),
        })),
        validationFindings,
      });
      await updateExamCycleStatus(
        db,
        body.examCycleId,
        "ALLOCATION_GENERATED",
        {
          force: true,
        },
      );
      await insertAudit(db, {
        auditId: crypto.randomUUID(),
        userId: auth!.userId,
        action: "GENERATE_ALLOCATION",
        entity: "allocation_run",
        entityId: body.runId,
        newValue: body.module,
      });
      return json({
        accepted: true,
        runId: body.runId,
        reasonCount: persisted.reasonCount,
      });
    } catch (e) {
      // Same 503 as sibling mutators — do not return 200 + warning-only
      // or clients that only check HTTP status treat a D1 miss as accepted.
      return json({
        accepted: false,
        error: e instanceof Error ? e.message : String(e),
      }, 503);
    }
  }

  if (
    url.pathname.match(/^\/api\/allocation-runs\/[^/]+\/publish$/) &&
    request.method === "POST"
  ) {
    const denied = requirePerm(auth, "allocation.approve");
    if (denied) return denied;
    const runId = url.pathname.split("/")[3]!;
    const parsed = parseBody(publishRunBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    try {
      const result = await publishRunToHistory(
        db,
        runId,
        parsed.data.examCycleId,
        parsed.data.academicYear,
      );
      if (!result.ok) {
        return json({ error: result.error }, 409);
      }
      if (!result.alreadyPublished) {
        await updateExamCycleStatus(db, parsed.data.examCycleId, "PUBLISHED", {
          force: true,
        });
      }
      await insertAudit(db, {
        auditId: crypto.randomUUID(),
        userId: auth!.userId,
        action: "PUBLISH",
        entity: "allocation_run",
        entityId: runId,
        newValue: JSON.stringify({
          published: result.published,
          alreadyPublished: Boolean(result.alreadyPublished),
        }),
      });
      return json({
        ok: true,
        published: result.published,
        alreadyPublished: Boolean(result.alreadyPublished),
      });
    } catch (e) {
      return json(
        {
          error: "Publish failed",
          detail: e instanceof Error ? e.message : String(e),
        },
        503,
      );
    }
  }

  if (url.pathname === "/api/imports" && request.method === "POST") {
    const denied = requirePerm(auth, "import.apply");
    if (denied) return denied;
    const limited = checkRateLimit(`import-upload:${auth!.userId}`, {
      limit: 20,
      windowMs: 60_000,
    });
    if (!limited.ok) {
      return json(
        { error: "Rate limit exceeded", retryAfterSec: limited.retryAfterSec },
        429,
      );
    }
    const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
    const contentType = request.headers.get("content-type") ?? "";
    try {
      let filename = request.headers.get("x-filename") ?? "upload.bin";
      let bytes: Uint8Array;
      if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File))
          return json({ error: "file required" }, 400);
        filename = file.name || filename;
        bytes = new Uint8Array(await file.arrayBuffer());
      } else {
        bytes = new Uint8Array(await request.arrayBuffer());
      }
      if (bytes.byteLength === 0) return json({ error: "empty file" }, 400);
      if (bytes.byteLength > MAX_IMPORT_BYTES) {
        return json({ error: "File exceeds 15 MB limit" }, 413);
      }
      const lowerName = filename.toLowerCase();
      const isXlsx =
        lowerName.endsWith(".xlsx") &&
        bytes.length >= 2 &&
        bytes[0] === 0x50 &&
        bytes[1] === 0x4b;
      const isJson =
        lowerName.endsWith(".json") &&
        (() => {
          const head = new TextDecoder().decode(bytes.slice(0, 8)).trimStart();
          return head.startsWith("[") || head.startsWith("{");
        })();
      if (!isXlsx && !isJson) {
        return json(
          {
            error:
              "Unsupported import type — upload .xlsx (OOXML) or .json array/object",
          },
          415,
        );
      }
      const importId = crypto.randomUUID();
      const fileHash = await sha256Hex(bytes);
      const rowCount = parseImportRowCountHeader(
        request.headers.get("x-row-count"),
      );
      const key = `imports/${importId}/${filename}`;
      let stored = false;
      if (env.FILES) {
        try {
          await env.FILES.put(key, bytes, {
            httpMetadata: {
              contentType: contentType.includes("multipart")
                ? "application/octet-stream"
                : contentType || "application/octet-stream",
            },
          });
          stored = true;
        } catch {
          // R2 put failed — still record provenance in D1
        }
      }
      await insertSourceImport(db, {
        importId,
        filename,
        fileHash,
        uploadedBy: auth!.userId,
        status: "UPLOADED",
        rowCount,
        r2Key: key,
        summaryJson: JSON.stringify({ bytes: bytes.byteLength, stored }),
      });
      await insertAudit(db, {
        auditId: crypto.randomUUID(),
        userId: auth!.userId,
        action: "IMPORT",
        entity: "source_import",
        entityId: importId,
        newValue: JSON.stringify({
          filename,
          size: bytes.byteLength,
          fileHash,
          r2Key: key,
          stored,
        }),
      });
      return json({
        importId,
        filename,
        bytes: bytes.byteLength,
        fileHash,
        rowCount,
        r2Key: key,
        stored,
        note: "Parse/preview/apply is client-assisted; Worker stores source provenance + optional R2 archive",
      });
    } catch (e) {
      return json(
        {
          error: "Import upload failed",
          detail: e instanceof Error ? e.message : String(e),
        },
        500,
      );
    }
  }

  if (url.pathname === "/api/imports" && request.method === "GET") {
    const denied = requirePerm(auth, "audit.read");
    if (denied) return denied;
    return json({ imports: await listSourceImports(db) });
  }

  if (
    url.pathname.match(/^\/api\/imports\/[^/]+\/rows$/) &&
    request.method === "GET"
  ) {
    const denied = requirePerm(auth, "audit.read");
    if (denied) return denied;
    const importId = url.pathname.split("/")[3]!;
    try {
      return json({
        importId,
        rows: await listSourceImportRows(db, importId),
      });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/backups" && request.method === "GET") {
    const denied = requirePerm(auth, "backup.manage");
    if (denied) return denied;
    try {
      return json({ backups: await listBackupRecords(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (
    url.pathname.match(/^\/api\/backups\/[^/]+$/) &&
    request.method === "GET"
  ) {
    const denied = requirePerm(auth, "backup.manage");
    if (denied) return denied;
    const backupId = url.pathname.split("/")[3]!;
    const meta = await getBackupRecord(db, backupId);
    if (!meta) return json({ error: "Backup not found" }, 404);
    const key = meta.r2_key;
    if (meta.status === "RECORDED_NO_R2" || !key) {
      return json(
        {
          error: "Backup payload was not stored",
          backupId,
          stored: false,
          status: meta.status,
          checksum: meta.checksum,
        },
        404,
      );
    }
    let body: ArrayBuffer | null = null;
    if (env.FILES) {
      try {
        const obj = await env.FILES.get(key);
        if (obj) body = await obj.arrayBuffer();
      } catch {
        // fall through
      }
    }
    if (!body) {
      return json(
        {
          error: "Backup payload unavailable (R2 unbound or object missing)",
          backupId,
          checksum: meta.checksum,
          r2Key: key,
          note: "Use local API file path or re-run fromServer backup while R2 is bound",
        },
        404,
      );
    }
    const bytes = new Uint8Array(body);
    const actual = await sha256Hex(bytes);
    if (meta.checksum && actual !== meta.checksum) {
      return json(
        {
          error: "Stored backup checksum mismatch",
          expected: meta.checksum,
          actual,
        },
        409,
      );
    }
    return new Response(body, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${backupId}.json"`,
        "x-backup-checksum": meta.checksum ?? actual,
      },
    });
  }

  if (url.pathname === "/api/backups" && request.method === "POST") {
    const denied = requirePerm(auth, "backup.manage");
    if (denied) return denied;
    const limited = checkRateLimit(`backup:${auth!.userId}`, {
      limit: 20,
      windowMs: 60_000,
    });
    if (!limited.ok) {
      return json(
        { error: "Rate limit exceeded", retryAfterSec: limited.retryAfterSec },
        429,
      );
    }
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    const MAX_BACKUP_BODY = 20 * 1024 * 1024;
    if (contentLength > MAX_BACKUP_BODY) {
      return json({ error: "Backup body exceeds 20 MB limit" }, 413);
    }
    const parsed = parseBody(backupBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const backupId = crypto.randomUUID();
    const key = `backups/${backupId}.json`;
    const useServer =
      parsed.data.fromServer === true ||
      !parsed.data.payload ||
      Object.keys(parsed.data.payload).length === 0;
    let payloadObj: Record<string, unknown>;
    try {
      payloadObj = useServer
        ? ((await buildCanonicalBackup(db)) as unknown as Record<
            string,
            unknown
          >)
        : (parsed.data.payload as Record<string, unknown>);
    } catch (e) {
      return json(
        {
          error: "Failed to assemble backup",
          detail: e instanceof Error ? e.message : String(e),
        },
        503,
      );
    }
    const payloadText = JSON.stringify(payloadObj);
    if (payloadText.length > MAX_BACKUP_BODY) {
      return json({ error: "Backup payload exceeds 20 MB limit" }, 413);
    }
    const bytes = new TextEncoder().encode(payloadText);
    const checksum = await sha256Hex(bytes);
    let stored = false;
    if (env.FILES) {
      try {
        await env.FILES.put(key, bytes, {
          httpMetadata: { contentType: "application/json" },
          customMetadata: { checksum },
        });
        stored = true;
      } catch {
        // R2 put failed
      }
    }
    try {
      await db
        .prepare(
          `INSERT INTO backup_records (backup_id, created_at, created_by, trigger_reason, r2_key, checksum, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          backupId,
          new Date().toISOString(),
          auth!.userId,
          parsed.data.reason ?? (useServer ? "server-canonical" : "manual"),
          key,
          checksum,
          stored ? "STORED" : "RECORDED_NO_R2",
        )
        .run();
    } catch (e) {
      // Same 503 as export catalog miss — do not return 200 + backupId
      // when the list GET reads D1 and the row was never written.
      return json({
        error: "Backup record failed",
        detail: e instanceof Error ? e.message : String(e),
      }, 503);
    }
    try {
      await insertAudit(db, {
        auditId: crypto.randomUUID(),
        userId: auth!.userId,
        action: "BACKUP",
        entity: "backup",
        entityId: backupId,
        newValue: JSON.stringify({
          key,
          stored,
          checksum,
          fromServer: useServer,
        }),
      });
    } catch {
      // ignore
    }
    return json({
      backupId,
      r2Key: key,
      bytes: bytes.byteLength,
      checksum,
      stored,
      fromServer: useServer,
      note: stored
        ? undefined
        : "R2 unbound — metadata + checksum recorded; payload returned for local archive",
      payload: stored ? undefined : payloadObj,
    });
  }

  if (url.pathname === "/api/restore" && request.method === "POST") {
    const denied = requirePerm(auth, "backup.manage");
    if (denied) return denied;
    if (auth!.role !== "ADMIN") {
      return json({ error: "Only ADMIN may restore" }, 403);
    }
    const limited = checkRateLimit(`restore:${auth!.userId}`, {
      limit: 5,
      windowMs: 60_000,
    });
    if (!limited.ok) {
      return json(
        { error: "Rate limit exceeded", retryAfterSec: limited.retryAfterSec },
        429,
      );
    }
    const MAX_RESTORE_BODY = 20 * 1024 * 1024;
    const restoreText = await request.text();
    if (restoreText.length > MAX_RESTORE_BODY) {
      return json({ error: "Restore body exceeds 20 MB limit" }, 413);
    }
    let restoreRaw: unknown;
    try {
      restoreRaw = JSON.parse(restoreText);
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = parseBody(restoreBodySchema, restoreRaw);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    if (parsed.data.expectedChecksum) {
      const actual = await sha256Hex(JSON.stringify(parsed.data.payload));
      if (actual !== parsed.data.expectedChecksum) {
        return json(
          {
            error: "Backup checksum mismatch — refuse restore",
            expected: parsed.data.expectedChecksum,
            actual,
          },
          409,
        );
      }
    }
    const result = await transactionalRestore(
      db,
      parsed.data.payload as BackupPayload,
      {
        adminConfirmed: true,
        includeHistory: parsed.data.includeHistory,
      },
    );
    try {
      await insertAudit(db, {
        auditId: crypto.randomUUID(),
        userId: auth!.userId,
        action: "RESTORE",
        entity: "database",
        entityId: "full",
        newValue: JSON.stringify(result),
        reason: "Admin confirmed transactional restore",
      });
    } catch {
      // ignore audit failure after restore attempt
    }
    if (!result.ok) return json(result, 400);
    return json(result);
  }

  if (url.pathname === "/api/exports" && request.method === "POST") {
    const denied = requirePerm(auth, "master.write");
    if (denied) return denied;
    const parsed = parseBody(exportRecordBodySchema, await request.json());
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const exportId = crypto.randomUUID();
    const key = `exports/${exportId}.meta.json`;
    let r2Key: string | null = null;
    if (env.FILES) {
      try {
        await env.FILES.put(
          key,
          JSON.stringify({
            exportType: parsed.data.exportType,
            examCycleId: parsed.data.examCycleId,
            runId: parsed.data.runId,
            meta: parsed.data.meta ?? {},
          }),
          { httpMetadata: { contentType: "application/json" } },
        );
        r2Key = key;
      } catch {
        // unbound / put failed
      }
    }
    try {
      await insertExportRecord(db, {
        exportId,
        createdBy: auth!.userId,
        exportType: parsed.data.exportType,
        examCycleId: parsed.data.examCycleId,
        runId: parsed.data.runId,
        r2Key,
        metaJson: JSON.stringify(parsed.data.meta ?? {}),
      });
      await insertAudit(db, {
        auditId: crypto.randomUUID(),
        userId: auth!.userId,
        action: "EXPORT",
        entity: "export_records",
        entityId: exportId,
        newValue: JSON.stringify({
          exportType: parsed.data.exportType,
          r2Key,
        }),
      });
    } catch (e) {
      return json(
        {
          error: "Export record failed",
          detail: e instanceof Error ? e.message : String(e),
        },
        503,
      );
    }
    return json({ ok: true, exportId, r2Key });
  }

  if (url.pathname === "/api/manual-overrides" && request.method === "GET") {
    const denied = requirePerm(auth, "audit.read");
    if (denied) return denied;
    try {
      return json({ overrides: await listManualOverrides(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/exports" && request.method === "GET") {
    const denied = requirePerm(auth, "audit.read");
    if (denied) return denied;
    try {
      return json({ exports: await listExportRecords(db) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }
  }

  if (url.pathname === "/api/audit" && request.method === "GET") {
    const denied = requirePerm(auth, "audit.read");
    if (denied) return denied;
    try {
      const rs = await db
        .prepare(
          `SELECT audit_id, user_id, action, entity, entity_id, timestamp, reason, new_value
             FROM audit_logs ORDER BY timestamp DESC LIMIT 200`,
        )
        .all();
      return json({ entries: rs.results });
    } catch (e) {
      return json(
        {
          error: "audit unavailable",
          detail: e instanceof Error ? e.message : String(e),
        },
        503,
      );
    }
  }

  return json({ error: "Not found" }, 404);
}
