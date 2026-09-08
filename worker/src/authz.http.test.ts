/**
 * HTTP AuthZ integration: Worker fetch + local SQLite Env shape.
 * Ensures VIEWER cannot generate/restore; DATA_OPERATOR cannot approve.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import worker from "./index.js";
import type { Env } from "./index.js";
import { createSqliteClient } from "./db/client.js";
import { applyMigrations } from "./db/migrate.js";

describe("HTTP AuthZ on Worker handlers", () => {
  let sqlite: Database.Database;
  let env: Env;

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = createSqliteClient(sqlite);
    await applyMigrations(db, join(process.cwd(), ".."));
    env = {
      DB: db as unknown as D1Database,
      ENVIRONMENT: "development",
    };
  });

  afterAll(() => {
    sqlite.close();
  });

  async function call(
    path: string,
    init: RequestInit & { role?: string } = {},
  ) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (init.role) {
      headers.set("x-dev-role", init.role);
      headers.set("x-dev-email", `${init.role.toLowerCase()}@test.local`);
    }
    const { role: _r, ...rest } = init;
    return worker.fetch(
      new Request(`http://authz.test${path}`, { ...rest, headers }),
      env,
    );
  }

  it("VIEWER can read health and masters but not generate allocation", async () => {
    const health = await call("/api/health");
    expect(health.status).toBe(200);

    const teachers = await call("/api/teachers", { role: "VIEWER" });
    expect(teachers.status).toBe(200);

    const blocks = await call("/api/blocks", { role: "VIEWER" });
    expect(blocks.status).toBe(200);
    const blockBody = (await blocks.json()) as { blocks: unknown[] };
    expect(Array.isArray(blockBody.blocks)).toBe(true);

    const subjects = await call("/api/subjects", { role: "VIEWER" });
    expect(subjects.status).toBe(200);
    const subjectBody = (await subjects.json()) as {
      subjects: Array<{ code: string }>;
    };
    expect(subjectBody.subjects.length).toBe(8);
    expect(subjectBody.subjects.some((s) => s.code === "PHY")).toBe(true);

    const gen = await call("/api/allocation-runs", {
      method: "POST",
      role: "VIEWER",
      body: JSON.stringify({
        runId: "run_viewer_deny",
        examCycleId: "ec_x",
        module: "THEORY",
      }),
    });
    expect(gen.status).toBe(403);
  });

  it("DATA_OPERATOR cannot publish / approve", async () => {
    const pub = await call("/api/allocation-runs/run_x/publish", {
      method: "POST",
      role: "DATA_OPERATOR",
      body: JSON.stringify({ examCycleId: "ec_x", academicYear: "2027" }),
    });
    expect(pub.status).toBe(403);
  });

  it("DATA_OPERATOR cannot restore", async () => {
    const restore = await call("/api/restore", {
      method: "POST",
      role: "DATA_OPERATOR",
      body: JSON.stringify({
        payload: { teachers: [], schools: [], centres: [] },
        adminConfirmed: true,
      }),
    });
    expect(restore.status).toBe(403);
  });

  it("ADMIN restore refuses catalog receipts and non-array cores", async () => {
    const catalog = await call("/api/restore", {
      method: "POST",
      role: "ADMIN",
      body: JSON.stringify({
        payload: {
          error: "Backup payload was not stored",
          backupId: "bak-1",
          stored: false,
        },
        adminConfirmed: true,
        includeHistory: true,
      }),
    });
    expect(catalog.status).toBe(400);
    const catalogBody = (await catalog.json()) as { error?: string; ok?: boolean };
    expect(catalogBody.ok).toBe(false);
    expect(catalogBody.error).toMatch(/missing core collections/);

    const objectTeachers = await call("/api/restore", {
      method: "POST",
      role: "ADMIN",
      body: JSON.stringify({
        payload: {
          teachers: { backupId: "bak-1" },
          schools: [],
          centres: [],
        },
        adminConfirmed: true,
        includeHistory: true,
      }),
    });
    expect(objectTeachers.status).toBe(400);
    const objectBody = (await objectTeachers.json()) as {
      error?: string;
      ok?: boolean;
    };
    expect(objectBody.ok).toBe(false);
    expect(objectBody.error).toMatch(/missing core collections/);
  });

  it("VIEWER can read stored rule parameters for the seed version", async () => {
    const res = await call("/api/rule-versions/rv-2027-1/parameters", {
      role: "VIEWER",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      parameters: Array<{ param_key: string }>;
    };
    expect(body.parameters.length).toBe(18);

    const missing = await call("/api/rule-versions/rv-missing/parameters", {
      role: "OFFICER",
    });
    expect(missing.status).toBe(404);
  });

  it("VIEWER cannot create rule versions", async () => {
    const rv = await call("/api/rule-versions", {
      method: "POST",
      role: "VIEWER",
      body: JSON.stringify({
        versionLabel: "x",
        description: "no",
        cloneFromId: "rv-2027-1",
      }),
    });
    expect(rv.status).toBe(403);
  });

  it("VIEWER can GET import provenance but cannot POST apply", async () => {
    const list = await call("/api/imports", { role: "VIEWER" });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { imports: unknown[] };
    expect(Array.isArray(listBody.imports)).toBe(true);

    const rows = await call("/api/imports/imp-missing/rows", {
      role: "VIEWER",
    });
    expect(rows.status).toBe(200);
    const rowBody = (await rows.json()) as {
      importId: string;
      rows: unknown[];
    };
    expect(rowBody.importId).toBe("imp-missing");
    expect(Array.isArray(rowBody.rows)).toBe(true);

    const apply = await call("/api/imports/apply", {
      method: "POST",
      role: "VIEWER",
      body: JSON.stringify({
        teachers: [
          {
            teacherId: "t1",
            employeeCode: "E1",
            name: "Nope",
            schoolId: "s1",
            designation: "PG",
          },
        ],
      }),
    });
    expect(apply.status).toBe(403);

    const upload = await call("/api/imports", {
      method: "POST",
      role: "VIEWER",
      body: "{}",
    });
    expect(upload.status).toBe(403);
  });

  it("import apply row_count is file rows, not roster upsert", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO blocks (block_id, block_code, block_name, active, created_at, updated_at)
       VALUES ('blk_imp_rc', 'BRC', 'Rowcount Block', 1, ?, ?)`,
    )
      .bind(now, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO schools
        (school_id, school_code, school_name, block_id, active, data_quality, created_at, updated_at)
       VALUES ('sch_imp_rc', 'SRC', 'Rowcount School', 'blk_imp_rc', 1, 'Imported', ?, ?)`,
    )
      .bind(now, now)
      .run();

    const upload = await call("/api/imports", {
      method: "POST",
      role: "OFFICER",
      headers: {
        "x-filename": "teachers.json",
        "x-row-count": "2",
      },
      body: JSON.stringify([
        {
          employeeCode: "E1",
          name: "Ann",
          schoolCode: "SRC",
          designation: "HM",
        },
        {
          employeeCode: "E2",
          name: "Bob",
          schoolCode: "SRC",
          designation: "PG",
        },
      ]),
    });
    expect(upload.status).toBe(200);
    const upBody = (await upload.json()) as {
      importId?: string;
      rowCount?: number;
    };
    expect(upBody.importId).toBeTruthy();
    expect(upBody.rowCount).toBe(2);

    const roster = Array.from({ length: 5 }, (_, i) => ({
      teacherId: `t_imp_rc_${i}`,
      employeeCode: `ERC${i + 1}`,
      name: `Teacher ${i + 1}`,
      schoolId: "sch_imp_rc",
      designation: "PG",
    }));
    const apply = await call("/api/imports/apply", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({
        importId: upBody.importId,
        teachers: roster,
        rows: [
          { rowNumber: 1, status: "NEW", entityKey: "ERC1" },
          { rowNumber: 2, status: "NEW", entityKey: "ERC2" },
          { rowNumber: -1, status: "MISSING", entityKey: "GONE" },
        ],
      }),
    });
    expect(apply.status).toBe(200);
    const applyBody = (await apply.json()) as {
      ok?: boolean;
      upserted?: number;
      importRows?: number;
    };
    expect(applyBody.ok).toBe(true);
    expect(applyBody.upserted).toBe(5);
    expect(applyBody.importRows).toBe(3);

    const list = await call("/api/imports", { role: "VIEWER" });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as {
      imports: Array<{ import_id: string; row_count: number | null }>;
    };
    const row = listed.imports.find((i) => i.import_id === upBody.importId);
    expect(row?.row_count).toBe(2);

    const drill = await call(`/api/imports/${upBody.importId}/rows`, {
      role: "VIEWER",
    });
    expect(drill.status).toBe(200);
    const drillBody = (await drill.json()) as {
      rows: Array<{ row_number: number }>;
    };
    expect(drillBody.rows.filter((r) => r.row_number > 0)).toHaveLength(2);
    expect(drillBody.rows).toHaveLength(3);
    expect(drillBody.rows.filter((r) => r.row_number > 0).length).toBe(
      row?.row_count,
    );
  });

  it("import apply with examCycleId is 409 after PUBLISHED", async () => {
    const created = await call("/api/exam-cycles", {
      method: "POST",
      role: "ADMIN",
      body: JSON.stringify({
        examCycleId: "ec_frozen_imp",
        name: "Frozen import cycle",
        academicYear: "2027",
        ruleVersionId: "rv-2027-1",
        status: "OPEN",
      }),
    });
    expect(created.status).toBe(200);

    const published = await call("/api/exam-cycles/ec_frozen_imp/status", {
      method: "POST",
      role: "ADMIN",
      body: JSON.stringify({ status: "PUBLISHED", force: true }),
    });
    expect(published.status).toBe(200);

    const frozen = await call("/api/imports/apply", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({
        examCycleId: "ec_frozen_imp",
        teachers: [
          {
            teacherId: "t1",
            employeeCode: "E1",
            name: "Nope",
            schoolId: "s1",
            designation: "PG",
          },
        ],
      }),
    });
    expect(frozen.status).toBe(409);
    const frozenBody = (await frozen.json()) as {
      ok?: boolean;
      error?: string;
      conflict?: boolean;
    };
    expect(frozenBody.ok).toBe(false);
    expect(frozenBody.conflict).toBe(true);
    expect(frozenBody.error).toMatch(/PUBLISHED/);

    const club = await call("/api/relationships/clubbing", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({
        examCycleId: "ec_frozen_imp",
        asOfDate: "2027-03-15",
        relationships: [
          {
            centreId: "c1",
            schoolId: "s1",
            relationshipType: "CLUBBED",
            effectiveFrom: "2027-03-15",
          },
        ],
      }),
    });
    expect(club.status).toBe(409);
    const clubBody = (await club.json()) as {
      ok?: boolean;
      conflict?: boolean;
    };
    expect(clubBody.ok).toBe(false);
    expect(clubBody.conflict).toBe(true);

    const cap = await call("/api/centres/capacity", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({
        examCycleId: "ec_frozen_imp",
        centres: [{ centreId: "c1", capacity: 40 }],
      }),
    });
    expect(cap.status).toBe(409);
    const capBody = (await cap.json()) as {
      ok?: boolean;
      conflict?: boolean;
    };
    expect(capBody.ok).toBe(false);
    expect(capBody.conflict).toBe(true);

    const illegal = await call("/api/exam-cycles/ec_frozen_imp/status", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({ status: "ALLOCATION_GENERATED" }),
    });
    expect(illegal.status).toBe(400);
    const illegalBody = (await illegal.json()) as { ok?: boolean; error?: string };
    expect(illegalBody.ok).toBe(false);
    expect(illegalBody.error).toMatch(/Illegal transition/);
  });

  it("POST exam-cycles cannot replace a PUBLISHED id", async () => {
    const created = await call("/api/exam-cycles", {
      method: "POST",
      role: "ADMIN",
      body: JSON.stringify({
        examCycleId: "ec_frozen_create",
        name: "Frozen create cycle",
        academicYear: "2027",
        ruleVersionId: "rv-2027-1",
        status: "OPEN",
      }),
    });
    expect(created.status).toBe(200);

    const published = await call("/api/exam-cycles/ec_frozen_create/status", {
      method: "POST",
      role: "ADMIN",
      body: JSON.stringify({ status: "PUBLISHED", force: true }),
    });
    expect(published.status).toBe(200);

    const replace = await call("/api/exam-cycles", {
      method: "POST",
      role: "ADMIN",
      body: JSON.stringify({
        examCycleId: "ec_frozen_create",
        name: "Clobber published cycle",
        academicYear: "2027",
        ruleVersionId: "rv-2027-1",
        status: "OPEN",
      }),
    });
    expect(replace.status).toBe(409);
    const replaceBody = (await replace.json()) as { error?: string };
    expect(replaceBody.error).toMatch(/PUBLISHED/);
  });

  it("frozen cycle override and window are 409; persist body has accepted:false", async () => {
    const created = await call("/api/exam-cycles", {
      method: "POST",
      role: "ADMIN",
      body: JSON.stringify({
        examCycleId: "ec_frozen_ov",
        name: "Frozen override cycle",
        academicYear: "2027",
        ruleVersionId: "rv-2027-1",
        status: "OPEN",
      }),
    });
    expect(created.status).toBe(200);

    const persistOpen = await call("/api/allocation-runs", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({
        runId: "run_frozen_ov_http",
        examCycleId: "ec_frozen_ov",
        module: "THEORY",
        results: [
          {
            teacherId: "t1",
            centreId: "c1",
            dutyTypeCode: "CHIEF_EXAMINATION",
            roleCode: "CHIEF_EXAMINATION",
            examDate: "2027-03-15",
            sessionCode: "MORNING",
            score: 1,
          },
        ],
      }),
    });
    expect(persistOpen.status).toBe(200);
    const persistOpenBody = (await persistOpen.json()) as {
      accepted?: boolean;
    };
    expect(persistOpenBody.accepted).toBe(true);

    const published = await call("/api/exam-cycles/ec_frozen_ov/status", {
      method: "POST",
      role: "ADMIN",
      body: JSON.stringify({ status: "PUBLISHED", force: true }),
    });
    expect(published.status).toBe(200);

    const ov = await call("/api/manual-overrides", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({
        runId: "run_frozen_ov_http",
        requirementKey: "c1-CHIEF",
        centreId: "c1",
        oldTeacherId: "t1",
        newTeacherId: "t2",
        reason: "stale UI",
      }),
    });
    expect(ov.status).toBe(409);
    const ovBody = (await ov.json()) as { error?: string; conflict?: boolean };
    expect(ovBody.conflict).toBe(true);
    expect(ovBody.error).toMatch(/PUBLISHED|LOCKED|ARCHIVED/);

    const persistFrozen = await call("/api/allocation-runs", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({
        runId: "run_frozen_ov_http_2",
        examCycleId: "ec_frozen_ov",
        module: "THEORY",
      }),
    });
    expect(persistFrozen.status).toBe(409);
    const persistFrozenBody = (await persistFrozen.json()) as {
      accepted?: boolean;
      error?: string;
    };
    expect(persistFrozenBody.accepted).toBe(false);
    expect(persistFrozenBody.error).toMatch(/PUBLISHED/);

    const windowFrozen = await call("/api/exam-cycles/ec_frozen_ov/window", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({ startDate: "2027-04-01", endDate: "2027-04-05" }),
    });
    expect(windowFrozen.status).toBe(409);
    const windowBody = (await windowFrozen.json()) as {
      error?: string;
      conflict?: boolean;
    };
    expect(windowBody.conflict).toBe(true);

    const pubMissing = await call("/api/allocation-runs/run_missing/publish", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({
        examCycleId: "ec_frozen_ov",
        academicYear: "2027",
      }),
    });
    expect(pubMissing.status).toBe(409);
  });

  it("VIEWER cannot POST export receipts; OFFICER can; GET stays audit.read", async () => {
    const denied = await call("/api/exports", {
      method: "POST",
      role: "VIEWER",
      body: JSON.stringify({
        exportType: "teacher-wise-xlsx",
        examCycleId: "ec_x",
        runId: "run_x",
      }),
    });
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as { permission?: string };
    expect(deniedBody.permission).toBe("master.write");

    const created = await call("/api/exports", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({
        exportType: "teacher-wise-xlsx",
        examCycleId: "ec_x",
        runId: "run_x",
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      ok?: boolean;
      exportId?: string;
    };
    expect(createdBody.ok).toBe(true);
    expect(createdBody.exportId).toMatch(/\S/);

    const listed = await call("/api/exports", { role: "VIEWER" });
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      exports: Array<{ export_id: string; export_type: string }>;
    };
    expect(
      listedBody.exports.some((e) => e.export_id === createdBody.exportId),
    ).toBe(true);
  });

  it("POST exports is 503 when catalog insert throws, not 200 + exportId", async () => {
    const brokenEnv: Env = {
      ...env,
      DB: {
        prepare(sql: string) {
          if (String(sql).includes("INSERT INTO export_records")) {
            throw new Error("D1 export catalog miss");
          }
          return env.DB.prepare(sql);
        },
      } as unknown as D1Database,
    };
    const res = await worker.fetch(
      new Request("http://authz.test/api/exports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-role": "OFFICER",
          "x-dev-email": "officer@test.local",
        },
        body: JSON.stringify({
          exportType: "teacher-wise-xlsx",
          examCycleId: "ec_x",
        }),
      }),
      brokenEnv,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok?: boolean;
      exportId?: string;
      error?: string;
    };
    expect(body.ok).toBeUndefined();
    expect(body.exportId).toBeUndefined();
    expect(body.error).toBe("Export record failed");
  });

  it("VIEWER cannot list backups; DATA_OPERATOR cannot override", async () => {
    const backups = await call("/api/backups", { role: "VIEWER" });
    expect(backups.status).toBe(403);

    const ov = await call("/api/manual-overrides", {
      method: "POST",
      role: "DATA_OPERATOR",
      body: JSON.stringify({
        runId: "run_x",
        requirementKey: "c1-CHIEF",
        centreId: "c1",
        oldTeacherId: "t1",
        newTeacherId: "t2",
        reason: "nope",
      }),
    });
    expect(ov.status).toBe(403);
  });

  it("GET exam-cycles is 503 when D1 throws, not 200 + empty cycles", async () => {
    const brokenEnv: Env = {
      ...env,
      DB: {
        prepare() {
          throw new Error("D1 not bound");
        },
      } as unknown as D1Database,
    };
    const res = await worker.fetch(
      new Request("http://authz.test/api/exam-cycles", {
        headers: {
          "x-dev-role": "OFFICER",
          "x-dev-email": "officer@test.local",
        },
      }),
      brokenEnv,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      cycles?: unknown[];
      warning?: string;
      error?: string;
    };
    expect(body.cycles).toBeUndefined();
    expect(body.warning).toBeUndefined();
    expect(body.error).toMatch(/D1 not bound/);
  });

  it("POST backups without FILES returns stored:false plus inline payload, not a silent archive", async () => {
    const res = await call("/api/backups", {
      method: "POST",
      role: "OFFICER",
      body: JSON.stringify({
        fromServer: true,
        reason: "unstored-inline",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      backupId?: string;
      stored?: boolean;
      payload?: Record<string, unknown>;
      error?: string;
    };
    expect(body.error).toBeUndefined();
    expect(body.backupId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.stored).toBe(false);
    expect(body.payload && typeof body.payload === "object").toBe(true);
    expect(Array.isArray(body.payload?.teachers)).toBe(true);

    const listed = await call("/api/backups", { role: "OFFICER" });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      backups: Array<{
        backup_id: string;
        status?: string;
        r2_key?: string | null;
      }>;
    };
    const row = listBody.backups.find((b) => b.backup_id === body.backupId);
    expect(row?.status).toBe("RECORDED_NO_R2");
    expect(row?.r2_key).toBeTruthy();

    const got = await call(`/api/backups/${body.backupId}`, {
      role: "OFFICER",
    });
    expect(got.status).toBe(404);
    const gotBody = (await got.json()) as {
      error?: string;
      stored?: boolean;
      teachers?: unknown;
    };
    expect(gotBody.error).toMatch(/was not stored/);
    expect(gotBody.stored).toBe(false);
    expect(gotBody.teachers).toBeUndefined();
  });

  it("POST backups is 503 when catalog insert throws, not 200 + backupId", async () => {
    const brokenEnv: Env = {
      ...env,
      DB: {
        prepare(sql: string) {
          if (String(sql).includes("INSERT INTO backup_records")) {
            throw new Error("D1 backup catalog miss");
          }
          return env.DB.prepare(sql);
        },
      } as unknown as D1Database,
    };
    const res = await worker.fetch(
      new Request("http://authz.test/api/backups", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-role": "OFFICER",
          "x-dev-email": "officer@test.local",
        },
        body: JSON.stringify({
          fromServer: true,
          reason: "catalog-miss",
        }),
      }),
      brokenEnv,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      backupId?: string;
      stored?: boolean;
      warning?: string;
      error?: string;
    };
    expect(body.backupId).toBeUndefined();
    expect(body.stored).toBeUndefined();
    expect(body.warning).toBeUndefined();
    expect(body.error).toBe("Backup record failed");
  });

  it("POST allocation-runs is 503 when D1 throws, not 200 + warning", async () => {
    const brokenEnv: Env = {
      ...env,
      DB: {
        prepare() {
          throw new Error("D1 not bound");
        },
      } as unknown as D1Database,
    };
    const res = await worker.fetch(
      new Request("http://authz.test/api/allocation-runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-role": "OFFICER",
          "x-dev-email": "officer@test.local",
        },
        body: JSON.stringify({
          runId: "run_d1_miss",
          examCycleId: "ec_any",
          module: "THEORY",
        }),
      }),
      brokenEnv,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      accepted?: boolean;
      warning?: string;
      error?: string;
    };
    expect(body.accepted).toBe(false);
    expect(body.warning).toBeUndefined();
    expect(body.error).toMatch(/D1 not bound/);
  });

  it("staging refuses X-Dev-Role without Access", async () => {
    const stagingEnv: Env = { ...env, ENVIRONMENT: "staging" };
    const res = await worker.fetch(
      new Request("http://authz.test/api/teachers", {
        headers: {
          "x-dev-role": "ADMIN",
          "x-dev-email": "spoof@x",
        },
      }),
      stagingEnv,
    );
    expect(res.status).toBe(401);
  });
});
