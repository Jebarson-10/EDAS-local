/**
 * Local API server using better-sqlite3 with the same SQL as Cloudflare D1.
 * Run: npm run api:local
 * Listens on http://127.0.0.1:43124
 */
import { createServer } from "node:http";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join, resolve, relative, extname } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { createSqliteClient } from "../worker/src/db/client.ts";
import { applyMigrations } from "../worker/src/db/migrate.ts";
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
  ensureExamCycleIfMissing,
  upsertExemption,
  upsertTeachers,
  upsertMasterRecord,
  type BackupPayload,
} from "../worker/src/db/repos.ts";
import {
  allocationRunBodySchema,
  activateRuleVersionBodySchema,
  backupBodySchema,
  centreCapacityBodySchema,
  clubbingApplyBodySchema,
  createExamCycleBodySchema,
  createRuleVersionBodySchema,
  examCycleStatusBodySchema,
  examCycleWindowBodySchema,
  examTimetableBodySchema,
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
} from "../shared/src/index.ts";
import {
  defaultAuthAdapter,
  parseEmailRoleMap,
} from "../worker/src/auth/adapter.ts";
import { hasPermission } from "../worker/src/index.ts";
import { checkRateLimit } from "../worker/src/rateLimit.ts";

const PORT = Number(process.env.API_PORT ?? 43124);
// Electron supplies the read-only resources and writable app-data directory;
// normal development keeps the existing repository-relative locations.
const ROOT = process.env.APP_RESOURCE_DIR ?? process.cwd();
const DATA_DIR = process.env.APP_DATA_DIR ?? join(ROOT, ".data");
const DB_PATH =
    process.env.SQLITE_PATH ?? join(DATA_DIR, "erode-exam-duty.sqlite");
const FILES_DIR = join(DATA_DIR, "files");
const AUTOSAVE_DIR = join(DATA_DIR, "autosave");
const STATIC_DIR = process.env.APP_STATIC_DIR;

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(FILES_DIR, { recursive: true });
mkdirSync(AUTOSAVE_DIR, { recursive: true });

type Role = "ADMIN" | "OFFICER" | "DATA_OPERATOR" | "VIEWER";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/** Serve the packaged SPA without allowing a URL to escape its asset folder. */
function serveStatic(
  pathname: string,
  method: string,
  res: import("node:http").ServerResponse,
): boolean {
  if (!STATIC_DIR || (method !== "GET" && method !== "HEAD")) return false;
  let requested: string;
  try {
    requested = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const staticRoot = resolve(STATIC_DIR);
  const candidate = resolve(staticRoot, `.${requested}`);
  const insideStaticRoot = relative(staticRoot, candidate);
  if (insideStaticRoot.startsWith("..") || insideStaticRoot.includes("..\\")) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return true;
  }
  const filePath =
    existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : join(staticRoot, "index.html");
  if (!existsSync(filePath)) return false;
  const body = method === "HEAD" ? undefined : readFileSync(filePath);
  res.writeHead(200, {
    "content-type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "cache-control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
  return true;
}

async function writeAutosave(db: ReturnType<typeof createSqliteClient>) {
  const payload = await buildCanonicalBackup(db);
  const text = JSON.stringify(payload, null, 2);
  const savedAt = new Date().toISOString();
  const stamp = savedAt.replace(/[:.]/g, "-");
  writeFileSync(join(AUTOSAVE_DIR, `snapshot-${stamp}.json`), text);
  writeFileSync(join(AUTOSAVE_DIR, "latest.json"), text);
  const snapshots = readdirSync(AUTOSAVE_DIR)
    .filter((name) => /^snapshot-.*\.json$/.test(name))
    .sort();
  for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - 12))) {
    unlinkSync(join(AUTOSAVE_DIR, stale));
  }
  return { savedAt, retained: Math.min(snapshots.length, 12) };
}

function auth(req: import("node:http").IncomingMessage) {
  // The packaged desktop application is one local operator on one computer.
  // It has no sign-in screen or shared network listener, so all local actions
  // use Administrator access. Browser/hosted deployments retain their normal
  // role resolution below.
  if (process.env.DESKTOP_SINGLE_USER === "1") {
    return { userId: "desktop:local-operator", email: "local@desktop", role: "ADMIN" as Role };
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v) && v[0]) headers.set(k, v[0]);
  }
  const fake = new Request("http://127.0.0.1/api", { headers });
  const id = defaultAuthAdapter.resolve(
    fake,
    process.env.ENVIRONMENT ?? "development",
    {
      emailRoleMap: parseEmailRoleMap(process.env.ACCESS_EMAIL_ROLE_MAP),
      accessRoleHeader: process.env.ACCESS_ROLE_HEADER,
    },
  );
  if (!id) return null;
  return { userId: id.userId, email: id.email, role: id.role as Role };
}

function json(
  res: import("node:http").ServerResponse,
  data: unknown,
  status = 200,
) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "http://127.0.0.1:43123",
    "access-control-allow-headers":
      "content-type, cf-access-authenticated-user-email, x-access-role, x-dev-role, x-dev-email, x-dev-user, x-filename, x-requested-with",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  res.end(body);
}

function requirePerm(
  a: ReturnType<typeof auth>,
  permission: string,
  res: import("node:http").ServerResponse,
): boolean {
  if (!a) {
    json(res, { error: "Unauthorized" }, 401);
    return false;
  }
  if (!hasPermission(a.role, permission)) {
    json(res, { error: "Forbidden", permission }, 403);
    return false;
  }
  return true;
}

async function readBody(
  req: import("node:http").IncomingMessage,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req)
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

async function main() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("foreign_keys = ON");
  const db = createSqliteClient(sqlite);
  await applyMigrations(db, ROOT);

  // Create only the empty configuration shell. Master records are never
  // fabricated: the operator enters/imports every block, school, centre and
  // teacher used for an allocation.
  await ensureExamCycleIfMissing(db, {
    examCycleId: "ec_2027_hsc",
    name: "New 12th Standard Examination",
    academicYear: "2027",
    status: "OPEN",
    ruleVersionId: "rv-2027-1",
    createdBy: "system",
  });

  const server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method)
        return json(res, { error: "Bad request" }, 400);
      if (req.method === "OPTIONS") return json(res, { ok: true });

      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (!url.pathname.startsWith("/api/") && serveStatic(url.pathname, req.method, res)) {
        return;
      }
      const a = auth(req);

      if (url.pathname === "/api/health") {
        let dbOk = false;
        let counts: Record<string, number> | undefined;
        let dbError: string | undefined;
        try {
          counts = await countMaster(db);
          dbOk = true;
        } catch (e) {
          dbError = e instanceof Error ? e.message : String(e);
        }
        const emailRoleMap = parseEmailRoleMap(
          process.env.ACCESS_EMAIL_ROLE_MAP,
        );
        return json(
          res,
          {
            ok: dbOk,
            dbOk,
            r2Ok: null,
            storage: "filesystem",
            environment: "local-sqlite",
            dbPath: DB_PATH,
            counts,
            accessRoleMapConfigured: Object.keys(emailRoleMap).length > 0,
            accessRoleMapEntries: Object.keys(emailRoleMap).length,
            ...(dbError ? { dbError } : {}),
            note: "Mirrors Cloudflare D1 SQL; allocation still runs client-side; backups use local .data files (r2Ok=null)",
          },
          dbOk ? 200 : 503,
        );
      }

      // A desktop client requests this after state changes. The server writes
      // its canonical SQLite snapshot, so browser memory is never treated as
      // authoritative and published history remains intact.
      if (url.pathname === "/api/autosave" && req.method === "POST") {
        if (!requirePerm(a, "master.write", res)) return;
        try {
          return json(res, { ok: true, ...(await writeAutosave(db)) });
        } catch (e) {
          return json(
            res,
            { ok: false, error: e instanceof Error ? e.message : "Autosave failed" },
            503,
          );
        }
      }

      if (url.pathname === "/api/me") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { user: a });
      }

      if (url.pathname === "/api/rule-versions" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { versions: await listRuleVersions(db) });
      }

      if (url.pathname === "/api/rule-versions" && req.method === "POST") {
        if (!requirePerm(a, "rules.manage", res)) return;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(createRuleVersionBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const ruleVersionId = `rv_${randomUUID().slice(0, 8)}`;
        const created = await createRuleVersion(db, {
          ruleVersionId,
          versionLabel: parsed.data.versionLabel,
          description: parsed.data.description,
          createdBy: a!.userId,
          cloneFromId: parsed.data.cloneFromId,
          activate: parsed.data.activate,
        });
        if (!created.ok) return json(res, created, 400);
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
          action: "CREATE",
          entity: "rule_version",
          entityId: ruleVersionId,
          newValue: JSON.stringify(parsed.data),
          reason: "New rule version (clone; never silent edit)",
        });
        return json(res, { ok: true, ruleVersionId, ...parsed.data });
      }

      if (
        url.pathname.match(/^\/api\/rule-versions\/[^/]+\/parameters$/) &&
        req.method === "GET"
      ) {
        if (!requirePerm(a, "master.read", res)) return;
        const ruleVersionId = url.pathname.split("/")[3]!;
        const version = await getRuleVersion(db, ruleVersionId);
        if (!version) {
          return json(
            res,
            { error: `Rule version ${ruleVersionId} not found` },
            404,
          );
        }
        return json(res, {
          ruleVersionId,
          versionLabel: version.version_label,
          parameters: await listRuleParameters(db, ruleVersionId),
        });
      }

      if (url.pathname === "/api/stats" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { counts: await countMaster(db) });
      }

      if (url.pathname === "/api/teachers" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { teachers: await listTeachers(db) });
      }
      if (url.pathname === "/api/schools" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { schools: await listSchools(db) });
      }
      if (url.pathname === "/api/centres" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { centres: await listCentres(db) });
      }
      if (url.pathname === "/api/blocks" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { blocks: await listBlocks(db) });
      }
      if (url.pathname === "/api/subjects" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { subjects: await listSubjects(db) });
      }
      if (url.pathname === "/api/master-records" && req.method === "POST") {
        if (!requirePerm(a, "master.write", res)) return;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(manualMasterRecordBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        try {
          const result = await upsertMasterRecord(db, parsed.data);
          await insertAudit(db, {
            auditId: randomUUID(),
            userId: a!.userId,
            action: result.created ? "CREATE" : "UPDATE",
            entity: `master_${parsed.data.kind}`,
            entityId: result.id,
            newValue: JSON.stringify(parsed.data),
            reason: "Direct master-data maintenance",
          });
          return json(res, { ok: true, ...result });
        } catch (e) {
          return json(
            res,
            { error: e instanceof Error ? e.message : "Master data save failed" },
            400,
          );
        }
      }
      if (url.pathname === "/api/relationships" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { relationships: await listRelationships(db) });
      }
      if (url.pathname === "/api/history" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { history: await listDutyHistory(db) });
      }
      if (
        url.pathname === "/api/teacher-history/schools" &&
        req.method === "GET"
      ) {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { rows: await listTeacherSchoolHistory(db) });
      }
      if (
        url.pathname === "/api/teacher-history/designations" &&
        req.method === "GET"
      ) {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { rows: await listTeacherDesignationHistory(db) });
      }
      if (
        url.pathname === "/api/teacher-history/locations" &&
        req.method === "GET"
      ) {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { rows: await listTeacherLocationHistory(db) });
      }
      if (url.pathname === "/api/exemptions" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { exemptions: await listExemptions(db) });
      }
      if (url.pathname === "/api/exemptions" && req.method === "POST") {
        if (!requirePerm(a, "master.write", res)) return;
        if (a!.role !== "ADMIN") {
          return json(res, { error: "Only ADMIN may record or end an exemption" }, 403);
        }
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(exemptionBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const result = await upsertExemption(db, {
          ...parsed.data,
          createdBy: a!.userId,
        });
        if (!result.ok) return json(res, result, 400);
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
          action: "UPDATE",
          entity: "teacher_exemptions",
          entityId: result.id,
          newValue: JSON.stringify(parsed.data),
          reason: parsed.data.reason,
        });
        return json(res, { ok: true, id: result.id });
      }

      if (url.pathname === "/api/imports/apply" && req.method === "POST") {
        if (!requirePerm(a, "import.apply", res)) return;
        const limited = checkRateLimit(`import-apply:${a!.userId}`, {
          limit: 30,
          windowMs: 60_000,
        });
        if (!limited.ok) {
          return json(
            res,
            {
              error: "Rate limit exceeded",
              retryAfterSec: limited.retryAfterSec,
            },
            429,
          );
        }
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(importApplyBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        if (parsed.data.examCycleId) {
          const gate = await assertExamCycleMutable(
            db,
            parsed.data.examCycleId,
            "apply import",
          );
          if (!gate.ok) {
            return json(res, gate, mutationConflictStatus(gate));
          }
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
            ? await insertTeacherLocationHistory(
                db,
                parsed.data.locationHistory,
              )
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
              await updateSourceImportStatus(
                db,
                parsed.data.importId,
                "APPLIED",
                {
                  rowCount: importFileRowCount(parsed.data.rows),
                  summaryJson: JSON.stringify({
                    upserted: n,
                    schoolHistory: schoolN,
                    designationHistory: desigN,
                    locationHistory: locN,
                  }),
                },
              );
            } catch {
              // import row may not exist for client-only apply paths
            }
          }
          await insertAudit(db, {
            auditId: randomUUID(),
            userId: a!.userId,
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
          return json(res, {
            ok: true,
            upserted: n,
            schoolHistory: schoolN,
            designationHistory: desigN,
            locationHistory: locN,
            importRows: rowsN,
          });
        } catch (e) {
          return json(
            res,
            {
              error: "Import apply failed",
              detail: e instanceof Error ? e.message : String(e),
            },
            503,
          );
        }
      }

      if (url.pathname === "/api/manual-overrides" && req.method === "POST") {
        if (!requirePerm(a, "allocation.override", res)) return;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(manualOverrideBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const result = await recordManualOverride(db, {
          ...parsed.data,
          changedBy: a!.userId,
        });
        if (!result.ok) {
          return json(res, result, mutationConflictStatus(result));
        }
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
          action: "MANUAL_OVERRIDE",
          entity: "allocation_run",
          entityId: parsed.data.runId,
          newValue: JSON.stringify(parsed.data),
          reason: parsed.data.reason,
        });
        return json(res, result);
      }

      if (url.pathname === "/api/exam-cycles" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { cycles: await listExamCycles(db) });
      }

      if (url.pathname === "/api/exam-cycles" && req.method === "POST") {
        if (!requirePerm(a, "allocation.approve", res)) return;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(createExamCycleBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const created = await createExamCycle(db, {
          examCycleId: parsed.data.examCycleId,
          name: parsed.data.name,
          academicYear: parsed.data.academicYear,
          ruleVersionId: parsed.data.ruleVersionId,
          createdBy: a!.userId,
          status: parsed.data.status,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          amendedFromId: parsed.data.amendedFromId,
          amendmentReason: parsed.data.amendmentReason,
        });
        if (!created.ok) {
          return json(res, created, created.conflict ? 409 : 400);
        }
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
          action: "CREATE",
          entity: "exam_cycle",
          entityId: parsed.data.examCycleId,
          newValue: JSON.stringify(parsed.data),
          reason: parsed.data.amendmentReason ?? "Create exam cycle",
        });
        return json(res, { ok: true, examCycleId: parsed.data.examCycleId });
      }

      if (
        url.pathname.match(/^\/api\/exam-cycles\/[^/]+\/status$/) &&
        req.method === "POST"
      ) {
        if (!requirePerm(a, "allocation.approve", res)) return;
        const cycleId = url.pathname.split("/")[3]!;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(examCycleStatusBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const updated = await updateExamCycleStatus(
          db,
          cycleId,
          parsed.data.status,
          parsed.data.force && a!.role === "ADMIN"
            ? { force: true }
            : undefined,
        );
        if (!updated.ok) return json(res, updated, 400);
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
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
        return json(res, {
          ok: true,
          examCycleId: cycleId,
          status: parsed.data.status,
        });
      }

      if (
        url.pathname.match(/^\/api\/exam-cycles\/[^/]+\/window$/) &&
        req.method === "POST"
      ) {
        if (!requirePerm(a, "allocation.approve", res)) return;
        const cycleId = url.pathname.split("/")[3]!;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(examCycleWindowBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const updated = await setExamCycleWindow(db, cycleId, parsed.data);
        if (!updated.ok) {
          return json(res, updated, mutationConflictStatus(updated));
        }
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
          action: "UPDATE",
          entity: "exam_cycle",
          entityId: cycleId,
          newValue: JSON.stringify(parsed.data),
          reason: "Set examination window",
        });
        return json(res, { ok: true, examCycleId: cycleId, ...parsed.data });
      }

      if (
        url.pathname.match(/^\/api\/exam-cycles\/[^/]+\/timetable$/) &&
        req.method === "GET"
      ) {
        if (!requirePerm(a, "master.read", res)) return;
        const cycleId = url.pathname.split("/")[3]!;
        return json(res, { entries: await listExamTimetable(db, cycleId) });
      }

      if (
        url.pathname.match(/^\/api\/exam-cycles\/[^/]+\/timetable$/) &&
        req.method === "POST"
      ) {
        if (!requirePerm(a, "allocation.approve", res)) return;
        const cycleId = url.pathname.split("/")[3]!;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(examTimetableBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const entries = parsed.data.entries.map((entry) => ({
          ...entry,
          timetableEntryId: entry.timetableEntryId ?? randomUUID(),
        }));
        const updated = await replaceExamTimetable(db, cycleId, entries);
        if (!updated.ok) return json(res, updated, mutationConflictStatus(updated));
        await insertAudit(db, {
          auditId: randomUUID(), userId: a!.userId, action: "UPDATE",
          entity: "exam_timetable", entityId: cycleId,
          newValue: JSON.stringify(entries), reason: "Set examination timetable",
        });
        return json(res, { ok: true, examCycleId: cycleId, entries: await listExamTimetable(db, cycleId) });
      }

      if (
        url.pathname === "/api/rule-versions/activate" &&
        req.method === "POST"
      ) {
        if (!requirePerm(a, "rules.manage", res)) return;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(activateRuleVersionBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const activated = await activateRuleVersion(
          db,
          parsed.data.ruleVersionId,
        );
        if (!activated.ok) return json(res, activated, 400);
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
          action: "UPDATE",
          entity: "rule_version",
          entityId: parsed.data.ruleVersionId,
          newValue: JSON.stringify({
            active: true,
            label: activated.versionLabel,
          }),
          reason: "Activate existing rule version (parameters unchanged)",
        });
        return json(res, {
          ok: true,
          ruleVersionId: parsed.data.ruleVersionId,
          versionLabel: activated.versionLabel,
        });
      }

      if (
        url.pathname === "/api/relationships/clubbing" &&
        req.method === "POST"
      ) {
        if (!requirePerm(a, "master.write", res)) return;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(clubbingApplyBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        if (parsed.data.examCycleId) {
          const gate = await assertExamCycleMutable(
            db,
            parsed.data.examCycleId,
            "apply clubbing",
          );
          if (!gate.ok) {
            return json(res, gate, mutationConflictStatus(gate));
          }
        }
        const result = await replaceClubbingRelationships(db, {
          asOfDate: parsed.data.asOfDate,
          importId: parsed.data.importId,
          relationships: parsed.data.relationships,
        });
        if (!result.ok) return json(res, result, 400);
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
          action: "IMPORT",
          entity: "centre_school_relationships",
          entityId: parsed.data.importId ?? "clubbing",
          newValue: JSON.stringify(result),
          reason:
            "Apply practical clubbing (close prior CLUBBED; never delete HOST)",
        });
        return json(res, {
          ok: true,
          inserted: result.inserted,
          closed: result.closed,
        });
      }

      if (url.pathname === "/api/centres/capacity" && req.method === "POST") {
        if (!requirePerm(a, "master.write", res)) return;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(centreCapacityBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        if (parsed.data.examCycleId) {
          const gate = await assertExamCycleMutable(
            db,
            parsed.data.examCycleId,
            "update centre capacity",
          );
          if (!gate.ok) {
            return json(res, gate, mutationConflictStatus(gate));
          }
        }
        const n = await updateCentreCapacities(db, parsed.data.centres);
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
          action: "UPDATE",
          entity: "centres",
          entityId: "capacity",
          newValue: JSON.stringify({ updated: n }),
          reason: "Centre strength / capacity from booklet import",
        });
        return json(res, { ok: true, updated: n });
      }

      if (url.pathname === "/api/practical-batches" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        const examCycleId = url.searchParams.get("examCycleId") ?? undefined;
        return json(
          res,
          await listPracticalBatches(db, examCycleId ?? undefined),
        );
      }

      if (url.pathname === "/api/practical-batches" && req.method === "POST") {
        if (!requirePerm(a, "allocation.generate", res)) return;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(practicalBatchesBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const gate = await assertExamCycleMutable(
          db,
          parsed.data.examCycleId,
          "persist practical batches",
        );
        if (!gate.ok) return json(res, { error: gate.error }, 409);
        const result = await persistPracticalBatches(db, parsed.data);
        if (!result.ok) return json(res, result, 400);
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
          action: "GENERATE_ALLOCATION",
          entity: "practical_batches",
          entityId: parsed.data.examCycleId,
          newValue: JSON.stringify(result),
        });
        return json(res, {
          ok: true,
          batches: result.batches,
          schedules: result.schedules,
          pairs: result.pairs,
        });
      }

      if (url.pathname === "/api/examiner-pairs" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        return json(res, { pairs: await listExaminerPairs(db) });
      }

      if (url.pathname === "/api/allocation-runs" && req.method === "GET") {
        if (!requirePerm(a, "master.read", res)) return;
        const examCycleId = url.searchParams.get("examCycleId") ?? undefined;
        return json(res, {
          runs: await listAllocationRuns(db, examCycleId ?? undefined),
        });
      }

      if (
        url.pathname.match(/^\/api\/allocation-runs\/[^/]+\/results$/) &&
        req.method === "GET"
      ) {
        if (!requirePerm(a, "master.read", res)) return;
        const runId = url.pathname.split("/")[3]!;
        return json(res, {
          runId,
          results: await listAllocationRunResults(db, runId),
        });
      }

      if (
        url.pathname.match(/^\/api\/allocation-runs\/[^/]+\/reasons$/) &&
        req.method === "GET"
      ) {
        if (!requirePerm(a, "master.read", res)) return;
        const runId = url.pathname.split("/")[3]!;
        return json(res, {
          runId,
          reasons: await listAllocationDecisionReasons(db, runId),
        });
      }

      if (url.pathname === "/api/allocation-runs" && req.method === "POST") {
        if (!requirePerm(a, "allocation.generate", res)) return;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(allocationRunBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const body = parsed.data;
        try {
          const gate = await assertExamCycleMutable(
            db,
            body.examCycleId,
            "generate allocation",
          );
          if (!gate.ok) {
            return json(res, { accepted: false, error: gate.error }, 409);
          }
          const validationFindings = validationFindingsFromRunBody(body);
          const persisted = await persistAllocationRun(db, {
            runId: body.runId,
            examCycleId: body.examCycleId,
            ruleVersionId: body.ruleVersionId ?? "rv-2027-1",
            algorithmVersion: body.algorithmVersion ?? "unknown",
            module: body.module,
            validationStatus: body.validationStatus ?? "PENDING",
            createdBy: a!.userId,
            summaryJson: JSON.stringify(body.summary ?? {}),
            snapshotJson: body.snapshot
              ? JSON.stringify(body.snapshot)
              : undefined,
            results: (body.results ?? []).map((r) => ({
              resultId: randomUUID(),
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
            auditId: randomUUID(),
            userId: a!.userId,
            action: "GENERATE_ALLOCATION",
            entity: "allocation_run",
            entityId: body.runId,
            newValue: body.module,
          });
          return json(res, {
            accepted: true,
            runId: body.runId,
            reasonCount: persisted.reasonCount,
          });
        } catch (e) {
          return json(res, {
            accepted: false,
            error: e instanceof Error ? e.message : String(e),
          }, 503);
        }
      }

      if (
        url.pathname.match(/^\/api\/allocation-runs\/[^/]+\/publish$/) &&
        req.method === "POST"
      ) {
        if (!requirePerm(a, "allocation.approve", res)) return;
        const runId = url.pathname.split("/")[3]!;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(publishRunBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const result = await publishRunToHistory(
          db,
          runId,
          parsed.data.examCycleId,
          parsed.data.academicYear,
        );
        if (!result.ok) return json(res, { error: result.error }, 409);
        if (!result.alreadyPublished) {
          await updateExamCycleStatus(
            db,
            parsed.data.examCycleId,
            "PUBLISHED",
            {
              force: true,
            },
          );
        }
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
          action: "PUBLISH",
          entity: "allocation_run",
          entityId: runId,
          newValue: JSON.stringify({
            published: result.published,
            alreadyPublished: Boolean(result.alreadyPublished),
          }),
        });
        return json(res, {
          ok: true,
          published: result.published,
          alreadyPublished: Boolean(result.alreadyPublished),
        });
      }

      if (url.pathname === "/api/imports" && req.method === "GET") {
        if (!requirePerm(a, "audit.read", res)) return;
        return json(res, { imports: await listSourceImports(db) });
      }

      if (
        url.pathname.match(/^\/api\/imports\/[^/]+\/rows$/) &&
        req.method === "GET"
      ) {
        if (!requirePerm(a, "audit.read", res)) return;
        const importId = url.pathname.split("/")[3]!;
        return json(res, {
          importId,
          rows: await listSourceImportRows(db, importId),
        });
      }

      if (url.pathname === "/api/imports" && req.method === "POST") {
        if (!requirePerm(a, "import.apply", res)) return;
        const limited = checkRateLimit(`import-upload:${a!.userId}`, {
          limit: 20,
          windowMs: 60_000,
        });
        if (!limited.ok) {
          return json(
            res,
            {
              error: "Rate limit exceeded",
              retryAfterSec: limited.retryAfterSec,
            },
            429,
          );
        }
        const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
        const buf = await readBody(req);
        if (buf.length === 0) return json(res, { error: "empty file" }, 400);
        if (buf.length > MAX_IMPORT_BYTES) {
          return json(res, { error: "File exceeds 15 MB limit" }, 413);
        }
        const filename =
          (req.headers["x-filename"] as string | undefined) ?? "upload.bin";
        const bytes = new Uint8Array(buf);
        const lowerName = filename.toLowerCase();
        const isXlsx =
          lowerName.endsWith(".xlsx") &&
          bytes.length >= 2 &&
          bytes[0] === 0x50 &&
          bytes[1] === 0x4b;
        const head = buf
          .toString("utf8", 0, Math.min(8, buf.length))
          .trimStart();
        const isJson =
          lowerName.endsWith(".json") &&
          (head.startsWith("[") || head.startsWith("{"));
        if (!isXlsx && !isJson) {
          return json(
            res,
            {
              error:
                "Unsupported import type — upload .xlsx (OOXML) or .json array/object",
            },
            415,
          );
        }
        const importId = randomUUID();
        const fileHash = await sha256Hex(bytes);
        const rowCount = parseImportRowCountHeader(
          typeof req.headers["x-row-count"] === "string"
            ? req.headers["x-row-count"]
            : undefined,
        );
        const filePath = join(FILES_DIR, `${importId}-${filename}`);
        writeFileSync(filePath, buf);
        await insertSourceImport(db, {
          importId,
          filename,
          fileHash,
          uploadedBy: a!.userId,
          status: "UPLOADED",
          rowCount,
          r2Key: filePath,
          summaryJson: JSON.stringify({ bytes: buf.length, stored: true }),
        });
        await insertAudit(db, {
          auditId: randomUUID(),
          userId: a!.userId,
          action: "IMPORT",
          entity: "source_import",
          entityId: importId,
          newValue: JSON.stringify({
            filename,
            bytes: buf.length,
            fileHash,
            filePath,
          }),
        });
        return json(res, {
          importId,
          filename,
          bytes: buf.length,
          fileHash,
          rowCount,
          r2Key: filePath,
          stored: true,
          note: "Parse/preview/apply is client-assisted; local API stores source provenance on disk",
        });
      }

      if (url.pathname === "/api/backups" && req.method === "GET") {
        if (!requirePerm(a, "backup.manage", res)) return;
        return json(res, { backups: await listBackupRecords(db) });
      }

      if (
        url.pathname.match(/^\/api\/backups\/[^/]+$/) &&
        req.method === "GET"
      ) {
        if (!requirePerm(a, "backup.manage", res)) return;
        const backupId = url.pathname.split("/")[3]!;
        const meta = await getBackupRecord(db, backupId);
        if (!meta) return json(res, { error: "Backup not found" }, 404);
        if (meta.status === "RECORDED_NO_R2") {
          return json(
            res,
            {
              error: "Backup payload was not stored",
              backupId,
              stored: false,
              status: meta.status,
            },
            404,
          );
        }
        const filePath = meta.r2_key;
        if (!filePath || !existsSync(filePath)) {
          return json(
            res,
            { error: "Backup file missing on disk", backupId },
            404,
          );
        }
        const payloadText = readFileSync(filePath, "utf8");
        const actual = await sha256Hex(payloadText);
        if (meta.checksum && actual !== meta.checksum) {
          return json(
            res,
            {
              error: "Stored backup checksum mismatch",
              expected: meta.checksum,
              actual,
            },
            409,
          );
        }
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
          "access-control-allow-origin": "http://127.0.0.1:43123",
          "content-disposition": `attachment; filename="${backupId}.json"`,
          "x-backup-checksum": meta.checksum ?? actual,
        });
        res.end(payloadText);
        return;
      }

      if (url.pathname === "/api/backups" && req.method === "POST") {
        if (!requirePerm(a, "backup.manage", res)) return;
        const limited = checkRateLimit(`backup:${a!.userId}`, {
          limit: 20,
          windowMs: 60_000,
        });
        if (!limited.ok) {
          return json(
            res,
            {
              error: "Rate limit exceeded",
              retryAfterSec: limited.retryAfterSec,
            },
            429,
          );
        }
        const buf = await readBody(req);
        const MAX_BACKUP_BODY = 20 * 1024 * 1024;
        if (buf.length > MAX_BACKUP_BODY) {
          return json(res, { error: "Backup body exceeds 20 MB limit" }, 413);
        }
        const raw = JSON.parse(buf.toString("utf8"));
        const parsed = parseBody(backupBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const backupId = randomUUID();
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
            res,
            {
              error: "Failed to assemble backup",
              detail: e instanceof Error ? e.message : String(e),
            },
            503,
          );
        }
        const payloadText = JSON.stringify(payloadObj);
        if (payloadText.length > MAX_BACKUP_BODY) {
          return json(
            res,
            { error: "Backup payload exceeds 20 MB limit" },
            413,
          );
        }
        const filePath = join(FILES_DIR, `${backupId}.json`);
        try {
          writeFileSync(filePath, payloadText);
        } catch (e) {
          return json(
            res,
            {
              error: "Backup store failed",
              detail: e instanceof Error ? e.message : String(e),
            },
            503,
          );
        }
        const checksum = await sha256Hex(payloadText);
        try {
          await db
            .prepare(
              `INSERT INTO backup_records (backup_id, created_at, created_by, trigger_reason, r2_key, checksum, status)
           VALUES (?, ?, ?, ?, ?, ?, 'STORED')`,
            )
            .bind(
              backupId,
              new Date().toISOString(),
              a!.userId,
              parsed.data.reason ?? (useServer ? "server-canonical" : "manual"),
              filePath,
              checksum,
            )
            .run();
        } catch (e) {
          return json(
            res,
            {
              error: "Backup record failed",
              detail: e instanceof Error ? e.message : String(e),
            },
            503,
          );
        }
        try {
          await insertAudit(db, {
            auditId: randomUUID(),
            userId: a!.userId,
            action: "BACKUP",
            entity: "backup",
            entityId: backupId,
            newValue: JSON.stringify({
              path: filePath,
              checksum,
              fromServer: useServer,
            }),
          });
        } catch {
          // ignore audit failure after catalog write
        }
        return json(res, {
          backupId,
          r2Key: filePath,
          bytes: payloadText.length,
          checksum,
          stored: true,
          fromServer: useServer,
        });
      }

      if (url.pathname === "/api/restore" && req.method === "POST") {
        if (!requirePerm(a, "backup.manage", res)) return;
        if (a!.role !== "ADMIN") {
          return json(res, { error: "Only ADMIN may restore" }, 403);
        }
        const limited = checkRateLimit(`restore:${a!.userId}`, {
          limit: 5,
          windowMs: 60_000,
        });
        if (!limited.ok) {
          return json(
            res,
            {
              error: "Rate limit exceeded",
              retryAfterSec: limited.retryAfterSec,
            },
            429,
          );
        }
        const buf = await readBody(req);
        if (buf.length > 20 * 1024 * 1024) {
          return json(res, { error: "Restore body exceeds 20 MB limit" }, 413);
        }
        let raw: unknown;
        try {
          raw = JSON.parse(buf.toString("utf8"));
        } catch {
          return json(res, { error: "Invalid JSON body" }, 400);
        }
        const parsed = parseBody(restoreBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        if (parsed.data.expectedChecksum) {
          const actual = await sha256Hex(JSON.stringify(parsed.data.payload));
          if (actual !== parsed.data.expectedChecksum) {
            return json(
              res,
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
            auditId: randomUUID(),
            userId: a!.userId,
            action: "RESTORE",
            entity: "database",
            entityId: "full",
            newValue: JSON.stringify(result),
            reason: "Admin confirmed transactional restore",
          });
        } catch {
          // Same as Worker — restore already ran; do not turn a catalog
          // audit miss into a 500 that the UI treats as restore failed.
        }
        if (!result.ok) return json(res, result, 400);
        return json(res, result);
      }

      if (url.pathname === "/api/exports" && req.method === "POST") {
        if (!requirePerm(a, "master.write", res)) return;
        const raw = JSON.parse((await readBody(req)).toString("utf8"));
        const parsed = parseBody(exportRecordBodySchema, raw);
        if (!parsed.ok) return json(res, { error: parsed.error }, 400);
        const exportId = randomUUID();
        const metaPath = join(FILES_DIR, `${exportId}-export.meta.json`);
        writeFileSync(
          metaPath,
          JSON.stringify({
            exportType: parsed.data.exportType,
            examCycleId: parsed.data.examCycleId,
            runId: parsed.data.runId,
            meta: parsed.data.meta ?? {},
          }),
        );
        try {
          await insertExportRecord(db, {
            exportId,
            createdBy: a!.userId,
            exportType: parsed.data.exportType,
            examCycleId: parsed.data.examCycleId,
            runId: parsed.data.runId,
            r2Key: metaPath,
            metaJson: JSON.stringify(parsed.data.meta ?? {}),
          });
          await insertAudit(db, {
            auditId: randomUUID(),
            userId: a!.userId,
            action: "EXPORT",
            entity: "export_records",
            entityId: exportId,
            newValue: JSON.stringify({
              exportType: parsed.data.exportType,
              path: metaPath,
            }),
          });
        } catch (e) {
          return json(
            res,
            {
              error: "Export record failed",
              detail: e instanceof Error ? e.message : String(e),
            },
            503,
          );
        }
        return json(res, { ok: true, exportId, r2Key: metaPath });
      }

      if (url.pathname === "/api/manual-overrides" && req.method === "GET") {
        if (!requirePerm(a, "audit.read", res)) return;
        return json(res, { overrides: await listManualOverrides(db) });
      }

      if (url.pathname === "/api/exports" && req.method === "GET") {
        if (!requirePerm(a, "audit.read", res)) return;
        return json(res, { exports: await listExportRecords(db) });
      }

      if (url.pathname === "/api/audit" && req.method === "GET") {
        if (!requirePerm(a, "audit.read", res)) return;
        const rs = await db
          .prepare(
            `SELECT audit_id, user_id, action, entity, entity_id, timestamp, reason, new_value
           FROM audit_logs ORDER BY timestamp DESC LIMIT 200`,
          )
          .all();
        return json(res, { entries: rs.results });
      }

      return json(res, { error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      return json(
        res,
        { error: e instanceof Error ? e.message : "Server error" },
        500,
      );
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Local exam-duty API on http://127.0.0.1:${PORT}`);
    console.log(`SQLite DB: ${DB_PATH}`);
    console.log(`APP_READY http://127.0.0.1:${PORT}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error("API server failed to listen:", err.message);
    process.exit(1);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
