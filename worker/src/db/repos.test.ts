import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSqliteClient } from "./client.js";
import { applyMigrations } from "./migrate.js";
import {
  transactionalRestore,
  countMaster,
  listBlocks,
  listSubjects,
  listTeachers,
  upsertTeachers,
  upsertExamCycle,
  updateExamCycleStatus,
  createRuleVersion,
  activateRuleVersion,
  listRuleVersions,
  listRuleParameters,
  getRuleVersion,
  listExamCycles,
  replaceClubbingRelationships,
  updateCentreCapacities,
  persistPracticalBatches,
  persistAllocationRun,
  seedDemoDatasetIfEmpty,
  getExamCycleStatus,
  insertAudit,
  insertExportRecord,
  insertSourceImport,
} from "./repos.js";
import { join } from "node:path";
import { readFileSync } from "node:fs";

describe("transactional restore", () => {
  let db: ReturnType<typeof createSqliteClient>;
  let sqlite: Database.Database;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    db = createSqliteClient(sqlite);
    await applyMigrations(db, join(process.cwd(), ".."));
  });

  it("rejects catalog receipts and non-array cores instead of wiping", async () => {
    const catalog = await transactionalRestore(
      db,
      {
        error: "Backup payload was not stored",
        backupId: "bak-1",
        stored: false,
      } as unknown as Parameters<typeof transactionalRestore>[1],
      { adminConfirmed: true, includeHistory: true },
    );
    expect(catalog.ok).toBe(false);
    if (!catalog.ok) expect(catalog.error).toMatch(/missing core collections/);

    const objectTeachers = await transactionalRestore(
      db,
      {
        teachers: { backupId: "bak-1" },
        schools: [],
        centres: [],
      } as unknown as Parameters<typeof transactionalRestore>[1],
      { adminConfirmed: true, includeHistory: true },
    );
    expect(objectTeachers.ok).toBe(false);
    if (!objectTeachers.ok) {
      expect(objectTeachers.error).toMatch(/missing core collections/);
    }
  });

  it("requires admin confirmation", async () => {
    const r = await transactionalRestore(
      db,
      {
        metadata: {},
        teachers: [],
        schools: [],
        centres: [],
        centre_school_relationships: [],
        duty_history: [],
      },
      { adminConfirmed: false },
    );
    expect(r.ok).toBe(false);
  });

  it("rejects teachers that reference missing schools", async () => {
    const r = await transactionalRestore(
      db,
      {
        teachers: [
          {
            teacherId: "t1",
            employeeCode: "E1",
            name: "T",
            schoolId: "missing",
            designation: "HM",
          },
        ],
        schools: [],
        centres: [],
      },
      { adminConfirmed: true, includeHistory: true },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/missing school/);
  });

  it("restores master data and rolls back on failure path by not leaving partial teachers", async () => {
    const payload = {
      metadata: {},
      blocks: [{ blockId: "b1", blockCode: "B1", blockName: "Block" }],
      schools: [
        {
          schoolId: "s1",
          schoolCode: "S1",
          schoolName: "School",
          blockId: "b1",
          latitude: 11.3,
          longitude: 77.7,
          active: true,
        },
      ],
      centres: [
        {
          centreId: "c1",
          centreCode: "C1",
          centreName: "Centre",
          blockId: "b1",
          latitude: 11.3,
          longitude: 77.7,
          active: true,
        },
      ],
      centre_school_relationships: [
        {
          centreId: "c1",
          schoolId: "s1",
          relationshipType: "HOST",
          effectiveFrom: "2020-01-01",
        },
      ],
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Teacher",
          schoolId: "s1",
          designation: "HM",
          isActive: true,
          homeLatitude: 11.3,
          homeLongitude: 77.7,
        },
      ],
      duty_history: [],
    };

    const r = await transactionalRestore(db, payload, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.counts.teachers).toBe(1);
      expect(r.counts.schools).toBe(1);
    }
    const counts = await countMaster(db);
    expect(counts.teachers).toBe(1);
  });

  it("accepts demo-dataset aliases and restores history when requested", async () => {
    const demoPath = join(
      process.cwd(),
      "../frontend/public/demo-dataset.json",
    );
    const demo = JSON.parse(readFileSync(demoPath, "utf8"));
    const r = await transactionalRestore(db, demo, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.counts.teachers).toBe(demo.teachers.length);
      expect(r.counts.relationships).toBe(demo.relationships.length);
      expect(r.counts.history).toBe(demo.history.length);
    }
    const counts = await countMaster(db);
    expect(counts.teachers).toBe(demo.teachers.length);
    expect(counts.history).toBe(demo.history.length);
  });

  it("preserves published history when includeHistory is false", async () => {
    const first = {
      schools: [
        {
          schoolId: "s1",
          schoolCode: "S1",
          schoolName: "School",
          blockId: "b1",
          active: true,
        },
      ],
      centres: [
        {
          centreId: "c1",
          centreCode: "C1",
          centreName: "Centre",
          blockId: "b1",
          active: true,
        },
      ],
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Teacher",
          schoolId: "s1",
          designation: "HM",
          isActive: true,
        },
      ],
      relationships: [],
      history: [
        {
          teacherId: "t1",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          examDate: "2026-03-01",
          sessionCode: "MORNING",
          academicYear: "2026",
        },
      ],
    };
    const seeded = await transactionalRestore(db, first, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(seeded.ok).toBe(true);

    const second = {
      ...first,
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Teacher Updated",
          schoolId: "s1",
          designation: "HM",
          isActive: true,
        },
      ],
      history: [],
    };
    const preserved = await transactionalRestore(db, second, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(preserved.ok).toBe(true);
    const counts = await countMaster(db);
    expect(counts.history).toBe(1);
    const name = sqlite
      .prepare(`SELECT name FROM teachers WHERE teacher_id='t1'`)
      .get() as {
      name: string;
    };
    expect(name.name).toBe("Teacher Updated");
  });

  it("restores teacher school/designation/location history from backup payload", async () => {
    const {
      listTeacherSchoolHistory,
      listTeacherDesignationHistory,
      listTeacherLocationHistory,
    } = await import("./repos.js");
    const payload = {
      schools: [
        {
          schoolId: "s1",
          schoolCode: "S1",
          schoolName: "School",
          blockId: "b1",
          active: true,
        },
        {
          schoolId: "s2",
          schoolCode: "S2",
          schoolName: "School 2",
          blockId: "b1",
          active: true,
        },
      ],
      centres: [
        {
          centreId: "c1",
          centreCode: "C1",
          centreName: "Centre",
          blockId: "b1",
          active: true,
        },
      ],
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Teacher",
          schoolId: "s1",
          designation: "HM",
          isActive: true,
        },
      ],
      relationships: [],
      history: [],
      teacher_school_history: [
        {
          id: "tsh_restore",
          teacherId: "t1",
          schoolId: "s2",
          effectiveFrom: "2020-01-01",
          effectiveTo: "2025-12-31",
        },
      ],
      teacher_designation_history: [
        {
          id: "tdh_restore",
          teacherId: "t1",
          designation: "PG",
          effectiveFrom: "2018-01-01",
          effectiveTo: "2023-12-31",
        },
      ],
      teacher_location_history: [
        {
          id: "tlh_restore",
          teacherId: "t1",
          locationType: "HOME",
          latitude: 11.34,
          longitude: 77.72,
          effectiveFrom: "2024-01-01",
        },
      ],
    };
    const r = await transactionalRestore(db, payload, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.counts.teacherSchoolHistory).toBe(1);
    expect(r.counts.teacherDesignationHistory).toBe(1);
    expect(r.counts.teacherLocationHistory).toBe(1);
    const schoolHist = await listTeacherSchoolHistory(db);
    expect(
      schoolHist.some((row) => (row as { id: string }).id === "tsh_restore"),
    ).toBe(true);
    const desigHist = await listTeacherDesignationHistory(db);
    expect(
      desigHist.some((row) => (row as { id: string }).id === "tdh_restore"),
    ).toBe(true);
    const locHist = await listTeacherLocationHistory(db);
    expect(
      locHist.some((row) => (row as { id: string }).id === "tlh_restore"),
    ).toBe(true);
  });

  it("restores teacher exemptions from backup payload", async () => {
    const { listExemptions } = await import("./repos.js");
    const payload = {
      schools: [
        {
          schoolId: "s1",
          schoolCode: "S1",
          schoolName: "School",
          blockId: "b1",
          active: true,
        },
      ],
      centres: [
        {
          centreId: "c1",
          centreCode: "C1",
          centreName: "Centre",
          blockId: "b1",
          active: true,
        },
      ],
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Teacher",
          schoolId: "s1",
          designation: "HM",
          isActive: true,
        },
      ],
      relationships: [],
      history: [],
      teacher_exemptions: [
        {
          id: "ex_restore",
          teacherId: "t1",
          reason: "Medical leave",
          effectiveFrom: "2027-01-01",
          isExempted: true,
        },
      ],
    };
    const r = await transactionalRestore(db, payload, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.counts.exemptions).toBe(1);
    const listed = await listExemptions(db);
    expect(
      listed.some((row) => (row as { id: string }).id === "ex_restore"),
    ).toBe(true);
  });

  it("canonical restore wipes leftover teacher_exemptions when the key is present", async () => {
    const { buildCanonicalBackup, listExemptions } = await import("./repos.js");
    const seeded = await transactionalRestore(
      db,
      {
        schools: [
          {
            schoolId: "s1",
            schoolCode: "S1",
            schoolName: "School",
            blockId: "b1",
            active: true,
          },
        ],
        centres: [
          {
            centreId: "c1",
            centreCode: "C1",
            centreName: "Centre",
            blockId: "b1",
            active: true,
          },
        ],
        teachers: [
          {
            teacherId: "t1",
            employeeCode: "E1",
            name: "Teacher",
            schoolId: "s1",
            designation: "HM",
            isActive: true,
          },
        ],
        relationships: [],
        history: [],
        teacher_exemptions: [
          {
            id: "ex_keep",
            teacherId: "t1",
            reason: "Medical leave",
            effectiveFrom: "2027-01-01",
            isExempted: true,
          },
        ],
      },
      { adminConfirmed: true, includeHistory: false },
    );
    expect(seeded.ok).toBe(true);
    const snapshot = await buildCanonicalBackup(db);
    expect(Array.isArray(snapshot.teacher_exemptions)).toBe(true);

    sqlite
      .prepare(
        `INSERT INTO teacher_exemptions
          (id, teacher_id, is_exempted, reason, effective_from, created_at, created_by)
         VALUES ('ex_leftover', 't1', 1, 'Post-snapshot leftover', '2027-06-01', ?, 'test')`,
      )
      .run(new Date().toISOString());
    expect(
      (await listExemptions(db)).some(
        (row) => (row as { id: string }).id === "ex_leftover",
      ),
    ).toBe(true);

    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    const after = await listExemptions(db);
    expect(after.some((row) => (row as { id: string }).id === "ex_leftover")).toBe(
      false,
    );
    expect(after.some((row) => (row as { id: string }).id === "ex_keep")).toBe(
      true,
    );
  });

  it("empty teacher_exemptions key wipes leftover exemptions", async () => {
    const { listExemptions } = await import("./repos.js");
    const masters = {
      schools: [
        {
          schoolId: "s1",
          schoolCode: "S1",
          schoolName: "School",
          blockId: "b1",
          active: true,
        },
      ],
      centres: [
        {
          centreId: "c1",
          centreCode: "C1",
          centreName: "Centre",
          blockId: "b1",
          active: true,
        },
      ],
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Teacher",
          schoolId: "s1",
          designation: "HM",
          isActive: true,
        },
      ],
      relationships: [],
      history: [],
    };
    const seeded = await transactionalRestore(
      db,
      {
        ...masters,
        teacher_exemptions: [
          {
            id: "ex_empty_wipe",
            teacherId: "t1",
            reason: "Will be emptied",
            effectiveFrom: "2027-01-01",
            isExempted: true,
          },
        ],
      },
      { adminConfirmed: true, includeHistory: false },
    );
    expect(seeded.ok).toBe(true);

    const restored = await transactionalRestore(
      db,
      { ...masters, teacher_exemptions: [] },
      { adminConfirmed: true, includeHistory: false },
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(await listExemptions(db)).toHaveLength(0);
  });

  it("old/offline payloads without teacher_exemptions leave live exemptions", async () => {
    const { listExemptions } = await import("./repos.js");
    const masters = {
      schools: [
        {
          schoolId: "s1",
          schoolCode: "S1",
          schoolName: "School",
          blockId: "b1",
          active: true,
        },
      ],
      centres: [
        {
          centreId: "c1",
          centreCode: "C1",
          centreName: "Centre",
          blockId: "b1",
          active: true,
        },
      ],
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Teacher",
          schoolId: "s1",
          designation: "HM",
          isActive: true,
        },
      ],
      relationships: [],
      history: [],
    };
    const seeded = await transactionalRestore(
      db,
      {
        ...masters,
        teacher_exemptions: [
          {
            id: "ex_keep_omit",
            teacherId: "t1",
            reason: "Keep when key omitted",
            effectiveFrom: "2027-01-01",
            isExempted: true,
          },
        ],
      },
      { adminConfirmed: true, includeHistory: false },
    );
    expect(seeded.ok).toBe(true);

    const restored = await transactionalRestore(db, masters, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(
      (await listExemptions(db)).some(
        (row) => (row as { id: string }).id === "ex_keep_omit",
      ),
    ).toBe(true);
  });

  it("includeHistory=true still clears omitted exemptions so teacher delete is FK-safe", async () => {
    const { listExemptions } = await import("./repos.js");
    const masters = {
      schools: [
        {
          schoolId: "s1",
          schoolCode: "S1",
          schoolName: "School",
          blockId: "b1",
          active: true,
        },
      ],
      centres: [
        {
          centreId: "c1",
          centreCode: "C1",
          centreName: "Centre",
          blockId: "b1",
          active: true,
        },
      ],
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Teacher",
          schoolId: "s1",
          designation: "HM",
          isActive: true,
        },
      ],
      relationships: [],
      history: [],
    };
    const seeded = await transactionalRestore(
      db,
      {
        ...masters,
        teacher_exemptions: [
          {
            id: "ex_fk",
            teacherId: "t1",
            reason: "FK hygiene",
            effectiveFrom: "2027-01-01",
            isExempted: true,
          },
        ],
      },
      { adminConfirmed: true, includeHistory: false },
    );
    expect(seeded.ok).toBe(true);

    const restored = await transactionalRestore(db, masters, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(await listExemptions(db)).toHaveLength(0);
  });

  it("canonical restore wipes leftover teacher school history when the key is present", async () => {
    const { buildCanonicalBackup, listTeacherSchoolHistory } = await import(
      "./repos.js"
    );
    const seeded = await transactionalRestore(
      db,
      {
        schools: [
          {
            schoolId: "s1",
            schoolCode: "S1",
            schoolName: "School",
            blockId: "b1",
            active: true,
          },
          {
            schoolId: "s2",
            schoolCode: "S2",
            schoolName: "School 2",
            blockId: "b1",
            active: true,
          },
        ],
        centres: [
          {
            centreId: "c1",
            centreCode: "C1",
            centreName: "Centre",
            blockId: "b1",
            active: true,
          },
        ],
        teachers: [
          {
            teacherId: "t1",
            employeeCode: "E1",
            name: "Teacher",
            schoolId: "s1",
            designation: "HM",
            isActive: true,
          },
        ],
        relationships: [],
        history: [],
        teacher_school_history: [
          {
            id: "tsh_keep",
            teacherId: "t1",
            schoolId: "s2",
            effectiveFrom: "2020-01-01",
            effectiveTo: "2025-12-31",
          },
        ],
      },
      { adminConfirmed: true, includeHistory: false },
    );
    expect(seeded.ok).toBe(true);
    const snapshot = await buildCanonicalBackup(db);
    sqlite
      .prepare(
        `INSERT INTO teacher_school_history
          (id, teacher_id, school_id, effective_from, created_at)
         VALUES ('tsh_leftover', 't1', 's1', '2026-01-01', ?)`,
      )
      .run(new Date().toISOString());

    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    const after = await listTeacherSchoolHistory(db);
    expect(after.some((row) => (row as { id: string }).id === "tsh_leftover")).toBe(
      false,
    );
    expect(after.some((row) => (row as { id: string }).id === "tsh_keep")).toBe(
      true,
    );
  });

  it("includeHistory=true wipes leftover duty_assignment_history", async () => {
    const first = {
      schools: [
        {
          schoolId: "s1",
          schoolCode: "S1",
          schoolName: "School",
          blockId: "b1",
          active: true,
        },
      ],
      centres: [
        {
          centreId: "c1",
          centreCode: "C1",
          centreName: "Centre",
          blockId: "b1",
          active: true,
        },
      ],
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Teacher",
          schoolId: "s1",
          designation: "HM",
          isActive: true,
        },
      ],
      relationships: [],
      history: [
        {
          teacherId: "t1",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          examDate: "2026-03-01",
          sessionCode: "MORNING",
          academicYear: "2026",
        },
      ],
    };
    const seeded = await transactionalRestore(db, first, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(seeded.ok).toBe(true);
    const { buildCanonicalBackup } = await import("./repos.js");
    const snapshot = await buildCanonicalBackup(db);
    const before = await countMaster(db);
    expect(before.history).toBe(1);

    sqlite
      .prepare(
        `INSERT INTO duty_assignment_history
          (history_id, assignment_id, exam_cycle_id, teacher_id, centre_id, duty_type_code, exam_date, session_code, academic_year, published_at)
         VALUES ('h_leftover', 'a_leftover', 'ec_leftover', 't1', 'c1', 'CHIEF_EXAMINATION', '2026-06-01', 'MORNING', '2026', ?)`,
      )
      .run(new Date().toISOString());
    expect((await countMaster(db)).history).toBe(2);

    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect((await countMaster(db)).history).toBe(1);
    expect(
      sqlite
        .prepare(
          `SELECT history_id FROM duty_assignment_history WHERE history_id='h_leftover'`,
        )
        .get(),
    ).toBeUndefined();
  });

  it("lists master data and upserts teachers without deleting history", async () => {
    await transactionalRestore(
      db,
      {
        schools: [
          {
            schoolId: "s1",
            schoolCode: "S1",
            schoolName: "School",
            blockId: "b1",
            active: true,
          },
        ],
        centres: [
          {
            centreId: "c1",
            centreCode: "C1",
            centreName: "Centre",
            blockId: "b1",
            active: true,
          },
        ],
        teachers: [
          {
            teacherId: "t1",
            employeeCode: "E1",
            name: "Teacher",
            schoolId: "s1",
            designation: "HM",
            isActive: true,
          },
        ],
        history: [
          {
            teacherId: "t1",
            centreId: "c1",
            dutyTypeCode: "CHIEF_EXAMINATION",
            examDate: "2026-03-01",
            sessionCode: "MORNING",
            academicYear: "2026",
          },
        ],
      },
      { adminConfirmed: true, includeHistory: true },
    );
    const listed = await listTeachers(db);
    expect(listed.length).toBe(1);
    const n = await upsertTeachers(db, [
      {
        teacherId: "t1",
        employeeCode: "E1",
        name: "Teacher Renamed",
        schoolId: "s1",
        designation: "HM",
        isActive: true,
      },
    ]);
    expect(n).toBe(1);
    const counts = await countMaster(db);
    expect(counts.history).toBe(1);
    expect(counts.teachers).toBe(1);
  });

  it("upserts by employee_code without creating a duplicate teacher_id", async () => {
    await transactionalRestore(
      db,
      {
        schools: [
          {
            schoolId: "s1",
            schoolCode: "S1",
            schoolName: "School",
            blockId: "b1",
            active: true,
          },
        ],
        centres: [],
        teachers: [
          {
            teacherId: "t1",
            employeeCode: "EMP-99",
            name: "Original",
            schoolId: "s1",
            designation: "PG",
            isActive: true,
          },
        ],
      },
      { adminConfirmed: true, includeHistory: true },
    );
    const n = await upsertTeachers(db, [
      {
        teacherId: "t_new_id_from_import",
        employeeCode: "EMP-99",
        name: "Updated Via Import",
        schoolId: "s1",
        designation: "PG",
        isActive: true,
      },
    ]);
    expect(n).toBe(1);
    const counts = await countMaster(db);
    expect(counts.teachers).toBe(1);
    const row = sqlite
      .prepare(
        `SELECT teacher_id, name FROM teachers WHERE employee_code='EMP-99'`,
      )
      .get() as { teacher_id: string; name: string };
    expect(row.teacher_id).toBe("t1");
    expect(row.name).toBe("Updated Via Import");
  });

  it("resolves employee_code collision without UNIQUE failure", async () => {
    await transactionalRestore(
      db,
      {
        schools: [
          {
            schoolId: "s1",
            schoolCode: "S1",
            schoolName: "School",
            blockId: "b1",
            active: true,
          },
        ],
        centres: [],
        teachers: [
          {
            teacherId: "t1",
            employeeCode: "EMP-A",
            name: "Alpha",
            schoolId: "s1",
            designation: "PG",
            isActive: true,
          },
          {
            teacherId: "t2",
            employeeCode: "EMP-B",
            name: "Beta",
            schoolId: "s1",
            designation: "PG",
            isActive: true,
          },
        ],
      },
      { adminConfirmed: true, includeHistory: true },
    );
    // Import claims teacher_id=t1 but employee_code already owned by t2 → update t2
    const n = await upsertTeachers(db, [
      {
        teacherId: "t1",
        employeeCode: "EMP-B",
        name: "Beta Via Import",
        schoolId: "s1",
        designation: "HM",
        isActive: true,
      },
    ]);
    expect(n).toBe(1);
    const beta = sqlite
      .prepare(
        `SELECT teacher_id, name, designation FROM teachers WHERE employee_code='EMP-B'`,
      )
      .get() as { teacher_id: string; name: string; designation: string };
    expect(beta.teacher_id).toBe("t2");
    expect(beta.name).toBe("Beta Via Import");
    expect(beta.designation).toBe("HM");
    const counts = await countMaster(db);
    expect(counts.teachers).toBe(2);
  });

  it("canonical restore wipes leftover subjects and rule_parameters", async () => {
    const { buildCanonicalBackup, listRuleParameters } = await import(
      "./repos.js"
    );
    const snapshot = await buildCanonicalBackup(db);
    expect(Array.isArray(snapshot.subjects)).toBe(true);
    expect(Array.isArray(snapshot.rule_parameters)).toBe(true);

    sqlite
      .prepare(
        `INSERT INTO subjects (subject_id, code, name, is_practical, active)
         VALUES ('sub_leftover', 'LEFTOVER', 'Leftover Subject', 0, 1)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO rule_parameters (id, rule_version_id, param_key, param_value, value_type)
         VALUES ('rp_leftover', 'rv-2027-1', 'leftover_soft_weight', '99', 'number')`,
      )
      .run();
    expect(
      (await listSubjects(db)).some(
        (s) => (s as { code: string }).code === "LEFTOVER",
      ),
    ).toBe(true);
    expect(
      (await listRuleParameters(db, "rv-2027-1")).some(
        (p) => (p as { param_key: string }).param_key === "leftover_soft_weight",
      ),
    ).toBe(true);

    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(
      (await listSubjects(db)).some(
        (s) => (s as { code: string }).code === "LEFTOVER",
      ),
    ).toBe(false);
    expect((await listSubjects(db)).length).toBe(8);
    expect(
      (await listRuleParameters(db, "rv-2027-1")).some(
        (p) => (p as { param_key: string }).param_key === "leftover_soft_weight",
      ),
    ).toBe(false);
  });

  it("old backups without subjects/rule_parameters keys leave seed rows intact", async () => {
    const { buildCanonicalBackup, listRuleParameters } = await import(
      "./repos.js"
    );
    sqlite
      .prepare(
        `INSERT INTO subjects (subject_id, code, name, is_practical, active)
         VALUES ('sub_keep', 'KEEPME', 'Keep Subject', 0, 1)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO rule_parameters (id, rule_version_id, param_key, param_value, value_type)
         VALUES ('rp_keep', 'rv-2027-1', 'keep_soft_weight', '1', 'number')`,
      )
      .run();
    const live = await buildCanonicalBackup(db);
    const { subjects, rule_parameters, ...oldShape } = live;
    expect(subjects?.length).toBeGreaterThan(0);
    expect(rule_parameters?.length).toBeGreaterThan(0);

    const restored = await transactionalRestore(db, oldShape, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(
      (await listSubjects(db)).some(
        (s) => (s as { code: string }).code === "KEEPME",
      ),
    ).toBe(true);
    expect(
      (await listRuleParameters(db, "rv-2027-1")).some(
        (p) => (p as { param_key: string }).param_key === "keep_soft_weight",
      ),
    ).toBe(true);
  });

  it("canonical restore wipes leftover exam_cycles and rule_versions", async () => {
    const { buildCanonicalBackup, listExamCycles, listRuleVersions } =
      await import("./repos.js");
    const { upsertExamCycle } = await import("./repos.js");
    const snapshot = await buildCanonicalBackup(db);
    expect(Array.isArray(snapshot.exam_cycles)).toBe(true);
    expect(Array.isArray(snapshot.rule_versions)).toBe(true);
    expect(Array.isArray(snapshot.rule_parameters)).toBe(true);

    sqlite
      .prepare(
        `INSERT INTO rule_versions
          (rule_version_id, version_label, description, created_at, created_by, is_active)
         VALUES ('rv_leftover', 'leftover.1', 'post-snapshot version', ?, 'test', 0)`,
      )
      .run(new Date().toISOString());
    await upsertExamCycle(db, {
      examCycleId: "ec_leftover",
      name: "Leftover cycle",
      academicYear: "2028",
      status: "OPEN",
      ruleVersionId: "rv-2027-1",
      createdBy: "test",
    });
    expect(
      (await listExamCycles(db)).some(
        (c) => (c as { exam_cycle_id: string }).exam_cycle_id === "ec_leftover",
      ),
    ).toBe(true);
    expect(
      (await listRuleVersions(db)).some(
        (v) =>
          (v as { rule_version_id: string }).rule_version_id === "rv_leftover",
      ),
    ).toBe(true);

    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(
      (await listExamCycles(db)).some(
        (c) => (c as { exam_cycle_id: string }).exam_cycle_id === "ec_leftover",
      ),
    ).toBe(false);
    expect(
      (await listRuleVersions(db)).some(
        (v) =>
          (v as { rule_version_id: string }).rule_version_id === "rv_leftover",
      ),
    ).toBe(false);
    expect(
      (await listRuleVersions(db)).some(
        (v) =>
          (v as { rule_version_id: string }).rule_version_id === "rv-2027-1",
      ),
    ).toBe(true);
  });

  it("old backups without exam_cycles/rule_versions keys leave live rows intact", async () => {
    const { buildCanonicalBackup, listExamCycles, listRuleVersions } =
      await import("./repos.js");
    const { upsertExamCycle } = await import("./repos.js");
    sqlite
      .prepare(
        `INSERT INTO rule_versions
          (rule_version_id, version_label, description, created_at, created_by, is_active)
         VALUES ('rv_keep', 'keep.1', 'keep version', ?, 'test', 0)`,
      )
      .run(new Date().toISOString());
    await upsertExamCycle(db, {
      examCycleId: "ec_keep",
      name: "Keep cycle",
      academicYear: "2028",
      status: "OPEN",
      ruleVersionId: "rv-2027-1",
      createdBy: "test",
    });
    const live = await buildCanonicalBackup(db);
    const { exam_cycles, rule_versions, rule_parameters, ...oldShape } = live;
    expect(exam_cycles?.length).toBeGreaterThan(0);
    expect(rule_versions?.length).toBeGreaterThan(0);
    expect(rule_parameters?.length).toBeGreaterThan(0);

    const restored = await transactionalRestore(db, oldShape, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(
      (await listExamCycles(db)).some(
        (c) => (c as { exam_cycle_id: string }).exam_cycle_id === "ec_keep",
      ),
    ).toBe(true);
    expect(
      (await listRuleVersions(db)).some(
        (v) => (v as { rule_version_id: string }).rule_version_id === "rv_keep",
      ),
    ).toBe(true);
  });

  it("empty audit_logs key wipes leftover audit rows", async () => {
    const { buildCanonicalBackup } = await import("./repos.js");
    const live = await buildCanonicalBackup(db);
    sqlite
      .prepare(
        `INSERT INTO audit_logs
          (audit_id, user_id, action, entity, entity_id, timestamp)
         VALUES ('aud_leftover', 'test', 'LEFTOVER', 'exam_cycle', 'ec_x', ?)`,
      )
      .run(new Date().toISOString());
    const leftoverBefore = sqlite
      .prepare(`SELECT audit_id FROM audit_logs WHERE audit_id='aud_leftover'`)
      .get();
    expect(leftoverBefore).toBeTruthy();

    const restored = await transactionalRestore(
      db,
      { ...live, audit_logs: [] },
      { adminConfirmed: true, includeHistory: true },
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(
      sqlite
        .prepare(`SELECT audit_id FROM audit_logs WHERE audit_id='aud_leftover'`)
        .get(),
    ).toBeUndefined();
  });

  it("session-shaped audit_logs do not wipe persisted audit", async () => {
    const { buildCanonicalBackup } = await import("./repos.js");
    const live = await buildCanonicalBackup(db);
    sqlite
      .prepare(
        `INSERT INTO audit_logs
          (audit_id, user_id, action, entity, entity_id, timestamp)
         VALUES ('aud_keep_session', 'test', 'KEEP', 'exam_cycle', 'ec_x', ?)`,
      )
      .run(new Date().toISOString());

    const restored = await transactionalRestore(
      db,
      {
        ...live,
        audit_logs: [
          {
            id: "a0",
            action: "LOGIN",
            timestamp: new Date().toISOString(),
            detail: "Synthetic officer session (dev auth)",
          },
        ],
      },
      { adminConfirmed: true, includeHistory: true },
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(
      sqlite
        .prepare(
          `SELECT audit_id FROM audit_logs WHERE audit_id='aud_keep_session'`,
        )
        .get(),
    ).toBeTruthy();
    expect(
      sqlite
        .prepare(`SELECT action FROM audit_logs WHERE action='LOGIN'`)
        .all(),
    ).toHaveLength(0);
  });

  it("persisted-shaped audit_logs still replace leftovers", async () => {
    const { buildCanonicalBackup } = await import("./repos.js");
    const live = await buildCanonicalBackup(db);
    sqlite
      .prepare(
        `INSERT INTO audit_logs
          (audit_id, user_id, action, entity, entity_id, timestamp)
         VALUES ('aud_replaced', 'test', 'LEFTOVER', 'exam_cycle', 'ec_x', ?)`,
      )
      .run(new Date().toISOString());

    const restored = await transactionalRestore(
      db,
      {
        ...live,
        audit_logs: [
          {
            audit_id: "aud_from_backup",
            action: "BACKUP",
            entity: "backup",
            entity_id: "b1",
            timestamp: new Date().toISOString(),
          },
        ],
      },
      { adminConfirmed: true, includeHistory: true },
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(
      sqlite
        .prepare(`SELECT audit_id FROM audit_logs WHERE audit_id='aud_replaced'`)
        .get(),
    ).toBeUndefined();
    expect(
      sqlite
        .prepare(
          `SELECT audit_id FROM audit_logs WHERE audit_id='aud_from_backup'`,
        )
        .get(),
    ).toBeTruthy();
  });
});

describe("allocation decision reasons", () => {
  let db: ReturnType<typeof createSqliteClient>;
  let sqlite: Database.Database;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    db = createSqliteClient(sqlite);
    await applyMigrations(db, join(process.cwd(), ".."));
    await transactionalRestore(
      db,
      {
        schools: [
          {
            schoolId: "s1",
            schoolCode: "S1",
            schoolName: "School",
            blockId: "b1",
            active: true,
          },
        ],
        centres: [
          {
            centreId: "c1",
            centreCode: "C1",
            centreName: "Centre",
            blockId: "b1",
            active: true,
          },
        ],
        teachers: [
          {
            teacherId: "t1",
            employeeCode: "E1",
            name: "Teacher",
            schoolId: "s1",
            designation: "HM",
            isActive: true,
          },
        ],
      },
      { adminConfirmed: true, includeHistory: true },
    );
    await upsertExamCycle(db, {
      examCycleId: "ec1",
      name: "Cycle",
      academicYear: "2027",
      status: "OPEN",
      ruleVersionId: "rv-2027-1",
      createdBy: "test",
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  it("persists decision-trace reasons and validator conflict findings", async () => {
    const { listAllocationDecisionReasons } = await import("./repos.js");
    const persisted = await persistAllocationRun(db, {
      runId: "run_reasons",
      examCycleId: "ec1",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "INVALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [
        {
          resultId: "res_r1",
          teacherId: "t1",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
          decisionTraceJson: JSON.stringify({
            reasons: [
              {
                ruleCode: "RULE-THEORY-DISTANCE",
                severity: "INFO",
                message: "Within preferred band",
              },
            ],
          }),
          usedFallback: false,
        },
      ],
      validationFindings: [
        {
          ruleCode: "RULE-CONFLICT-SESSION",
          severity: "ERROR",
          message: "Teacher has multiple duties in the same date and session",
          teacherId: "t1",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          details: { duties: ["THEORY", "HALL"], source: "conflict-engine" },
        },
      ],
    });
    expect(persisted.reasonCount).toBe(2);
    const reasons = await listAllocationDecisionReasons(db, "run_reasons");
    expect(reasons.length).toBe(2);
    const codes = reasons.map((r) => (r as { rule_code: string }).rule_code);
    expect(codes).toContain("RULE-THEORY-DISTANCE");
    expect(codes).toContain("RULE-CONFLICT-SESSION");
  });

  it("drops generate INFO-* from listed reasons after override", async () => {
    const { listAllocationDecisionReasons, recordManualOverride } =
      await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_ov_info",
      examCycleId: "ec1",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [
        {
          resultId: "res_ov_info",
          teacherId: "t1",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
          decisionTraceJson: JSON.stringify({
            teacherId: "t1",
            selectedBecause: "lowest eligible fairness score",
            reasons: [
              {
                ruleCode: "INFO-DISTANCE",
                severity: "INFO",
                message: "Within 40 km (home=12 school=8)",
              },
              {
                ruleCode: "INFO-FAIRNESS",
                severity: "INFO",
                message: "Fairness components recent=0 historyCount=1",
              },
              {
                ruleCode: "INFO-HM-FALLBACK",
                severity: "WARNING",
                message: "Preferred band shortage; used fallback",
              },
              {
                ruleCode: "INFO-SELECTED",
                severity: "INFO",
                message: "Selected because lowest eligible fairness score",
              },
            ],
          }),
          usedFallback: true,
        },
      ],
    });
    const before = (await listAllocationDecisionReasons(
      db,
      "run_ov_info",
    )) as Array<{ rule_code: string }>;
    expect(before.some((r) => r.rule_code === "INFO-SELECTED")).toBe(true);
    expect(before.some((r) => r.rule_code === "INFO-DISTANCE")).toBe(true);
    expect(before.some((r) => r.rule_code === "INFO-FAIRNESS")).toBe(true);
    expect(before.some((r) => r.rule_code === "INFO-HM-FALLBACK")).toBe(true);

    const ov = await recordManualOverride(db, {
      runId: "run_ov_info",
      requirementKey: "c1-CHIEF",
      centreId: "c1",
      oldTeacherId: "t1",
      newTeacherId: "t2",
      reason: "Coverage",
      changedBy: "officer@test",
    });
    expect(ov.ok).toBe(true);

    const after = (await listAllocationDecisionReasons(
      db,
      "run_ov_info",
    )) as Array<{ rule_code: string; teacher_id: string }>;
    expect(after.some((r) => r.rule_code.startsWith("INFO-"))).toBe(false);
    expect(
      after.some(
        (r) => r.rule_code === "MANUAL_OVERRIDE" && r.teacher_id === "t2",
      ),
    ).toBe(true);

    for (const [id, code] of [
      ["adr_stale_info", "INFO-SELECTED"],
      ["adr_stale_distance", "INFO-DISTANCE"],
      ["adr_stale_fairness", "INFO-FAIRNESS"],
      ["adr_stale_fallback", "INFO-HM-FALLBACK"],
    ] as const) {
      sqlite
        .prepare(
          `INSERT INTO allocation_decision_reasons
            (id, result_id, rule_code, severity, message, details_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, "res_ov_info", code, "INFO", code, null);
    }
    const stale = (await listAllocationDecisionReasons(
      db,
      "run_ov_info",
    )) as Array<{ rule_code: string }>;
    expect(stale.some((r) => r.rule_code.startsWith("INFO-"))).toBe(false);
  });

  it("does not attribute generate RULE-* / conflicts to the override teacher", async () => {
    const { listAllocationDecisionReasons, recordManualOverride } =
      await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_ov_rules",
      examCycleId: "ec1",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "INVALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [
        {
          resultId: "res_ov_rules",
          teacherId: "t1",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
          decisionTraceJson: JSON.stringify({
            teacherId: "t1",
            selectedBecause: "lowest eligible fairness score",
            reasons: [
              {
                ruleCode: "RULE-THEORY-DISTANCE",
                severity: "ERROR",
                message: "Distance exceeds 40 km",
                details: { distanceHomeKm: 55 },
              },
              {
                ruleCode: "UNVERIFIED_HISTORY_USED",
                severity: "WARNING",
                message: "Repeat-centre exclusion used unverified history",
              },
              {
                ruleCode: "INFO-HM-FALLBACK",
                severity: "WARNING",
                message: "Preferred band shortage; used fallback",
              },
            ],
          }),
          usedFallback: true,
        },
      ],
      validationFindings: [
        {
          ruleCode: "RULE-CONFLICT-SESSION",
          severity: "ERROR",
          message: "Teacher has multiple duties in the same date and session",
          teacherId: "t1",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          details: { duties: ["THEORY", "HALL"], source: "conflict-engine" },
        },
        {
          ruleCode: "RULE-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION — other centre",
          details: {
            requirementKey: "c2-CHIEF",
            required: 1,
            eligible: 0,
            shortage: 1,
          },
        },
      ],
    });

    const ov = await recordManualOverride(db, {
      runId: "run_ov_rules",
      requirementKey: "c1-CHIEF",
      centreId: "c1",
      oldTeacherId: "t1",
      newTeacherId: "t2",
      reason: "Coverage",
      changedBy: "officer@test",
    });
    expect(ov.ok).toBe(true);

    const after = (await listAllocationDecisionReasons(
      db,
      "run_ov_rules",
    )) as Array<{ rule_code: string; teacher_id: string }>;
    expect(after.some((r) => r.rule_code === "RULE-THEORY-DISTANCE")).toBe(
      false,
    );
    expect(after.some((r) => r.rule_code === "UNVERIFIED_HISTORY_USED")).toBe(
      false,
    );
    expect(after.some((r) => r.rule_code.startsWith("RULE-CONFLICT-"))).toBe(
      false,
    );
    expect(after.some((r) => r.rule_code.startsWith("INFO-"))).toBe(false);
    expect(
      after.some(
        (r) => r.rule_code === "MANUAL_OVERRIDE" && r.teacher_id === "t2",
      ),
    ).toBe(true);
    expect(
      after.some((r) => r.rule_code === "RULE-SHORTAGE" && r.teacher_id === ""),
    ).toBe(true);
    expect(after.some((r) => r.teacher_id === "t2" && r.rule_code !== "MANUAL_OVERRIDE")).toBe(
      false,
    );

    for (const [id, code] of [
      ["adr_stale_rule_distance", "RULE-THEORY-DISTANCE"],
      ["adr_stale_rule_conflict", "RULE-CONFLICT-SESSION"],
      ["adr_stale_unverified", "UNVERIFIED_HISTORY_USED"],
    ] as const) {
      sqlite
        .prepare(
          `INSERT INTO allocation_decision_reasons
            (id, result_id, rule_code, severity, message, details_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, "res_ov_rules", code, "ERROR", code, null);
    }
    const stale = (await listAllocationDecisionReasons(
      db,
      "run_ov_rules",
    )) as Array<{ rule_code: string; teacher_id: string }>;
    expect(stale.some((r) => r.rule_code === "RULE-THEORY-DISTANCE")).toBe(
      false,
    );
    expect(stale.some((r) => r.rule_code.startsWith("RULE-CONFLICT-"))).toBe(
      false,
    );
    expect(stale.some((r) => r.rule_code === "UNVERIFIED_HISTORY_USED")).toBe(
      false,
    );
    expect(
      stale.some(
        (r) => r.rule_code === "MANUAL_OVERRIDE" && r.teacher_id === "t2",
      ),
    ).toBe(true);
  });

  it("maps generate date/duty through persist and does not duplicate conflicts or pin shortages to results[0]", async () => {
    const { listAllocationDecisionReasons, buildCanonicalBackup } = await import(
      "./repos.js"
    );
    const {
      allocationRunBodySchema,
      parseBody,
      validationFindingsFromRunBody,
      conflictsFromPersistedReasons,
    } = await import("@exam-duty/shared");
    const parsed = parseBody(allocationRunBodySchema, {
      runId: "run_map_fields",
      examCycleId: "ec1",
      module: "THEORY",
      validationIssues: [
        {
          ruleCode: "RULE-THEORY-DISTANCE",
          severity: "ERROR",
          message: "Too far",
          teacherId: "t1",
          centreId: "c1",
          date: "2027-03-16",
          duty: "CHIEF_EXAMINATION",
        },
        {
          ruleCode: "RULE-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION — other centre",
          duty: "c2-CHIEF",
          details: {
            requirementKey: "c2-CHIEF",
            required: 1,
            eligible: 0,
            shortage: 1,
          },
        },
        {
          ruleCode: "RULE-CONFLICT-SESSION",
          severity: "ERROR",
          message: "Teacher has multiple duties in the same date and session",
          teacherId: "t1",
          date: "2027-03-16",
          duty: "THEORY,HALL",
        },
      ],
      conflicts: [
        {
          ruleCode: "RULE-CONFLICT-SESSION",
          severity: "ERROR",
          message: "Teacher has multiple duties in the same date and session",
          teacherId: "t1",
          date: "2027-03-16",
          session: "AFTERNOON",
          duties: ["THEORY", "HALL"],
        },
      ],
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
        {
          teacherId: "t1",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-16",
          sessionCode: "AFTERNOON",
          score: 1,
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    const findings = validationFindingsFromRunBody(parsed.data);
    expect(findings.filter((f) => f.ruleCode.startsWith("RULE-CONFLICT-"))).toHaveLength(1);
    await persistAllocationRun(db, {
      runId: "run_map_fields",
      examCycleId: "ec1",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "INVALID",
      createdBy: "test",
      summaryJson: JSON.stringify({ errors: 3 }),
      results: (parsed.data.results ?? []).map((r, i) => ({
        resultId: `res_map_${i}`,
        teacherId: r.teacherId,
        centreId: r.centreId,
        dutyTypeCode: r.dutyTypeCode,
        roleCode: r.roleCode,
        examDate: r.examDate,
        sessionCode: r.sessionCode,
        score: r.score,
        decisionTraceJson: "{}",
        usedFallback: false,
      })),
      validationFindings: findings,
    });
    const reasons = (await listAllocationDecisionReasons(
      db,
      "run_map_fields",
    )) as Array<{
      rule_code: string;
      teacher_id: string;
      exam_date: string;
      session_code: string;
      details_json: string | null;
    }>;
    const distance = reasons.find((r) => r.rule_code === "RULE-THEORY-DISTANCE");
    expect(distance?.exam_date).toBe("2027-03-16");
    expect(distance?.session_code).toBe("AFTERNOON");
    expect(distance?.teacher_id).toBe("t1");
    const shortage = reasons.find((r) => r.rule_code === "RULE-SHORTAGE");
    expect(shortage).toBeTruthy();
    expect(shortage?.teacher_id).toBe("");
    expect(shortage?.exam_date).toBe("");
    const conflictRows = reasons.filter((r) =>
      r.rule_code.startsWith("RULE-CONFLICT-"),
    );
    expect(conflictRows).toHaveLength(1);
    expect(conflictRows[0]?.exam_date).toBe("2027-03-16");
    expect(conflictRows[0]?.session_code).toBe("AFTERNOON");
    const reconstructed = conflictsFromPersistedReasons(
      conflictRows.map((r) => ({
        rule_code: r.rule_code,
        severity: "ERROR",
        message: "Teacher has multiple duties in the same date and session",
        teacher_id: r.teacher_id,
        exam_date: r.exam_date,
        session_code: r.session_code,
        details_json: r.details_json,
      })),
    );
    expect(reconstructed).toHaveLength(1);

    const snapshot = await buildCanonicalBackup(db);
    sqlite
      .prepare(
        `INSERT INTO allocation_run_results
          (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override)
         VALUES ('res_map_leftover', 'run_map_fields', 't1', 'c1', 'CHIEF_EXAMINATION', 'CHIEF_EXAMINATION', '1999-01-01', 'MORNING', 9, '{}', 1, 0)`,
      )
      .run();
    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);
    const after = (await listAllocationDecisionReasons(
      db,
      "run_map_fields",
    )) as Array<{
      rule_code: string;
      teacher_id: string;
      exam_date: string;
    }>;
    expect(after.find((r) => r.rule_code === "RULE-THEORY-DISTANCE")?.exam_date).toBe(
      "2027-03-16",
    );
    expect(after.filter((r) => r.rule_code.startsWith("RULE-CONFLICT-"))).toHaveLength(
      1,
    );
    expect(after.find((r) => r.rule_code === "RULE-SHORTAGE")?.teacher_id).toBe("");
  });

  it("does not pin hall shortages to filled slots at the same centre", async () => {
    const { listAllocationDecisionReasons } = await import("./repos.js");
    const {
      allocationRunBodySchema,
      parseBody,
      validationFindingsFromRunBody,
    } = await import("@exam-duty/shared");
    const parsed = parseBody(allocationRunBodySchema, {
      runId: "run_hall_shortage_centre",
      examCycleId: "ec1",
      module: "HALL",
      validationIssues: [
        {
          ruleCode: "RULE-HALL-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
          centreId: "c1",
          details: {
            centreId: "c1",
            required: 11,
            eligible: 2,
            shortage: 9,
          },
        },
      ],
      results: [
        {
          teacherId: "t-filled-1",
          centreId: "c1",
          dutyTypeCode: "HALL_INVIGILATOR",
          roleCode: "HALL_INVIGILATOR",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 0,
        },
        {
          teacherId: "t-filled-2",
          centreId: "c1",
          dutyTypeCode: "HALL_INVIGILATOR",
          roleCode: "HALL_INVIGILATOR",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    const findings = validationFindingsFromRunBody(parsed.data);
    await persistAllocationRun(db, {
      runId: "run_hall_shortage_centre",
      examCycleId: "ec1",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "hall-1.0.0",
      module: "HALL",
      validationStatus: "INVALID",
      createdBy: "test",
      summaryJson: JSON.stringify({ errors: 1 }),
      results: (parsed.data.results ?? []).map((r, i) => ({
        resultId: `res_hall_short_${i}`,
        teacherId: r.teacherId,
        centreId: r.centreId,
        dutyTypeCode: r.dutyTypeCode,
        roleCode: r.roleCode,
        examDate: r.examDate,
        sessionCode: r.sessionCode,
        score: r.score,
        decisionTraceJson: "{}",
        usedFallback: false,
      })),
      validationFindings: findings,
    });
    const reasons = (await listAllocationDecisionReasons(
      db,
      "run_hall_shortage_centre",
    )) as Array<{
      rule_code: string;
      teacher_id: string;
      exam_date: string;
      session_code: string;
      details_json: string | null;
    }>;
    const hallRows = reasons.filter((r) => r.rule_code === "RULE-HALL-SHORTAGE");
    expect(hallRows).toHaveLength(1);
    expect(hallRows[0]?.teacher_id).toBe("");
    expect(hallRows[0]?.exam_date).toBe("");
    expect(hallRows[0]?.session_code).toBe("");
    const details = hallRows[0]?.details_json
      ? (JSON.parse(hallRows[0].details_json) as {
          unmatched?: boolean;
          centreId?: string;
        })
      : {};
    expect(details.unmatched).toBe(true);
    expect(details.centreId).toBe("c1");
  });

  it("persists each same-message shortage instead of collapsing centres", async () => {
    const { listAllocationDecisionReasons } = await import("./repos.js");
    const {
      allocationRunBodySchema,
      parseBody,
      validationFindingsFromRunBody,
    } = await import("@exam-duty/shared");
    const parsed = parseBody(allocationRunBodySchema, {
      runId: "run_multi_shortage",
      examCycleId: "ec1",
      module: "HALL",
      validationIssues: [
        {
          ruleCode: "RULE-HALL-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
          centreId: "c1",
          details: {
            centreId: "c1",
            required: 11,
            eligible: 2,
            shortage: 9,
          },
        },
        {
          ruleCode: "RULE-HALL-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
          centreId: "c2",
          details: {
            centreId: "c2",
            required: 8,
            eligible: 1,
            shortage: 7,
          },
        },
        {
          ruleCode: "RULE-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
          details: {
            requirementKey: "c3-CHIEF",
            required: 1,
            eligible: 0,
            shortage: 1,
          },
        },
        {
          ruleCode: "RULE-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION",
          details: {
            requirementKey: "c4-CHIEF",
            required: 1,
            eligible: 0,
            shortage: 1,
          },
        },
      ],
      results: [
        {
          teacherId: "t-filled-1",
          centreId: "c1",
          dutyTypeCode: "HALL_INVIGILATOR",
          roleCode: "HALL_INVIGILATOR",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 0,
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    const findings = validationFindingsFromRunBody(parsed.data);
    expect(findings.filter((f) => f.ruleCode === "RULE-HALL-SHORTAGE")).toHaveLength(
      2,
    );
    expect(findings.filter((f) => f.ruleCode === "RULE-SHORTAGE")).toHaveLength(2);
    await persistAllocationRun(db, {
      runId: "run_multi_shortage",
      examCycleId: "ec1",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "hall-1.0.0",
      module: "HALL",
      validationStatus: "INVALID",
      createdBy: "test",
      summaryJson: JSON.stringify({ errors: 4 }),
      results: (parsed.data.results ?? []).map((r, i) => ({
        resultId: `res_multi_short_${i}`,
        teacherId: r.teacherId,
        centreId: r.centreId,
        dutyTypeCode: r.dutyTypeCode,
        roleCode: r.roleCode,
        examDate: r.examDate,
        sessionCode: r.sessionCode,
        score: r.score,
        decisionTraceJson: "{}",
        usedFallback: false,
      })),
      validationFindings: findings,
    });
    const reasons = (await listAllocationDecisionReasons(
      db,
      "run_multi_shortage",
    )) as Array<{
      rule_code: string;
      teacher_id: string;
      exam_date: string;
      details_json: string | null;
    }>;
    const hallRows = reasons.filter((r) => r.rule_code === "RULE-HALL-SHORTAGE");
    const theoryRows = reasons.filter((r) => r.rule_code === "RULE-SHORTAGE");
    expect(hallRows).toHaveLength(2);
    expect(theoryRows).toHaveLength(2);
    for (const row of [...hallRows, ...theoryRows]) {
      expect(row.teacher_id).toBe("");
      expect(row.exam_date).toBe("");
    }
    const hallCentres = hallRows
      .map((r) =>
        r.details_json
          ? (JSON.parse(r.details_json) as { centreId?: string }).centreId
          : undefined,
      )
      .sort();
    expect(hallCentres).toEqual(["c1", "c2"]);
    const theoryKeys = theoryRows
      .map((r) =>
        r.details_json
          ? (JSON.parse(r.details_json) as { requirementKey?: string })
              .requirementKey
          : undefined,
      )
      .sort();
    expect(theoryKeys).toEqual(["c3-CHIEF", "c4-CHIEF"]);
  });

  it("folds empty-results findings into summary.issues and hydrates after same-DB restore", async () => {
    const { listAllocationRuns, listAllocationDecisionReasons, buildCanonicalBackup } =
      await import("./repos.js");
    const {
      allocationRunBodySchema,
      parseBody,
      validationFindingsFromRunBody,
      issuesFromPersisted,
    } = await import("@exam-duty/shared");
    const parsed = parseBody(allocationRunBodySchema, {
      runId: "run_empty_results_issues",
      examCycleId: "ec1",
      module: "PRACTICAL",
      validationIssues: [
        {
          ruleCode: "RULE-PRACTICAL-INFEASIBLE",
          severity: "ERROR",
          message: "NO VALID SCHEDULE — no available dates",
        },
      ],
      results: [],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    const findings = validationFindingsFromRunBody(parsed.data);
    const persisted = await persistAllocationRun(db, {
      runId: "run_empty_results_issues",
      examCycleId: "ec1",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "practical-1.0.0",
      module: "PRACTICAL",
      validationStatus: "INVALID",
      createdBy: "test",
      summaryJson: JSON.stringify({
        schedules: 0,
        feasible: false,
        errors: 1,
      }),
      results: [],
      validationFindings: findings,
    });
    expect(persisted.reasonCount).toBe(0);
    const reasons = await listAllocationDecisionReasons(
      db,
      "run_empty_results_issues",
    );
    expect(reasons).toHaveLength(0);
    const runs = (await listAllocationRuns(db, "ec1")) as Array<{
      run_id: string;
      summary_json: string | null;
    }>;
    const summaryJson = runs.find((r) => r.run_id === "run_empty_results_issues")
      ?.summary_json;
    const hydrated = issuesFromPersisted(summaryJson, reasons);
    expect(hydrated).toEqual([
      {
        ruleCode: "RULE-PRACTICAL-INFEASIBLE",
        severity: "ERROR",
        message: "NO VALID SCHEDULE — no available dates",
      },
    ]);
    expect(issuesFromPersisted(JSON.stringify({ errors: 1 }))).toEqual([]);

    const snapshot = await buildCanonicalBackup(db);
    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);
    const afterRuns = (await listAllocationRuns(db, "ec1")) as Array<{
      run_id: string;
      summary_json: string | null;
    }>;
    const afterReasons = await listAllocationDecisionReasons(
      db,
      "run_empty_results_issues",
    );
    expect(
      issuesFromPersisted(
        afterRuns.find((r) => r.run_id === "run_empty_results_issues")
          ?.summary_json,
        afterReasons,
      ),
    ).toEqual(hydrated);
  });

  it("listAllocationRuns keeps latest hall/practical after a 100-run theory burst", async () => {
    const { listAllocationRuns } = await import("./repos.js");
    const insert = sqlite.prepare(
      `INSERT INTO allocation_runs
        (run_id, exam_cycle_id, rule_version_id, algorithm_version, module, created_by, created_at, status)
       VALUES (?, 'ec1', 'rv-2027-1', 'test', ?, 'test', ?, 'GENERATED')`,
    );
    insert.run("run_hall_old", "HALL", "2027-01-01T00:00:00.000Z");
    insert.run("run_prac_old", "PRACTICAL", "2027-01-02T00:00:00.000Z");
    for (let i = 0; i < 100; i++) {
      insert.run(
        `run_theory_${i}`,
        "THEORY",
        `2027-06-01T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
      );
    }
    const recencyWindow = sqlite
      .prepare(
        `SELECT run_id FROM allocation_runs WHERE exam_cycle_id = ?
         ORDER BY created_at DESC LIMIT 100`,
      )
      .all("ec1") as Array<{ run_id: string }>;
    expect(recencyWindow).toHaveLength(100);
    expect(recencyWindow.some((r) => r.run_id === "run_hall_old")).toBe(false);
    expect(recencyWindow.some((r) => r.run_id === "run_prac_old")).toBe(false);

    const listed = (await listAllocationRuns(db, "ec1")) as Array<{
      run_id: string;
      module: string;
    }>;
    expect(listed.some((r) => r.run_id === "run_hall_old")).toBe(true);
    expect(listed.some((r) => r.run_id === "run_prac_old")).toBe(true);
    expect(listed.filter((r) => r.module === "THEORY")).toHaveLength(100);
    expect(listed).toHaveLength(102);
    expect(listed[0]?.run_id).toBe("run_theory_99");
  });
});

describe("clubbing, capacity, practical batches", () => {
  let db: ReturnType<typeof createSqliteClient>;
  let sqlite: Database.Database;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    db = createSqliteClient(sqlite);
    await applyMigrations(db, join(process.cwd(), ".."));
    await transactionalRestore(
      db,
      {
        schools: [
          {
            schoolId: "s1",
            schoolCode: "S1",
            schoolName: "School One",
            blockId: "b1",
            active: true,
          },
          {
            schoolId: "s2",
            schoolCode: "S2",
            schoolName: "School Two",
            blockId: "b1",
            active: true,
          },
        ],
        centres: [
          {
            centreId: "c1",
            centreCode: "C1",
            centreName: "Centre One",
            blockId: "b1",
            capacity: 100,
            active: true,
          },
        ],
        teachers: [
          {
            teacherId: "t_int",
            employeeCode: "INT1",
            name: "Internal",
            schoolId: "s1",
            designation: "PG",
            isActive: true,
          },
          {
            teacherId: "t_ext",
            employeeCode: "EXT1",
            name: "External",
            schoolId: "s2",
            designation: "PG",
            isActive: true,
          },
        ],
        centre_school_relationships: [
          {
            id: "rel-host",
            centreId: "c1",
            schoolId: "s1",
            relationshipType: "HOST",
            effectiveFrom: "2020-01-01",
          },
          {
            id: "rel-club-old",
            centreId: "c1",
            schoolId: "s2",
            relationshipType: "CLUBBED",
            effectiveFrom: "2020-01-01",
          },
        ],
      },
      { adminConfirmed: true, includeHistory: true },
    );
    await upsertExamCycle(db, {
      examCycleId: "ec_prac",
      name: "Practical cycle",
      academicYear: "2027",
      status: "OPEN",
      ruleVersionId: "rv-2027-1",
      createdBy: "test",
    });
  });

  it("closes prior CLUBBED rows and inserts new links without deleting HOST", async () => {
    const result = await replaceClubbingRelationships(db, {
      asOfDate: "2027-03-01",
      relationships: [
        {
          centreId: "c1",
          schoolId: "s2",
          relationshipType: "CLUBBED",
          effectiveFrom: "2027-03-01",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inserted).toBe(1);
    expect(result.closed).toBeGreaterThanOrEqual(1);
    const host = sqlite
      .prepare(
        `SELECT relationship_type, effective_to FROM centre_school_relationships WHERE id='rel-host'`,
      )
      .get() as { relationship_type: string; effective_to: string | null };
    expect(host.relationship_type).toBe("HOST");
    expect(host.effective_to).toBeNull();
    const openClubbed = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM centre_school_relationships
         WHERE school_id='s2' AND relationship_type='CLUBBED' AND effective_to IS NULL`,
      )
      .get() as { n: number };
    expect(openClubbed.n).toBe(1);
  });

  it("updates centre capacities", async () => {
    const n = await updateCentreCapacities(db, [
      { centreId: "c1", capacity: 194 },
    ]);
    expect(n).toBe(1);
    const row = sqlite
      .prepare(`SELECT capacity FROM centres WHERE centre_id='c1'`)
      .get() as { capacity: number };
    expect(row.capacity).toBe(194);
  });

  it("persists practical batches and schedules for an exam cycle", async () => {
    await persistAllocationRun(db, {
      runId: "run_prac_1",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "practical-1.0.0",
      module: "PRACTICAL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [],
    });
    const result = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_prac_1",
      batches: [
        {
          batchId: "batch_s1_phy_0",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 20,
          batchIndex: 0,
          examDate: "2027-03-10",
          sessionCode: "MORNING",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.batches).toBe(1);
    expect(result.schedules).toBe(1);
    const batch = sqlite
      .prepare(
        `SELECT subject_id, student_count FROM practical_batches WHERE batch_id='batch_s1_phy_0'`,
      )
      .get() as { subject_id: string; student_count: number };
    expect(batch.subject_id).toBe("sub-phy");
    expect(batch.student_count).toBe(20);
  });

  it("persists the same batch keys under a second exam cycle", async () => {
    const { listPracticalBatches } = await import("./repos.js");
    const batches = [
      {
        batchId: "batch_s1_phy_0",
        schoolId: "s1",
        subjectCode: "PHYSICS",
        studentCount: 20,
        batchIndex: 0,
        examDate: "2027-03-10",
        sessionCode: "MORNING",
        internalExaminerId: "t_int",
        externalExaminerId: "t_ext",
      },
    ];

    for (const [cycleId, runId] of [
      ["ec_prac", "run_cycle_a"],
      ["ec_prac_next", "run_cycle_b"],
    ]) {
      if (cycleId !== "ec_prac") {
        await upsertExamCycle(db, {
          examCycleId: cycleId!,
          name: "Next practical cycle",
          academicYear: "2028",
          status: "OPEN",
          ruleVersionId: "rv-2027-1",
          createdBy: "test",
        });
      }
      await persistAllocationRun(db, {
        runId: runId!,
        examCycleId: cycleId!,
        ruleVersionId: "rv-2027-1",
        algorithmVersion: "practical-1.0.0",
        module: "PRACTICAL",
        validationStatus: "VALID",
        createdBy: "test",
        summaryJson: "{}",
        results: [],
      });
      const result = await persistPracticalBatches(db, {
        examCycleId: cycleId!,
        runId: runId!,
        batches,
      });
      expect(result).toMatchObject({ ok: true, batches: 1, schedules: 1 });
    }

    // Each cycle keeps its own batch row and schedule for the shared key.
    const first = await listPracticalBatches(db, "ec_prac");
    const second = await listPracticalBatches(db, "ec_prac_next");
    expect(first.batches).toHaveLength(1);
    expect(first.schedules).toHaveLength(1);
    expect(second.batches).toHaveLength(1);
    expect(second.schedules).toHaveLength(1);

    // Re-persisting one cycle must not disturb the other.
    await persistPracticalBatches(db, {
      examCycleId: "ec_prac_next",
      runId: "run_cycle_b",
      batches,
    });
    expect((await listPracticalBatches(db, "ec_prac")).schedules).toHaveLength(
      1,
    );
    expect(
      (await listPracticalBatches(db, "ec_prac_next")).schedules,
    ).toHaveLength(1);
  });

  it("rejects an unknown run id instead of half-writing a cycle", async () => {
    const { listExaminerPairs, listPracticalBatches } =
      await import("./repos.js");
    const result = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_never_persisted",
      batches: [
        {
          batchId: "batch_orphan",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 20,
          batchIndex: 0,
          examDate: "2027-03-10",
          sessionCode: "MORNING",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Unknown allocation run/);
    const after = await listPracticalBatches(db, "ec_prac");
    expect(after.batches.length).toBe(0);
    expect((await listExaminerPairs(db)).length).toBe(0);
  });

  it("writes batches, schedules and pairs atomically", async () => {
    const { listExaminerPairs, listPracticalBatches } =
      await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_atomic",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "practical-1.0.0",
      module: "PRACTICAL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [],
    });
    const ok = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_atomic",
      batches: [
        {
          batchId: "batch_atomic_ok",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 20,
          batchIndex: 0,
          examDate: "2027-03-10",
          sessionCode: "MORNING",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    expect(ok.ok).toBe(true);

    // Second batch references a teacher that does not exist: the whole write
    // must roll back rather than leave the cycle with a partial schedule.
    const failed = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_atomic",
      batches: [
        {
          batchId: "batch_atomic_1",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 20,
          batchIndex: 0,
          examDate: "2027-03-11",
          sessionCode: "MORNING",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
        {
          batchId: "batch_atomic_2",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 20,
          batchIndex: 1,
          examDate: "2027-03-11",
          sessionCode: "AFTERNOON",
          internalExaminerId: "t_int",
          externalExaminerId: "t_missing",
        },
      ],
    });
    expect(failed.ok).toBe(false);
    const after = await listPracticalBatches(db, "ec_prac");
    expect(
      after.batches.map((b) => (b as { batch_id: string }).batch_id),
    ).toEqual(["batch_atomic_ok"]);
    expect((await listExaminerPairs(db)).length).toBe(1);
  });

  it("records examiner pair memory with the cycle academic year", async () => {
    const { listExaminerPairs } = await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_pair_1",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "practical-1.0.0",
      module: "PRACTICAL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [],
    });
    const result = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_pair_1",
      batches: [
        {
          batchId: "batch_pair_1",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 20,
          batchIndex: 0,
          examDate: "2027-03-10",
          sessionCode: "MORNING",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pairs).toBe(1);

    const pairs = (await listExaminerPairs(db)) as Array<{
      teacher_a_id: string;
      teacher_b_id: string;
      subject_id: string;
      subject_code: string | null;
      school_id: string;
      academic_year: string;
      internal_teacher_id: string;
      external_teacher_id: string;
      exam_cycle_id: string | null;
    }>;
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.academic_year).toBe("2027");
    expect(pairs[0]!.subject_id).toBe("sub-phy");
    expect(pairs[0]!.subject_code).toBe("PHY");
    expect(pairs[0]!.school_id).toBe("s1");
    expect(pairs[0]!.internal_teacher_id).toBe("t_int");
    expect(pairs[0]!.external_teacher_id).toBe("t_ext");
    // Teacher pair is stored order-independently so a swapped re-run matches.
    expect([pairs[0]!.teacher_a_id, pairs[0]!.teacher_b_id]).toEqual([
      "t_ext",
      "t_int",
    ]);
  });

  it("updates rather than duplicates pair memory when a cycle is re-run", async () => {
    const { listExaminerPairs } = await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_pair_rerun",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "practical-1.0.0",
      module: "PRACTICAL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [],
    });
    const batch = (internalId: string, externalId: string) => ({
      examCycleId: "ec_prac",
      runId: "run_pair_rerun",
      batches: [
        {
          batchId: "batch_pair_rerun",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 20,
          batchIndex: 0,
          examDate: "2027-03-10",
          sessionCode: "MORNING" as const,
          internalExaminerId: internalId,
          externalExaminerId: externalId,
        },
      ],
    });
    await persistPracticalBatches(db, batch("t_int", "t_ext"));
    const rerun = await persistPracticalBatches(db, batch("t_ext", "t_int"));
    expect(rerun.ok).toBe(true);

    const pairs = (await listExaminerPairs(db)) as Array<{
      internal_teacher_id: string;
      external_teacher_id: string;
    }>;
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.internal_teacher_id).toBe("t_ext");
    expect(pairs[0]!.external_teacher_id).toBe("t_int");
  });

  it("keeps pair memory from earlier cycles when a later cycle is persisted", async () => {
    const { listExaminerPairs } = await import("./repos.js");
    await upsertExamCycle(db, {
      examCycleId: "ec_prac_2028",
      name: "Practical cycle 2028",
      academicYear: "2028",
      status: "OPEN",
      ruleVersionId: "rv-2027-1",
      createdBy: "test",
    });
    const batch = (examCycleId: string, batchId: string) => ({
      examCycleId,
      batches: [
        {
          batchId,
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 20,
          batchIndex: 0,
          examDate: "2027-03-10",
          sessionCode: "MORNING" as const,
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    await persistPracticalBatches(db, batch("ec_prac", "batch_prior_year"));
    await persistPracticalBatches(db, batch("ec_prac_2028", "batch_next_year"));

    const pairs = (await listExaminerPairs(db)) as Array<{
      academic_year: string;
    }>;
    expect(pairs.map((p) => p.academic_year)).toEqual(["2028", "2027"]);
  });

  it("orders two cycles of one academic year by which cycle came last", async () => {
    const { listExaminerPairs } = await import("./repos.js");
    await upsertExamCycle(db, {
      examCycleId: "ec_prac_amd",
      name: "Practical cycle 2027 (amendment)",
      academicYear: "2027",
      status: "OPEN",
      ruleVersionId: "rv-2027-1",
      createdBy: "test",
      amendedFromId: "ec_prac",
      amendmentReason: "correction",
    });
    // An amendment shares the academic year of the cycle it corrects, so only
    // the cycle's creation time can order the two pairings.
    sqlite
      .prepare(`UPDATE exam_cycles SET created_at = ? WHERE exam_cycle_id = ?`)
      .run("2027-01-05T00:00:00.000Z", "ec_prac");
    sqlite
      .prepare(`UPDATE exam_cycles SET created_at = ? WHERE exam_cycle_id = ?`)
      .run("2027-02-05T00:00:00.000Z", "ec_prac_amd");

    const batch = (
      examCycleId: string,
      batchId: string,
      internalId: string,
      externalId: string,
    ) => ({
      examCycleId,
      batches: [
        {
          batchId,
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 20,
          batchIndex: 0,
          examDate: "2027-03-10",
          sessionCode: "MORNING" as const,
          internalExaminerId: internalId,
          externalExaminerId: externalId,
        },
      ],
    });
    await persistPracticalBatches(
      db,
      batch("ec_prac", "batch_shared_key", "t_int", "t_ext"),
    );
    await persistPracticalBatches(
      db,
      batch("ec_prac_amd", "batch_shared_key", "t_ext", "t_int"),
    );

    const pairs = (await listExaminerPairs(db)) as Array<{
      exam_cycle_id: string | null;
      recorded_at: string | null;
      internal_teacher_id: string;
    }>;
    expect(pairs.map((p) => p.exam_cycle_id)).toEqual([
      "ec_prac_amd",
      "ec_prac",
    ]);
    expect(pairs.map((p) => p.recorded_at)).toEqual([
      "2027-02-05T00:00:00.000Z",
      "2027-01-05T00:00:00.000Z",
    ]);
    // The newest pairing is the one the next cycle must switch away from.
    expect(pairs[0]!.internal_teacher_id).toBe("t_ext");
  });

  it("publishes practical external examiner from schedules, not only internal results", async () => {
    const { publishRunToHistory, listDutyHistory } = await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_prac_ext_pub",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "practical-1.0.0",
      module: "PRACTICAL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [
        {
          resultId: "res_prac_int_only",
          teacherId: "t_int",
          centreId: "s1",
          dutyTypeCode: "PRACTICAL_INTERNAL",
          roleCode: "PRACTICAL_INTERNAL",
          examDate: "2027-03-20",
          sessionCode: "MORNING",
          score: 0,
          decisionTraceJson: JSON.stringify({
            batchKey: "s1|PHYSICS|0",
            schoolId: "s1",
            subjectId: "PHYSICS",
            externalExaminerId: "t_ext",
          }),
          usedFallback: false,
        },
      ],
    });
    const batches = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_prac_ext_pub",
      academicYear: "2027",
      batches: [
        {
          batchId: "s1|PHYSICS|0",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 30,
          batchIndex: 0,
          examDate: "2027-03-20",
          sessionCode: "MORNING",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    expect(batches.ok).toBe(true);
    const pub = await publishRunToHistory(
      db,
      "run_prac_ext_pub",
      "ec_prac",
      "2027",
    );
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;
    expect(pub.published).toBe(2);
    const hist = (await listDutyHistory(db)) as Array<{
      run_id?: string | null;
      teacher_id: string;
      duty_type_code: string;
    }>;
    const forRun = hist.filter((h) => h.run_id === "run_prac_ext_pub");
    expect(forRun).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          teacher_id: "t_int",
          duty_type_code: "PRACTICAL_INTERNAL",
        }),
        expect.objectContaining({
          teacher_id: "t_ext",
          duty_type_code: "PRACTICAL_EXTERNAL",
        }),
      ]),
    );
    expect(forRun).toHaveLength(2);
  });

  it("does not fold practical schedules when publishing a theory run", async () => {
    const { publishRunToHistory, listDutyHistory } = await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_theory_with_prac_sched",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [
        {
          resultId: "res_theory_only",
          teacherId: "t_int",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
          decisionTraceJson: "{}",
          usedFallback: false,
        },
      ],
    });
    const batches = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_theory_with_prac_sched",
      academicYear: "2027",
      batches: [
        {
          batchId: "s1|PHYSICS|e2e",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 24,
          batchIndex: 0,
          examDate: "2027-03-20",
          sessionCode: "MORNING",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    expect(batches.ok).toBe(true);
    const pub = await publishRunToHistory(
      db,
      "run_theory_with_prac_sched",
      "ec_prac",
      "2027",
    );
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;
    expect(pub.published).toBe(1);
    const hist = (await listDutyHistory(db)) as Array<{
      run_id?: string | null;
      duty_type_code: string;
    }>;
    const forRun = hist.filter((h) => h.run_id === "run_theory_with_prac_sched");
    expect(forRun).toHaveLength(1);
    expect(forRun[0]?.duty_type_code).toBe("CHIEF_EXAMINATION");
  });

  it("publishes hall invigilator and standby result rows into duty history", async () => {
    const { publishRunToHistory, listDutyHistory } = await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_hall_standby_pub",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "hall-1.0.0",
      module: "HALL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [
        {
          resultId: "res_hall_inv_pub",
          teacherId: "t_int",
          centreId: "c1",
          dutyTypeCode: "HALL_INVIGILATOR",
          roleCode: "HALL_INVIGILATOR",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 0,
          decisionTraceJson: JSON.stringify({ slotIndex: 1 }),
          usedFallback: false,
        },
        {
          resultId: "res_hall_stb_pub",
          teacherId: "t_ext",
          centreId: "c1",
          dutyTypeCode: "HALL_STANDBY",
          roleCode: "HALL_STANDBY",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
          decisionTraceJson: JSON.stringify({ slotIndex: 1 }),
          usedFallback: false,
        },
      ],
    });
    const pub = await publishRunToHistory(
      db,
      "run_hall_standby_pub",
      "ec_prac",
      "2027",
    );
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;
    expect(pub.published).toBe(2);
    const hist = (await listDutyHistory(db)) as Array<{
      run_id?: string | null;
      teacher_id: string;
      duty_type_code: string;
    }>;
    const forRun = hist.filter((h) => h.run_id === "run_hall_standby_pub");
    expect(forRun).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          teacher_id: "t_int",
          duty_type_code: "HALL_INVIGILATOR",
        }),
        expect.objectContaining({
          teacher_id: "t_ext",
          duty_type_code: "HALL_STANDBY",
        }),
      ]),
    );
    expect(forRun).toHaveLength(2);
  });

  it("upserts exemptions and lists duty history / allocation runs", async () => {
    const {
      upsertExemption,
      listExemptions,
      listDutyHistory,
      listAllocationRuns,
      insertTeacherSchoolHistory,
      listTeacherSchoolHistory,
      insertExportRecord,
    } = await import("./repos.js");
    const ex = await upsertExemption(db, {
      teacherId: "t_int",
      reason: "Medical leave",
      effectiveFrom: "2027-01-01",
      createdBy: "test",
    });
    expect(ex.ok).toBe(true);
    const listed = await listExemptions(db);
    expect(
      listed.some((r) => (r as { teacher_id: string }).teacher_id === "t_int"),
    ).toBe(true);

    const again = await upsertExemption(db, {
      teacherId: "t_int",
      reason: "Updated medical leave",
      effectiveFrom: "2027-01-01",
      createdBy: "test",
    });
    expect(again.ok).toBe(true);
    if (!ex.ok || !again.ok) return;
    expect(again.id).toBe(ex.id);
    const afterResave = (await listExemptions(db)).filter(
      (r) => (r as { teacher_id: string }).teacher_id === "t_int",
    );
    expect(afterResave).toHaveLength(1);
    expect((afterResave[0] as { reason: string }).reason).toBe(
      "Updated medical leave",
    );

    const ended = await upsertExemption(db, {
      teacherId: "t_int",
      reason: "Ended by officer",
      effectiveFrom: "2027-01-01",
      effectiveTo: "2027-06-01",
      isExempted: false,
      createdBy: "test",
    });
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.id).toBe(ex.id);
    const afterEnd = (await listExemptions(db)).filter(
      (r) => (r as { teacher_id: string }).teacher_id === "t_int",
    );
    expect(afterEnd).toHaveLength(1);
    expect((afterEnd[0] as { is_exempted: number }).is_exempted).toBe(0);
    expect((afterEnd[0] as { effective_to: string | null }).effective_to).toBe(
      "2027-06-01",
    );
    await insertTeacherSchoolHistory(db, [
      {
        id: "tsh1",
        teacherId: "t_int",
        schoolId: "s2",
        effectiveFrom: "2020-01-01",
        effectiveTo: "2026-12-31",
        sourceImportId: "imp1",
      },
    ]);
    const schoolHist = await listTeacherSchoolHistory(db);
    expect(schoolHist.some((r) => (r as { id: string }).id === "tsh1")).toBe(
      true,
    );
    await persistAllocationRun(db, {
      runId: "run_list_1",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [
        {
          resultId: "res1",
          teacherId: "t_int",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
          decisionTraceJson: "{}",
          usedFallback: false,
        },
      ],
    });
    const { publishRunToHistory } = await import("./repos.js");
    const pub = await publishRunToHistory(db, "run_list_1", "ec_prac", "2027");
    expect(pub.ok).toBe(true);
    if (pub.ok) expect(pub.published).toBeGreaterThan(0);
    const hist = await listDutyHistory(db);
    expect(hist.length).toBeGreaterThanOrEqual(1);
    const runs = await listAllocationRuns(db, "ec_prac");
    expect(
      runs.some((r) => (r as { run_id: string }).run_id === "run_list_1"),
    ).toBe(true);
    await insertExportRecord(db, {
      exportId: "exp1",
      createdBy: "test",
      exportType: "teacher-wise-xlsx",
      examCycleId: "ec_prac",
      runId: "run_list_1",
    });
    const exp = sqlite
      .prepare(`SELECT export_type FROM export_records WHERE export_id='exp1'`)
      .get() as { export_type: string };
    expect(exp.export_type).toBe("teacher-wise-xlsx");

    const { listExportRecords } = await import("./repos.js");
    const exportRows = await listExportRecords(db);
    expect(
      exportRows.some((r) => (r as { export_id: string }).export_id === "exp1"),
    ).toBe(true);
  });

  it("closes leftover open exemption siblings so generate cannot keep an ended teacher excluded", async () => {
    const { upsertExemption, listExemptions } = await import("./repos.js");
    const first = await upsertExemption(db, {
      teacherId: "t_ext",
      reason: "Open row",
      effectiveFrom: "2027-01-01",
      createdBy: "test",
    });
    expect(first.ok).toBe(true);
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO teacher_exemptions
          (id, teacher_id, is_exempted, reason, effective_from, effective_to, source, created_at, created_by)
         VALUES (?, ?, 1, ?, ?, NULL, 'manual', ?, ?)`,
      )
      .run(
        "ex_leftover_open",
        "t_ext",
        "Leftover active",
        "2026-01-01",
        now,
        "test",
      );
    const saved = await upsertExemption(db, {
      teacherId: "t_ext",
      reason: "Single open",
      effectiveFrom: "2027-02-01",
      createdBy: "test",
    });
    expect(saved.ok).toBe(true);
    const listed = (await listExemptions(db)).filter(
      (r) => (r as { teacher_id: string }).teacher_id === "t_ext",
    ) as Array<{
      id: string;
      is_exempted: number;
      effective_to: string | null;
      reason: string;
    }>;
    const stillOpen = listed.filter(
      (r) => r.is_exempted === 1 && !r.effective_to,
    );
    expect(stillOpen).toHaveLength(1);
    expect(stillOpen[0]?.reason).toBe("Single open");
    expect(
      listed.some(
        (r) => r.id === "ex_leftover_open" && r.is_exempted === 0,
      ),
    ).toBe(true);
  });

  it("lists manual overrides joined to run and result context", async () => {
    const { recordManualOverride, listManualOverrides } =
      await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_ov_list",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [
        {
          resultId: "res_ov_list",
          teacherId: "t_int",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
          decisionTraceJson: "{}",
          usedFallback: false,
        },
      ],
    });
    const ov = await recordManualOverride(db, {
      runId: "run_ov_list",
      requirementKey: "c1-CHIEF_EXAMINATION",
      centreId: "c1",
      oldTeacherId: "t_int",
      newTeacherId: "t_ext",
      reason: "Officer on medical leave",
      changedBy: "officer@test",
    });
    expect(ov.ok).toBe(true);

    const rows = await listManualOverrides(db);
    const row = rows.find(
      (r) => (r as { run_id: string }).run_id === "run_ov_list",
    ) as
      | {
          reason: string;
          new_value: string;
          module: string;
          centre_id: string;
          changed_by: string;
        }
      | undefined;
    expect(row).toBeTruthy();
    expect(row?.reason).toBe("Officer on medical leave");
    expect(JSON.parse(row!.new_value)).toMatchObject({ teacherId: "t_ext" });
    expect(row?.module).toBe("THEORY");
    expect(row?.centre_id).toBe("c1");
    expect(row?.changed_by).toBe("officer@test");

    const listed = (await (
      await import("./repos.js")
    ).listAllocationRunResults(db, "run_ov_list")) as Array<{
      decision_trace_json: string | null;
      final_teacher_id: string | null;
    }>;
    const trace = JSON.parse(listed[0]?.decision_trace_json ?? "{}") as {
      teacherId?: string;
      selectedBecause?: string;
      reasons?: Array<{ ruleCode: string }>;
    };
    expect(listed[0]?.final_teacher_id).toBe("t_ext");
    expect(trace.teacherId).toBe("t_ext");
    expect(trace.selectedBecause).toBe("manual override");
    expect(trace.reasons?.some((r) => r.ruleCode === "MANUAL_OVERRIDE")).toBe(
      true,
    );
  });

  it("records source_imports provenance with SHA-256 hash", async () => {
    const { insertSourceImport, updateSourceImportStatus, listSourceImports } =
      await import("./repos.js");
    const { sha256Hex } = await import("@exam-duty/shared");
    const bytes = new TextEncoder().encode("synthetic-import-bytes");
    const fileHash = await sha256Hex(bytes);
    await insertSourceImport(db, {
      importId: "imp_prov_1",
      filename: "teachers.xlsx",
      fileHash,
      uploadedBy: "test",
      status: "UPLOADED",
      r2Key: "imports/imp_prov_1/teachers.xlsx",
      rowCount: 3,
    });
    await updateSourceImportStatus(db, "imp_prov_1", "APPLIED", {
      rowCount: 3,
      summaryJson: JSON.stringify({ upserted: 3 }),
    });
    const listed = await listSourceImports(db);
    const row = listed.find(
      (r) => (r as { import_id: string }).import_id === "imp_prov_1",
    ) as { status: string; file_hash: string };
    expect(row.status).toBe("APPLIED");
    expect(row.file_hash).toBe(fileHash);
  });

  it("stores per-row import outcomes and replaces them on re-apply", async () => {
    const { insertSourceImport, insertSourceImportRows, listSourceImportRows } =
      await import("./repos.js");
    await insertSourceImport(db, {
      importId: "imp_rows_1",
      filename: "teachers.xlsx",
      fileHash: "hash",
      uploadedBy: "test",
      status: "UPLOADED",
    });
    await insertSourceImport(db, {
      importId: "imp_rows_2",
      filename: "other.xlsx",
      fileHash: "hash2",
      uploadedBy: "test",
      status: "UPLOADED",
    });
    await insertSourceImportRows(db, "imp_rows_2", [
      { rowNumber: 1, status: "NEW", entityKey: "OTHER1" },
    ]);

    const first = await insertSourceImportRows(db, "imp_rows_1", [
      { rowNumber: 1, status: "NEW", entityKey: "E1" },
      {
        rowNumber: 2,
        status: "INVALID",
        entityKey: "E2",
        message: "Missing school code",
      },
      { rowNumber: -1, status: "MISSING", entityKey: "E9" },
    ]);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.inserted).toBe(3);

    const rows = (await listSourceImportRows(db, "imp_rows_1")) as Array<{
      row_number: number;
      status: string;
      entity_type: string;
      entity_key: string | null;
      message: string | null;
    }>;
    expect(rows.map((r) => r.status)).toEqual(["MISSING", "NEW", "INVALID"]);
    expect(rows.every((r) => r.entity_type === "teacher")).toBe(true);
    expect(rows.find((r) => r.status === "INVALID")?.message).toBe(
      "Missing school code",
    );

    // Re-applying the same import replaces its own rows only.
    await insertSourceImportRows(db, "imp_rows_1", [
      { rowNumber: 1, status: "UPDATED", entityKey: "E1" },
    ]);
    expect((await listSourceImportRows(db, "imp_rows_1")).length).toBe(1);
    expect((await listSourceImportRows(db, "imp_rows_2")).length).toBe(1);
  });

  it("publishes overridden final_teacher_id and is idempotent", async () => {
    const {
      persistAllocationRun: persist,
      recordManualOverride,
      publishRunToHistory,
      listDutyHistory,
    } = await import("./repos.js");
    await persist(db, {
      runId: "run_override_pub",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      snapshotJson: JSON.stringify({
        examCycleId: "ec_prac",
        ruleVersionId: "rv-2027-1",
        teacherCount: 2,
      }),
      results: [
        {
          resultId: "res_ov1",
          teacherId: "t_int",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
          decisionTraceJson: "{}",
          usedFallback: false,
        },
      ],
    });
    const ov = await recordManualOverride(db, {
      runId: "run_override_pub",
      requirementKey: "c1-CHIEF",
      centreId: "c1",
      oldTeacherId: "t_int",
      newTeacherId: "t_ext",
      reason: "Officer correction for coverage",
      changedBy: "test",
    });
    expect(ov.ok).toBe(true);
    const first = await publishRunToHistory(
      db,
      "run_override_pub",
      "ec_prac",
      "2027",
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.published).toBe(1);
    const hist = await listDutyHistory(db);
    const row = hist.find(
      (h) => (h as { run_id: string | null }).run_id === "run_override_pub",
    ) as { teacher_id: string };
    expect(row.teacher_id).toBe("t_ext");
    const second = await publishRunToHistory(
      db,
      "run_override_pub",
      "ec_prac",
      "2027",
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyPublished).toBe(true);
    expect(second.published).toBe(0);
    const histAfter = await listDutyHistory(db);
    const sameRun = histAfter.filter(
      (h) => (h as { run_id: string | null }).run_id === "run_override_pub",
    );
    expect(sameRun.length).toBe(1);
  });

  it("refuses to publish INVALID runs", async () => {
    const { persistAllocationRun: persist, publishRunToHistory } =
      await import("./repos.js");
    await persist(db, {
      runId: "run_invalid",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "INVALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [],
    });
    const r = await publishRunToHistory(db, "run_invalid", "ec_prac", "2027");
    expect(r.ok).toBe(false);
  });

  it("refuses publish when examCycleId mismatches the run", async () => {
    const { persistAllocationRun: persist, publishRunToHistory } =
      await import("./repos.js");
    await persist(db, {
      runId: "run_mismatch",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [],
    });
    const r = await publishRunToHistory(db, "run_mismatch", "ec_other", "2027");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not match/);
  });

  it("blocks generate/override on published cycles", async () => {
    const {
      assertExamCycleMutable,
      updateExamCycleStatus,
      recordManualOverride,
      persistAllocationRun: persist,
    } = await import("./repos.js");
    await updateExamCycleStatus(db, "ec_prac", "PUBLISHED", { force: true });
    const gate = await assertExamCycleMutable(
      db,
      "ec_prac",
      "generate allocation",
    );
    expect(gate.ok).toBe(false);
    await persist(db, {
      runId: "run_frozen_ov",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [
        {
          resultId: "res_fr1",
          teacherId: "t_int",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
          decisionTraceJson: "{}",
          usedFallback: false,
        },
      ],
    });
    // Mark run published without going through publish (simulate frozen)
    await db
      .prepare(
        `UPDATE allocation_runs SET status='PUBLISHED' WHERE run_id='run_frozen_ov'`,
      )
      .run();
    const ov = await recordManualOverride(db, {
      runId: "run_frozen_ov",
      requirementKey: "c1",
      centreId: "c1",
      oldTeacherId: "t_int",
      newTeacherId: "t_ext",
      reason: "should fail",
      changedBy: "test",
    });
    expect(ov.ok).toBe(false);
    const clubGate = await assertExamCycleMutable(
      db,
      "ec_prac",
      "apply clubbing",
    );
    const capGate = await assertExamCycleMutable(
      db,
      "ec_prac",
      "update centre capacity",
    );
    const importGate = await assertExamCycleMutable(
      db,
      "ec_prac",
      "apply import",
    );
    expect(clubGate.ok).toBe(false);
    expect(capGate.ok).toBe(false);
    expect(importGate.ok).toBe(false);
  });

  it("builds server-canonical backup payload", async () => {
    const { buildCanonicalBackup } = await import("./repos.js");
    const { sha256Hex } = await import("@exam-duty/shared");
    const payload = await buildCanonicalBackup(db);
    expect(payload.teachers.length).toBeGreaterThan(0);
    expect(payload.metadata.source).toBe("server-canonical");
    expect(Array.isArray(payload.rule_versions)).toBe(true);
    expect(Array.isArray(payload.exam_cycles)).toBe(true);
    expect(Array.isArray(payload.allocation_runs)).toBe(true);
    expect(Array.isArray(payload.allocation_decision_reasons)).toBe(true);
    expect(Array.isArray(payload.audit_logs)).toBe(true);
    expect(Array.isArray(payload.practical_batches)).toBe(true);
    expect(Array.isArray(payload.manual_overrides)).toBe(true);
    expect(Array.isArray(payload.duty_assignments)).toBe(true);
    expect(Array.isArray(payload.source_imports)).toBe(true);
    expect(Array.isArray(payload.source_import_rows)).toBe(true);
    expect(Array.isArray(payload.export_records)).toBe(true);
    const checksum = await sha256Hex(JSON.stringify(payload));
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("round-trips practical batches through canonical backup restore", async () => {
    const {
      buildCanonicalBackup,
      listPracticalBatches,
      persistPracticalBatches,
    } = await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_prac_backup",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "practical-1.0.0",
      module: "PRACTICAL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [],
    });
    const persisted = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_prac_backup",
      batches: [
        {
          batchId: "pb_rt_1",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 40,
          batchIndex: 0,
          examDate: "2027-03-20",
          sessionCode: "MORNING",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) throw new Error(persisted.error);
    const before = await listPracticalBatches(db, "ec_prac");
    expect(before.batches.length).toBeGreaterThan(0);
    expect(before.schedules.length).toBeGreaterThan(0);
    const payload = await buildCanonicalBackup(db);
    expect((payload.practical_batches ?? []).length).toBeGreaterThan(0);
    expect((payload.practical_schedules ?? []).length).toBeGreaterThan(0);

    // Same-DB restore is the real DR path (staging/prod overwrite in place).
    // practical_schedules.run_id → allocation_runs must be deleted before runs.
    const restored = await transactionalRestore(db, payload, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(restored.counts.practicalBatches).toBeGreaterThan(0);
    expect(restored.counts.practicalSchedules).toBeGreaterThan(0);
    const after = await listPracticalBatches(db, "ec_prac");
    expect(
      after.batches.some(
        (b) => (b as { batch_id: string }).batch_id === "pb_rt_1",
      ),
    ).toBe(true);
  });

  it("round-trips examiner pair memory through same-DB canonical restore", async () => {
    const { buildCanonicalBackup, listExaminerPairs } =
      await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_pair_backup",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "practical-1.0.0",
      module: "PRACTICAL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [],
    });
    const persisted = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_pair_backup",
      batches: [
        {
          batchId: "pb_pair_backup",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 40,
          batchIndex: 0,
          examDate: "2027-03-22",
          sessionCode: "MORNING",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) throw new Error(persisted.error);

    const payload = await buildCanonicalBackup(db);
    expect((payload.examiner_pairs ?? []).length).toBe(1);

    // Same-DB restore is the real DR path: examiner_pairs is key-present
    // replace, so a canonical archive (always includes the key) must
    // reload pair memory after the wipe.
    const restored = await transactionalRestore(db, payload, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(restored.counts.examinerPairs).toBe(1);

    const after = (await listExaminerPairs(db)) as Array<{
      internal_teacher_id: string;
      external_teacher_id: string;
      academic_year: string;
    }>;
    expect(after.length).toBe(1);
    expect(after[0]!.internal_teacher_id).toBe("t_int");
    expect(after[0]!.external_teacher_id).toBe("t_ext");
    expect(after[0]!.academic_year).toBe("2027");
  });

  it("canonical restore wipes leftover allocation runs, pairs, and snapshots", async () => {
    const { buildCanonicalBackup, listAllocationRuns, listExaminerPairs } =
      await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_keep_key",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      snapshotJson: JSON.stringify({ marker: "keep-snapshot" }),
      results: [],
    });
    const persisted = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_keep_key",
      batches: [
        {
          batchId: "pb_keep_key",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 20,
          batchIndex: 0,
          examDate: "2027-03-23",
          sessionCode: "MORNING",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) throw new Error(persisted.error);

    const snapshot = await buildCanonicalBackup(db);
    expect(Array.isArray(snapshot.allocation_runs)).toBe(true);
    expect(Array.isArray(snapshot.examiner_pairs)).toBe(true);
    expect(Array.isArray(snapshot.input_snapshots)).toBe(true);

    sqlite
      .prepare(
        `INSERT INTO allocation_runs
          (run_id, exam_cycle_id, rule_version_id, algorithm_version, module, created_by, created_at, status)
         VALUES ('run_leftover', 'ec_prac', 'rv-2027-1', 'leftover', 'THEORY', 'test', ?, 'GENERATED')`,
      )
      .run(new Date().toISOString());
    sqlite
      .prepare(
        `INSERT INTO examiner_pairs
          (pair_id, teacher_a_id, teacher_b_id, subject_id, school_id, academic_year,
           internal_teacher_id, external_teacher_id, exam_cycle_id)
         VALUES ('pair_leftover', 't_int', 't_ext', 'sub-phy', 's1', '2028', 't_int', 't_ext', 'ec_prac')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO input_snapshots (snapshot_id, payload_hash, created_at)
         VALUES ('snap_leftover', 'leftover-hash', ?)`,
      )
      .run(new Date().toISOString());

    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);

    const runs = await listAllocationRuns(db, "ec_prac");
    expect(
      runs.some((r) => (r as { run_id: string }).run_id === "run_keep_key"),
    ).toBe(true);
    expect(
      runs.some((r) => (r as { run_id: string }).run_id === "run_leftover"),
    ).toBe(false);

    const pairs = await listExaminerPairs(db);
    expect(pairs.length).toBe(1);
    expect(
      pairs.some((p) => (p as { pair_id: string }).pair_id === "pair_leftover"),
    ).toBe(false);

    const leftoverSnap = sqlite
      .prepare(
        `SELECT snapshot_id FROM input_snapshots WHERE snapshot_id='snap_leftover'`,
      )
      .get();
    expect(leftoverSnap).toBeUndefined();
    const keptSnap = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM input_snapshots`)
      .get() as { n: number };
    expect(keptSnap.n).toBeGreaterThan(0);
  });

  it("old/offline payloads without run keys leave live runs and pairs", async () => {
    const { listAllocationRuns, listExaminerPairs } = await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_omit_keep",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      snapshotJson: JSON.stringify({ marker: "omit-keep" }),
      results: [],
    });
    const persisted = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_omit_keep",
      batches: [
        {
          batchId: "pb_omit_keep",
          schoolId: "s1",
          subjectCode: "PHYSICS",
          studentCount: 16,
          batchIndex: 0,
          examDate: "2027-03-24",
          sessionCode: "AFTERNOON",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) throw new Error(persisted.error);

    const masters = {
      schools: [
        {
          schoolId: "s1",
          schoolCode: "S1",
          schoolName: "School One",
          blockId: "b1",
          active: true,
        },
        {
          schoolId: "s2",
          schoolCode: "S2",
          schoolName: "School Two",
          blockId: "b1",
          active: true,
        },
      ],
      centres: [
        {
          centreId: "c1",
          centreCode: "C1",
          centreName: "Centre One",
          blockId: "b1",
          capacity: 100,
          active: true,
        },
      ],
      teachers: [
        {
          teacherId: "t_int",
          employeeCode: "INT1",
          name: "Internal",
          schoolId: "s1",
          designation: "PG",
          isActive: true,
        },
        {
          teacherId: "t_ext",
          employeeCode: "EXT1",
          name: "External",
          schoolId: "s2",
          designation: "PG",
          isActive: true,
        },
      ],
      relationships: [],
      history: [],
    };

    const restored = await transactionalRestore(db, masters, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);

    const runs = await listAllocationRuns(db, "ec_prac");
    expect(
      runs.some((r) => (r as { run_id: string }).run_id === "run_omit_keep"),
    ).toBe(true);
    expect(
      (await listExaminerPairs(db)).some(
        (p) => (p as { academic_year: string }).academic_year === "2027",
      ),
    ).toBe(true);
    expect(
      (
        sqlite
          .prepare(`SELECT COUNT(*) AS n FROM input_snapshots`)
          .get() as { n: number }
      ).n,
    ).toBeGreaterThan(0);
  });

  it("empty allocation_runs and examiner_pairs keys wipe leftovers", async () => {
    const { listAllocationRuns, listExaminerPairs } = await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_empty_wipe",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [],
    });
    sqlite
      .prepare(
        `INSERT INTO examiner_pairs
          (pair_id, teacher_a_id, teacher_b_id, subject_id, school_id, academic_year,
           internal_teacher_id, external_teacher_id, exam_cycle_id)
         VALUES ('pair_empty_wipe', 't_int', 't_ext', 'sub-phy', 's1', '2027', 't_int', 't_ext', 'ec_prac')`,
      )
      .run();

    const restored = await transactionalRestore(
      db,
      {
        schools: [
          {
            schoolId: "s1",
            schoolCode: "S1",
            schoolName: "School One",
            blockId: "b1",
            active: true,
          },
        ],
        centres: [
          {
            centreId: "c1",
            centreCode: "C1",
            centreName: "Centre One",
            blockId: "b1",
            active: true,
          },
        ],
        teachers: [
          {
            teacherId: "t_int",
            employeeCode: "INT1",
            name: "Internal",
            schoolId: "s1",
            designation: "PG",
            isActive: true,
          },
        ],
        relationships: [],
        history: [],
        allocation_runs: [],
        examiner_pairs: [],
        input_snapshots: [],
      },
      { adminConfirmed: true, includeHistory: false },
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(await listAllocationRuns(db, "ec_prac")).toHaveLength(0);
    expect(await listExaminerPairs(db)).toHaveLength(0);
    expect(
      (
        sqlite
          .prepare(`SELECT COUNT(*) AS n FROM input_snapshots`)
          .get() as { n: number }
      ).n,
    ).toBe(0);
  });

  it("includeHistory=true still clears omitted pairs so teacher delete is FK-safe", async () => {
    const { listExaminerPairs } = await import("./repos.js");
    sqlite
      .prepare(
        `INSERT INTO examiner_pairs
          (pair_id, teacher_a_id, teacher_b_id, subject_id, school_id, academic_year,
           internal_teacher_id, external_teacher_id, exam_cycle_id)
         VALUES ('pair_fk', 't_int', 't_ext', 'sub-phy', 's1', '2027', 't_int', 't_ext', 'ec_prac')`,
      )
      .run();

    const restored = await transactionalRestore(
      db,
      {
        schools: [
          {
            schoolId: "s1",
            schoolCode: "S1",
            schoolName: "School One",
            blockId: "b1",
            active: true,
          },
          {
            schoolId: "s2",
            schoolCode: "S2",
            schoolName: "School Two",
            blockId: "b1",
            active: true,
          },
        ],
        centres: [
          {
            centreId: "c1",
            centreCode: "C1",
            centreName: "Centre One",
            blockId: "b1",
            active: true,
          },
        ],
        teachers: [
          {
            teacherId: "t_int",
            employeeCode: "INT1",
            name: "Internal",
            schoolId: "s1",
            designation: "PG",
            isActive: true,
          },
          {
            teacherId: "t_ext",
            employeeCode: "EXT1",
            name: "External",
            schoolId: "s2",
            designation: "PG",
            isActive: true,
          },
        ],
        relationships: [],
        history: [],
      },
      { adminConfirmed: true, includeHistory: true },
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(await listExaminerPairs(db)).toHaveLength(0);
  });

  it("round-trips import provenance and export receipts through same-DB restore", async () => {
    const {
      buildCanonicalBackup,
      insertSourceImport,
      insertSourceImportRows,
      insertExportRecord,
      listSourceImports,
      listSourceImportRows,
      listExportRecords,
    } = await import("./repos.js");
    await insertSourceImport(db, {
      importId: "imp_backup_rt",
      filename: "teachers-synthetic.xlsx",
      fileHash: "b".repeat(64),
      uploadedBy: "officer@test",
      status: "APPLIED",
      rowCount: 2,
      summaryJson: JSON.stringify({ upserted: 2 }),
    });
    const rowsStored = await insertSourceImportRows(db, "imp_backup_rt", [
      { rowNumber: 1, status: "NEW", entityKey: "INT1" },
      {
        rowNumber: 2,
        status: "UPDATED",
        entityKey: "EXT1",
        message: "School code changed",
      },
    ]);
    expect(rowsStored.ok).toBe(true);
    await insertExportRecord(db, {
      exportId: "exp_backup_rt",
      createdBy: "officer@test",
      exportType: "theory-xlsx",
      examCycleId: "ec_prac",
    });

    const payload = await buildCanonicalBackup(db);
    expect(
      (payload.source_imports ?? []).some(
        (r) => String(r.import_id) === "imp_backup_rt",
      ),
    ).toBe(true);
    expect((payload.source_import_rows ?? []).length).toBe(2);
    expect(
      (payload.export_records ?? []).some(
        (r) => String(r.export_id) === "exp_backup_rt",
      ),
    ).toBe(true);

    await insertSourceImport(db, {
      importId: "imp_after_backup",
      filename: "stale-after-snapshot.xlsx",
      fileHash: "c".repeat(64),
      uploadedBy: "officer@test",
      status: "UPLOADED",
    });

    const restored = await transactionalRestore(db, payload, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(restored.counts.sourceImports).toBeGreaterThanOrEqual(1);
    expect(restored.counts.sourceImportRows).toBe(2);
    expect(restored.counts.exportRecords).toBeGreaterThanOrEqual(1);

    const imports = await listSourceImports(db);
    const importIds = imports.map((r) => (r as { import_id: string }).import_id);
    expect(importIds).toContain("imp_backup_rt");
    expect(importIds).not.toContain("imp_after_backup");

    const rows = await listSourceImportRows(db, "imp_backup_rt");
    expect(rows.map((r) => (r as { entity_key: string }).entity_key).sort()).toEqual(
      ["EXT1", "INT1"],
    );
    const exports = await listExportRecords(db);
    expect(
      exports.some((r) => (r as { export_id: string }).export_id === "exp_backup_rt"),
    ).toBe(true);
  });

  it("old backups without provenance keys leave live import rows intact", async () => {
    const { insertSourceImport, listSourceImports, buildCanonicalBackup } =
      await import("./repos.js");
    await insertSourceImport(db, {
      importId: "imp_pre_existing",
      filename: "already-there.xlsx",
      fileHash: "d".repeat(64),
      uploadedBy: "officer@test",
      status: "APPLIED",
    });
    const live = await buildCanonicalBackup(db);
    const { source_imports, source_import_rows, export_records, ...oldShape } =
      live;
    expect(source_imports?.length).toBeGreaterThan(0);
    expect(source_import_rows).toBeDefined();
    expect(export_records).toBeDefined();

    const restored = await transactionalRestore(db, oldShape, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(restored.counts.sourceImports).toBe(0);
    const listed = await listSourceImports(db);
    expect(
      listed.some(
        (r) => (r as { import_id: string }).import_id === "imp_pre_existing",
      ),
    ).toBe(true);
  });

  it("same-DB restore clears practical schedules that FK allocation_runs", async () => {
    const { buildCanonicalBackup } = await import("./repos.js");
    await persistAllocationRun(db, {
      runId: "run_same_db_fk",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "practical-1.0.0",
      module: "PRACTICAL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [],
    });
    const persisted = await persistPracticalBatches(db, {
      examCycleId: "ec_prac",
      runId: "run_same_db_fk",
      batches: [
        {
          batchId: "pb_same_db_1",
          schoolId: "s1",
          subjectCode: "CHEMISTRY",
          studentCount: 24,
          batchIndex: 0,
          examDate: "2027-03-21",
          sessionCode: "AFTERNOON",
          internalExaminerId: "t_int",
          externalExaminerId: "t_ext",
        },
      ],
    });
    expect(persisted.ok).toBe(true);
    const linked = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM practical_schedules WHERE run_id = 'run_same_db_fk'`,
      )
      .get() as { n: number };
    expect(linked.n).toBeGreaterThan(0);

    const payload = await buildCanonicalBackup(db);
    const restored = await transactionalRestore(db, payload, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    const afterLinked = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM practical_schedules WHERE run_id = 'run_same_db_fk'`,
      )
      .get() as { n: number };
    expect(afterLinked.n).toBeGreaterThan(0);
  });

  it("round-trips allocation decision reasons through canonical backup restore", async () => {
    const {
      buildCanonicalBackup,
      listAllocationDecisionReasons,
      persistAllocationRun: persist,
    } = await import("./repos.js");
    await persist(db, {
      runId: "run_backup_reasons",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.1.0",
      module: "THEORY",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [
        {
          resultId: "res_br1",
          teacherId: "t_int",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
          decisionTraceJson: JSON.stringify({
            reasons: [
              {
                ruleCode: "RULE-BACKUP-ROUNDTRIP",
                severity: "INFO",
                message: "Round-trip marker",
              },
            ],
          }),
          usedFallback: false,
        },
      ],
    });
    const before = await listAllocationDecisionReasons(
      db,
      "run_backup_reasons",
    );
    expect(
      before.some(
        (r) =>
          (r as { rule_code: string }).rule_code === "RULE-BACKUP-ROUNDTRIP",
      ),
    ).toBe(true);
    const payload = await buildCanonicalBackup(db);
    expect(
      (payload.allocation_decision_reasons ?? []).some(
        (r) => String(r.rule_code) === "RULE-BACKUP-ROUNDTRIP",
      ),
    ).toBe(true);
    const restored = await transactionalRestore(db, payload, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.counts.decisionReasons).toBeGreaterThan(0);
      expect(restored.counts.allocationRuns).toBeGreaterThan(0);
    }
    const after = await listAllocationDecisionReasons(db, "run_backup_reasons");
    expect(
      after.some(
        (r) =>
          (r as { rule_code: string }).rule_code === "RULE-BACKUP-ROUNDTRIP",
      ),
    ).toBe(true);
  });

  it("restores exam_cycles and rule_versions from backup", async () => {
    const { listExamCycles, listRuleVersions, validateBackupPayload } =
      await import("./repos.js");
    const payload = {
      schools: [
        {
          schoolId: "s1",
          schoolCode: "S1",
          schoolName: "School",
          blockId: "b1",
          active: true,
        },
      ],
      centres: [
        {
          centreId: "c1",
          centreCode: "C1",
          centreName: "Centre",
          blockId: "b1",
          active: true,
        },
      ],
      teachers: [
        {
          teacherId: "t1",
          employeeCode: "E1",
          name: "Teacher",
          schoolId: "s1",
          designation: "HM",
          isActive: true,
        },
      ],
      relationships: [],
      history: [],
      rule_versions: [
        {
          rule_version_id: "rv_restore_1",
          version_label: "restore.1",
          description: "from backup",
          is_active: 1,
          created_at: "2027-01-01T00:00:00.000Z",
          created_by: "test",
        },
      ],
      rule_parameters: [
        {
          id: "rp1",
          rule_version_id: "rv_restore_1",
          param_key: "maximum_distance_km",
          param_value: "10",
          value_type: "number",
        },
      ],
      exam_cycles: [
        {
          exam_cycle_id: "ec_restore_1",
          name: "Restored cycle",
          academic_year: "2027",
          status: "OPEN",
          rule_version_id: "rv_restore_1",
          created_at: "2027-01-01T00:00:00.000Z",
          created_by: "test",
        },
      ],
    };
    expect(validateBackupPayload(payload).ok).toBe(true);
    const r = await transactionalRestore(db, payload, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.counts.examCycles).toBe(1);
    expect(r.counts.ruleVersions).toBe(1);
    const cycles = await listExamCycles(db);
    expect(
      cycles.some(
        (c) =>
          (c as { exam_cycle_id: string }).exam_cycle_id === "ec_restore_1",
      ),
    ).toBe(true);
    const rules = await listRuleVersions(db);
    expect(
      rules.some(
        (v) =>
          (v as { rule_version_id: string }).rule_version_id === "rv_restore_1",
      ),
    ).toBe(true);
  });

  it("same-DB restore keeps hall slotIndex in decision_trace_json", async () => {
    const { listAllocationRunResults, buildCanonicalBackup } = await import(
      "./repos.js"
    );
    const { hallAssignmentsFromPersistedResults } = await import(
      "@exam-duty/shared"
    );
    await persistAllocationRun(db, {
      runId: "run_hall_slots",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "hall-1.0.0",
      module: "HALL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: "{}",
      results: [
        {
          resultId: "res_hall_slot_1",
          teacherId: "t_int",
          centreId: "c1",
          dutyTypeCode: "HALL_INVIGILATOR",
          roleCode: "HALL_INVIGILATOR",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 0,
          decisionTraceJson: JSON.stringify({ slotIndex: 1 }),
          usedFallback: false,
        },
        {
          resultId: "res_hall_slot_0",
          teacherId: "t_ext",
          centreId: "c1",
          dutyTypeCode: "HALL_STANDBY",
          roleCode: "HALL_STANDBY",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 1,
          decisionTraceJson: JSON.stringify({ slotIndex: 0 }),
          usedFallback: false,
        },
      ],
    });
    const snapshot = await buildCanonicalBackup(db);
    sqlite
      .prepare(
        `INSERT INTO allocation_run_results
          (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override)
         VALUES ('res_hall_leftover', 'run_hall_slots', 't_int', 'c1', 'HALL_INVIGILATOR', 'HALL_INVIGILATOR', '2027-03-16', 'AFTERNOON', 9, '{"slotIndex":99}', 1, 0)`,
      )
      .run();
    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);
    const listed = (await listAllocationRunResults(db, "run_hall_slots")) as Array<{
      teacher_id: string;
      final_teacher_id?: string | null;
      centre_id: string;
      role_code: string;
      exam_date: string;
      session_code: string;
      score: number;
      decision_trace_json: string | null;
    }>;
    expect(listed).toHaveLength(2);
    const assignments = hallAssignmentsFromPersistedResults(
      listed,
      new Map([
        ["t_int", "INT1"],
        ["t_ext", "EXT1"],
      ]),
    );
    const byTeacher = new Map(assignments.map((a) => [a.teacherId, a]));
    expect(byTeacher.get("t_int")?.slotIndex).toBe(1);
    expect(byTeacher.get("t_int")?.employeeCode).toBe("INT1");
    expect(byTeacher.get("t_ext")?.slotIndex).toBe(0);
    expect(byTeacher.get("t_ext")?.employeeCode).toBe("EXT1");
    expect(
      assignments.some((a) => a.slotIndex === 99 || a.examDate === "2027-03-16"),
    ).toBe(false);
  });

  it("same-DB restore keeps theory usedFallbackBand and practical roleSwitchApplied", async () => {
    const { listAllocationRunResults, buildCanonicalBackup } = await import(
      "./repos.js"
    );
    const {
      theoryAssignmentsFromPersistedResults,
      roleSwitchAppliedFromPersisted,
    } = await import("@exam-duty/shared");
    await persistAllocationRun(db, {
      runId: "run_theory_fallback",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.0.0",
      module: "THEORY",
      validationStatus: "VALID_WITH_WARNINGS",
      createdBy: "test",
      summaryJson: JSON.stringify({
        assignments: 2,
        shortages: 1,
        feasible: false,
      }),
      results: [
        {
          resultId: "res_theory_fb_yes",
          teacherId: "t_int",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 4,
          decisionTraceJson: JSON.stringify({
            teacherId: "t_int",
            reasons: [
              {
                ruleCode: "INFO-HM-FALLBACK",
                severity: "WARNING",
                message: "Preferred band shortage",
              },
            ],
          }),
          usedFallback: true,
        },
        {
          resultId: "res_theory_fb_no",
          teacherId: "t_ext",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "AFTERNOON",
          score: 1,
          decisionTraceJson: JSON.stringify({ teacherId: "t_ext" }),
          usedFallback: false,
        },
      ],
    });
    await persistAllocationRun(db, {
      runId: "run_practical_switch",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "practical-1.0.0",
      module: "PRACTICAL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: JSON.stringify({ schedules: 2, feasible: true }),
      results: [
        {
          resultId: "res_prac_switch_yes",
          teacherId: "t_int",
          centreId: "s1",
          dutyTypeCode: "PRACTICAL_INTERNAL",
          roleCode: "PRACTICAL_INTERNAL",
          examDate: "2027-03-01",
          sessionCode: "MORNING",
          score: 0,
          decisionTraceJson: JSON.stringify([
            "Applied annual role switch from academic year 2026",
          ]),
          usedFallback: true,
        },
        {
          resultId: "res_prac_switch_no",
          teacherId: "t_ext",
          centreId: "s1",
          dutyTypeCode: "PRACTICAL_INTERNAL",
          roleCode: "PRACTICAL_INTERNAL",
          examDate: "2027-03-02",
          sessionCode: "MORNING",
          score: 0,
          decisionTraceJson: JSON.stringify([]),
          usedFallback: false,
        },
      ],
    });
    const snapshot = await buildCanonicalBackup(db);
    sqlite
      .prepare(
        `INSERT INTO allocation_run_results
          (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override)
         VALUES ('res_theory_fb_leftover', 'run_theory_fallback', 't_int', 'c1', 'CHIEF_EXAMINATION', 'CHIEF_EXAMINATION', '2027-03-16', 'MORNING', 9, '{"usedFallbackBand":true}', 1, 0)`,
      )
      .run();
    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);
    const theoryListed = (await listAllocationRunResults(
      db,
      "run_theory_fallback",
    )) as Array<{
      teacher_id: string;
      final_teacher_id?: string | null;
      is_override?: number | null;
      centre_id: string;
      role_code: string;
      exam_date: string;
      session_code: string;
      score: number;
      decision_trace_json: string | null;
    }>;
    expect(theoryListed).toHaveLength(2);
    const theoryAssignments = theoryAssignmentsFromPersistedResults(theoryListed);
    const theoryByTeacher = new Map(
      theoryAssignments.map((a) => [a.teacherId, a]),
    );
    expect(theoryByTeacher.get("t_int")?.usedFallbackBand).toBe(true);
    expect(theoryByTeacher.get("t_ext")?.usedFallbackBand).toBe(false);
    expect(theoryListed.some((r) => r.exam_date === "2027-03-16")).toBe(false);

    const practicalListed = (await listAllocationRunResults(
      db,
      "run_practical_switch",
    )) as Array<{
      teacher_id: string;
      final_teacher_id?: string | null;
      centre_id: string;
      role_code: string;
      exam_date: string;
      session_code: string;
      score: number;
      decision_trace_json: string | null;
    }>;
    expect(practicalListed).toHaveLength(2);
    const switchByTeacher = new Map(
      practicalListed.map((row) => [
        row.teacher_id,
        roleSwitchAppliedFromPersisted(row),
      ]),
    );
    expect(switchByTeacher.get("t_int")).toBe(true);
    expect(switchByTeacher.get("t_ext")).toBe(false);
    const storedYes = JSON.parse(
      practicalListed.find((r) => r.teacher_id === "t_int")
        ?.decision_trace_json ?? "{}",
    ) as { roleSwitchApplied?: boolean };
    expect(storedYes.roleSwitchApplied).toBe(true);
  });

  it("same-DB restore keeps shortage objects in summary_json", async () => {
    const {
      listAllocationRuns,
      listAllocationDecisionReasons,
      listAllocationRunResults,
      buildCanonicalBackup,
    } = await import("./repos.js");
    const {
      theoryShortagesFromPersisted,
      hallShortagesFromPersisted,
      theoryAssignmentsFromPersistedResults,
    } = await import("@exam-duty/shared");
    const theoryShortages = [
      {
        requirementKey: "c1-CHIEF",
        required: 1,
        eligible: 0,
        shortage: 1,
        exclusionTallies: { UNKNOWN_CENTRE: 1 },
        message: "NO FEASIBLE ALLOCATION — centre not found",
      },
    ];
    const hallShortages = [
      {
        centreId: "c1",
        required: 11,
        eligible: 3,
        shortage: 8,
        message: "NO FEASIBLE ALLOCATION",
      },
    ];
    await persistAllocationRun(db, {
      runId: "run_theory_shortage",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.0.0",
      module: "THEORY",
      validationStatus: "INVALID",
      createdBy: "test",
      summaryJson: JSON.stringify({
        assignments: 1,
        shortages: theoryShortages,
        shortageCount: 1,
        feasible: false,
      }),
      results: [
        {
          resultId: "res_theory_shortage_ok",
          teacherId: "t_int",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 2,
          decisionTraceJson: JSON.stringify({
            teacherId: "t_int",
            requirementKey: "c1-CHIEF",
          }),
          usedFallback: false,
        },
      ],
      validationFindings: [
        {
          ruleCode: "RULE-SHORTAGE",
          severity: "ERROR",
          message: "NO FEASIBLE ALLOCATION — centre not found",
          details: theoryShortages[0],
        },
      ],
    });
    await persistAllocationRun(db, {
      runId: "run_hall_shortage",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "hall-1.0.0",
      module: "HALL",
      validationStatus: "INVALID",
      createdBy: "test",
      summaryJson: JSON.stringify({
        assignments: 0,
        shortages: hallShortages,
        shortageCount: 1,
        feasible: false,
      }),
      results: [],
    });
    const snapshot = await buildCanonicalBackup(db);
    sqlite
      .prepare(
        `INSERT INTO allocation_run_results
          (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override)
         VALUES ('res_theory_shortage_leftover', 'run_theory_shortage', 't_int', 'c1', 'CHIEF_EXAMINATION', 'CHIEF_EXAMINATION', '2027-03-16', 'MORNING', 9, '{}', 1, 0)`,
      )
      .run();
    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);

    const runs = (await listAllocationRuns(db, "ec_prac")) as Array<{
      run_id: string;
      summary_json: string | null;
    }>;
    const theoryRun = runs.find((r) => r.run_id === "run_theory_shortage");
    const hallRun = runs.find((r) => r.run_id === "run_hall_shortage");
    const theoryReasons = (await listAllocationDecisionReasons(
      db,
      "run_theory_shortage",
    )) as Array<{
      rule_code: string;
      severity: string;
      message: string;
      details_json: string | null;
    }>;
    const hydratedTheory = theoryShortagesFromPersisted(
      theoryRun?.summary_json,
      theoryReasons,
    );
    const hydratedHall = hallShortagesFromPersisted(hallRun?.summary_json);
    expect(hydratedTheory).toEqual(theoryShortages);
    expect(hydratedHall).toEqual(hallShortages);
    expect(theoryShortagesFromPersisted(
      JSON.stringify({ assignments: 1, shortages: 1, feasible: false }),
    )).toEqual([]);

    const theoryListed = (await listAllocationRunResults(
      db,
      "run_theory_shortage",
    )) as Array<{
      teacher_id: string;
      final_teacher_id?: string | null;
      centre_id: string;
      role_code: string;
      exam_date: string;
      session_code: string;
      score: number;
      decision_trace_json: string | null;
    }>;
    expect(theoryListed).toHaveLength(1);
    expect(
      theoryAssignmentsFromPersistedResults(theoryListed)[0]?.requirementKey,
    ).toBe("c1-CHIEF");
    expect(theoryListed.some((r) => r.exam_date === "2027-03-16")).toBe(false);
  });

  it("same-DB restore keeps validation valid in summary_json", async () => {
    const { listAllocationRuns, listAllocationRunResults, buildCanonicalBackup } =
      await import("./repos.js");
    const { validCountFromPersistedSummary } = await import("@exam-duty/shared");
    await persistAllocationRun(db, {
      runId: "run_validation_valid",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "theory-1.0.0",
      module: "THEORY",
      validationStatus: "INVALID",
      createdBy: "test",
      summaryJson: JSON.stringify({
        assignments: 3,
        valid: 1,
        warnings: 1,
        errors: 2,
        feasible: false,
      }),
      results: [
        {
          resultId: "res_valid_a",
          teacherId: "t_int",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "MORNING",
          score: 2,
          decisionTraceJson: JSON.stringify({ teacherId: "t_int" }),
          usedFallback: false,
        },
        {
          resultId: "res_valid_b",
          teacherId: "t_ext",
          centreId: "c1",
          dutyTypeCode: "CHIEF_EXAMINATION",
          roleCode: "CHIEF_EXAMINATION",
          examDate: "2027-03-15",
          sessionCode: "AFTERNOON",
          score: 1,
          decisionTraceJson: JSON.stringify({ teacherId: "t_ext" }),
          usedFallback: false,
        },
      ],
    });
    const snapshot = await buildCanonicalBackup(db);
    sqlite
      .prepare(
        `INSERT INTO allocation_run_results
          (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override)
         VALUES ('res_valid_leftover', 'run_validation_valid', 't_int', 'c1', 'CHIEF_EXAMINATION', 'CHIEF_EXAMINATION', '2027-03-16', 'MORNING', 9, '{}', 1, 0)`,
      )
      .run();
    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);
    const runs = (await listAllocationRuns(db, "ec_prac")) as Array<{
      run_id: string;
      summary_json: string | null;
    }>;
    const summary = runs.find((r) => r.run_id === "run_validation_valid")
      ?.summary_json;
    expect(validCountFromPersistedSummary(summary)).toBe(1);
    expect(
      validCountFromPersistedSummary(
        JSON.stringify({ assignments: 3, errors: 2 }),
      ),
    ).toBeUndefined();
    const listed = (await listAllocationRunResults(
      db,
      "run_validation_valid",
    )) as Array<{ exam_date: string }>;
    expect(listed).toHaveLength(2);
    expect(listed.some((r) => r.exam_date === "2027-03-16")).toBe(false);
  });

  it("same-DB restore keeps practical batch identity in decision_trace_json", async () => {
    const { listAllocationRunResults, buildCanonicalBackup } = await import(
      "./repos.js"
    );
    const { practicalSchedulesFromPersistedResults } = await import(
      "@exam-duty/shared"
    );
    await persistAllocationRun(db, {
      runId: "run_practical_identity",
      examCycleId: "ec_prac",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "practical-1.0.0",
      module: "PRACTICAL",
      validationStatus: "VALID",
      createdBy: "test",
      summaryJson: JSON.stringify({
        schedules: 2,
        batches: 2,
        feasible: true,
      }),
      results: [
        {
          resultId: "res_prac_id_phy",
          teacherId: "t_int",
          centreId: "s1",
          dutyTypeCode: "PRACTICAL_INTERNAL",
          roleCode: "PRACTICAL_INTERNAL",
          examDate: "2027-03-01",
          sessionCode: "MORNING",
          score: 0,
          decisionTraceJson: JSON.stringify({
            batchKey: "s1|PHYSICS|1",
            schoolId: "s1",
            subjectId: "PHYSICS",
            externalExaminerId: "t_ext",
            decisionNotes: [
              "Applied annual role switch from academic year 2026",
            ],
            roleSwitchApplied: true,
            batchIndex: 1,
            studentCount: 40,
          }),
          usedFallback: true,
        },
        {
          resultId: "res_prac_id_che",
          teacherId: "t_ext",
          centreId: "s1",
          dutyTypeCode: "PRACTICAL_INTERNAL",
          roleCode: "PRACTICAL_INTERNAL",
          examDate: "2027-03-01",
          sessionCode: "AFTERNOON",
          score: 0,
          decisionTraceJson: JSON.stringify({
            batchKey: "s1|CHEMISTRY|1",
            schoolId: "s1",
            subjectId: "CHEMISTRY",
            externalExaminerId: "t_int",
            decisionNotes: [],
            roleSwitchApplied: false,
            batchIndex: 1,
            studentCount: 35,
          }),
          usedFallback: false,
        },
      ],
    });
    const snapshot = await buildCanonicalBackup(db);
    sqlite
      .prepare(
        `INSERT INTO allocation_run_results
          (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override)
         VALUES ('res_prac_id_leftover', 'run_practical_identity', 't_int', 's1', 'PRACTICAL_INTERNAL', 'PRACTICAL_INTERNAL', '2027-03-16', 'MORNING', 9, '{"subjectId":"UNK"}', 1, 0)`,
      )
      .run();
    const restored = await transactionalRestore(db, snapshot, {
      adminConfirmed: true,
      includeHistory: false,
    });
    expect(restored.ok).toBe(true);
    const listed = (await listAllocationRunResults(
      db,
      "run_practical_identity",
    )) as Array<{
      teacher_id: string;
      final_teacher_id?: string | null;
      centre_id: string;
      role_code: string;
      exam_date: string;
      session_code: string;
      score: number;
      decision_trace_json: string | null;
    }>;
    expect(listed).toHaveLength(2);
    const schedules = practicalSchedulesFromPersistedResults(listed);
    const byInternal = new Map(
      schedules.map((s) => [s.internalExaminerId, s]),
    );
    expect(byInternal.get("t_int")?.subjectId).toBe("PHYSICS");
    expect(byInternal.get("t_int")?.batchKey).toBe("s1|PHYSICS|1");
    expect(byInternal.get("t_int")?.externalExaminerId).toBe("t_ext");
    expect(byInternal.get("t_int")?.roleSwitchApplied).toBe(true);
    expect(byInternal.get("t_ext")?.subjectId).toBe("CHEMISTRY");
    expect(byInternal.get("t_ext")?.externalExaminerId).toBe("t_int");
    expect(schedules.some((s) => s.subjectId === "UNK")).toBe(false);
    expect(listed.some((r) => r.exam_date === "2027-03-16")).toBe(false);
  });
});

describe("exam cycle transitions + rule version activate", () => {
  let db: ReturnType<typeof createSqliteClient>;

  beforeEach(async () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    db = createSqliteClient(sqlite);
    await applyMigrations(db, join(process.cwd(), ".."));
    await upsertExamCycle(db, {
      examCycleId: "ec_test",
      name: "Test",
      academicYear: "2027",
      status: "OPEN",
      ruleVersionId: "rv-2027-1",
      createdBy: "test",
    });
  });

  it("rejects illegal exam cycle transitions", async () => {
    const bad = await updateExamCycleStatus(db, "ec_test", "PUBLISHED");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/Illegal transition/);
  });

  it("allows legal transitions and force override", async () => {
    const ok = await updateExamCycleStatus(
      db,
      "ec_test",
      "ALLOCATION_GENERATED",
    );
    expect(ok.ok).toBe(true);
    const forced = await updateExamCycleStatus(db, "ec_test", "PUBLISHED", {
      force: true,
    });
    expect(forced.ok).toBe(true);
  });

  it("clones and activates rule versions without editing parameters", async () => {
    const created = await createRuleVersion(db, {
      ruleVersionId: "rv_test_clone",
      versionLabel: "2027.2-test",
      description: "clone",
      createdBy: "test",
      cloneFromId: "rv-2027-1",
      activate: false,
    });
    expect(created.ok).toBe(true);
    const seedParams = await listRuleParameters(db, "rv-2027-1");
    const cloneParams = await listRuleParameters(db, "rv_test_clone");
    expect(seedParams.length).toBe(18);
    expect(cloneParams).toHaveLength(seedParams.length);
    const seedKeys = seedParams
      .map((p) => (p as { param_key: string }).param_key)
      .sort();
    const cloneKeys = cloneParams
      .map((p) => (p as { param_key: string }).param_key)
      .sort();
    expect(cloneKeys).toEqual(seedKeys);
    const missing = await getRuleVersion(db, "rv-does-not-exist");
    expect(missing).toBeNull();
    const activated = await activateRuleVersion(db, "rv_test_clone");
    expect(activated.ok).toBe(true);
    if (activated.ok) expect(activated.versionLabel).toBe("2027.2-test");
    const afterActivate = (await listExamCycles(db)).find(
      (c) => c.exam_cycle_id === "ec_test",
    ) as { rule_version_id?: string };
    expect(afterActivate.rule_version_id).toBe("rv-2027-1");
    const versions = await listRuleVersions(db);
    const active = versions.filter(
      (v) => (v as { is_active: number }).is_active,
    );
    expect(active).toHaveLength(1);
    expect((active[0] as { rule_version_id: string }).rule_version_id).toBe(
      "rv_test_clone",
    );
  });

  it("ensureExamCycleIfMissing does not reset a published cycle", async () => {
    const { ensureExamCycleIfMissing, getExamCycleStatus } =
      await import("./repos.js");
    await updateExamCycleStatus(db, "ec_test", "PUBLISHED", { force: true });
    const boot = await ensureExamCycleIfMissing(db, {
      examCycleId: "ec_test",
      name: "Clobber from boot",
      academicYear: "2099",
      status: "OPEN",
      ruleVersionId: "rv-2027-1",
      createdBy: "boot",
    });
    expect(boot.created).toBe(false);
    expect(await getExamCycleStatus(db, "ec_test")).toBe("PUBLISHED");
    const cycles = await listExamCycles(db);
    const row = cycles.find((c) => c.exam_cycle_id === "ec_test") as {
      name: string;
      academic_year: string;
    };
    expect(row.name).toBe("Test");
    expect(row.academic_year).toBe("2027");
  });

  it("createExamCycle refuses to replace a published cycle", async () => {
    const { createExamCycle, getExamCycleStatus } = await import("./repos.js");
    await updateExamCycleStatus(db, "ec_test", "PUBLISHED", { force: true });
    const replace = await createExamCycle(db, {
      examCycleId: "ec_test",
      name: "Clobber",
      academicYear: "2027",
      ruleVersionId: "rv-2027-1",
      createdBy: "test",
      status: "OPEN",
    });
    expect(replace.ok).toBe(false);
    if (!replace.ok) {
      expect(replace.conflict).toBe(true);
      expect(replace.error).toMatch(/PUBLISHED/);
    }
    expect(await getExamCycleStatus(db, "ec_test")).toBe("PUBLISHED");
  });

  it("creates amendment cycles without mutating the previous cycle", async () => {
    const { createExamCycle } = await import("./repos.js");
    await updateExamCycleStatus(db, "ec_test", "PUBLISHED", { force: true });
    const amd = await createExamCycle(db, {
      examCycleId: "ec_amend_1",
      name: "Amendment",
      academicYear: "2027",
      ruleVersionId: "rv-2027-1",
      createdBy: "test",
      amendedFromId: "ec_test",
      amendmentReason: "Correction of duty type",
    });
    expect(amd.ok).toBe(true);
    const cycles = await listExamCycles(db);
    const prev = cycles.find((c) => c.exam_cycle_id === "ec_test") as {
      status: string;
    };
    const next = cycles.find((c) => c.exam_cycle_id === "ec_amend_1") as {
      status: string;
      amended_from_id: string;
      amendment_reason: string;
    };
    expect(prev.status).toBe("PUBLISHED");
    expect(next.status).toBe("DRAFT");
    expect(next.amended_from_id).toBe("ec_test");
    expect(next.amendment_reason).toMatch(/Correction/);
    const bad = await createExamCycle(db, {
      examCycleId: "ec_bad",
      name: "Bad",
      academicYear: "2027",
      ruleVersionId: "rv-2027-1",
      createdBy: "test",
      amendedFromId: "ec_amend_1",
      amendmentReason: "too early",
    });
    expect(bad.ok).toBe(false);
  });

  it("stores the officer-configured exam window and refuses a reversed range", async () => {
    const { setExamCycleWindow } = await import("./repos.js");
    const set = await setExamCycleWindow(db, "ec_test", {
      startDate: "2027-03-10",
      endDate: "2027-03-20",
    });
    expect(set.ok).toBe(true);

    const read = () =>
      listExamCycles(db).then(
        (cs) =>
          cs.find((c) => c.exam_cycle_id === "ec_test") as {
            start_date: string | null;
            end_date: string | null;
          },
      );
    expect(await read()).toMatchObject({
      start_date: "2027-03-10",
      end_date: "2027-03-20",
    });

    const reversed = await setExamCycleWindow(db, "ec_test", {
      startDate: "2027-03-20",
      endDate: "2027-03-10",
    });
    expect(reversed.ok).toBe(false);
    // The rejected write must not have touched the stored window.
    expect(await read()).toMatchObject({ start_date: "2027-03-10" });

    const cleared = await setExamCycleWindow(db, "ec_test", {
      startDate: null,
      endDate: null,
    });
    expect(cleared.ok).toBe(true);
    expect(await read()).toMatchObject({ start_date: null, end_date: null });
  });

  it("refuses to move the exam window of a frozen cycle", async () => {
    const { setExamCycleWindow } = await import("./repos.js");
    await updateExamCycleStatus(db, "ec_test", "PUBLISHED", { force: true });
    const set = await setExamCycleWindow(db, "ec_test", {
      startDate: "2027-04-01",
      endDate: "2027-04-05",
    });
    expect(set.ok).toBe(false);
  });

  it("carries the exam window through a canonical backup and restore", async () => {
    const { setExamCycleWindow, buildCanonicalBackup } =
      await import("./repos.js");
    await setExamCycleWindow(db, "ec_test", {
      startDate: "2027-03-10",
      endDate: "2027-03-20",
    });
    const backup = await buildCanonicalBackup(db);
    // Wipe the window to prove the restore reloads it rather than leaving it.
    await setExamCycleWindow(db, "ec_test", {
      startDate: null,
      endDate: null,
    });

    const restored = await transactionalRestore(db, backup, {
      adminConfirmed: true,
      includeHistory: true,
    });
    expect(restored.ok).toBe(true);
    const cycle = (await listExamCycles(db)).find(
      (c) => c.exam_cycle_id === "ec_test",
    ) as { start_date: string | null; end_date: string | null };
    expect(cycle.start_date).toBe("2027-03-10");
    expect(cycle.end_date).toBe("2027-03-20");
  });
});

describe("seedDemoDatasetIfEmpty", () => {
  let db: ReturnType<typeof createSqliteClient>;
  let sqlite: Database.Database;

  const clobberDemo = {
    blocks: [{ blockId: "blk_demo", blockCode: "BD", blockName: "Demo Block" }],
    schools: [
      {
        schoolId: "sch_demo",
        schoolCode: "DS1",
        schoolName: "Demo School",
        blockId: "blk_demo",
      },
    ],
    centres: [
      {
        centreId: "cen_demo",
        centreCode: "DC1",
        centreName: "Demo Centre",
        blockId: "blk_demo",
      },
    ],
    teachers: [
      {
        teacherId: "t_demo",
        employeeCode: "D1",
        name: "Demo Teacher",
        schoolId: "sch_demo",
        designation: "HM",
      },
    ],
    history: [
      {
        teacherId: "t_demo",
        centreId: "cen_demo",
        dutyTypeCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        academicYear: "2027",
      },
    ],
  };

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    db = createSqliteClient(sqlite);
    await applyMigrations(db, join(process.cwd(), ".."));
  });

  afterEach(() => {
    sqlite.close();
  });

  it("seeds when only an OPEN bootstrap cycle exists", async () => {
    await upsertExamCycle(db, {
      examCycleId: "ec_2027_hsc",
      name: "2027 HSC Public Examination (Synthetic)",
      academicYear: "2027",
      status: "OPEN",
      ruleVersionId: "rv-2027-1",
      createdBy: "system",
    });
    const provenance = await sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM input_snapshots) AS snapshots,
           (SELECT COUNT(*) FROM source_imports) AS imports,
           (SELECT COUNT(*) FROM export_records) AS exports,
           (SELECT COUNT(*) FROM audit_logs) AS audit`,
      )
      .get() as {
      snapshots: number;
      imports: number;
      exports: number;
      audit: number;
    };
    expect(provenance).toEqual({
      snapshots: 0,
      imports: 0,
      exports: 0,
      audit: 0,
    });
    const seeded = await seedDemoDatasetIfEmpty(db, clobberDemo);
    expect(seeded).toEqual({ seeded: true });
    const counts = await countMaster(db);
    expect(counts.teachers).toBe(1);
    expect(counts.schools).toBe(1);
    expect(await getExamCycleStatus(db, "ec_2027_hsc")).toBe("OPEN");
  });

  it("does not remaster when a cycle is already PUBLISHED", async () => {
    await upsertExamCycle(db, {
      examCycleId: "ec_published",
      name: "Officer published",
      academicYear: "2027",
      status: "PUBLISHED",
      ruleVersionId: "rv-2027-1",
      createdBy: "officer",
    });
    const seeded = await seedDemoDatasetIfEmpty(db, clobberDemo);
    expect(seeded.seeded).toBe(false);
    if (!seeded.seeded) expect(seeded.reason).toMatch(/frozen exam cycle/);
    expect(await countMaster(db)).toMatchObject({
      teachers: 0,
      schools: 0,
      centres: 0,
    });
    const cycles = await listExamCycles(db);
    const row = cycles.find((c) => c.exam_cycle_id === "ec_published") as {
      name: string;
      status: string;
    };
    expect(row.name).toBe("Officer published");
    expect(row.status).toBe("PUBLISHED");
  });

  it("does not wipe leftover schools when teachers are empty", async () => {
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO blocks (block_id, block_code, block_name, active, created_at, updated_at)
         VALUES ('blk_keep', 'BK', 'Keep Block', 1, ?, ?)`,
      )
      .bind(now, now)
      .run();
    await db
      .prepare(
        `INSERT INTO schools
          (school_id, school_code, school_name, block_id, active, data_quality, created_at, updated_at)
         VALUES ('sch_keep', 'SK1', 'Officer School', 'blk_keep', 1, 'Imported', ?, ?)`,
      )
      .bind(now, now)
      .run();
    const seeded = await seedDemoDatasetIfEmpty(db, clobberDemo);
    expect(seeded.seeded).toBe(false);
    if (!seeded.seeded) expect(seeded.reason).toMatch(/schools already present/);
    const schools = await db
      .prepare(`SELECT school_id, school_name FROM schools`)
      .all();
    expect(schools.results).toEqual([
      { school_id: "sch_keep", school_name: "Officer School" },
    ]);
  });

  it("does not wipe leftover blocks when teachers/schools/centres are empty", async () => {
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO blocks (block_id, block_code, block_name, active, created_at, updated_at)
         VALUES ('blk_keep_geo', 'BG', 'Officer Geography', 1, ?, ?)`,
      )
      .bind(now, now)
      .run();
    const seeded = await seedDemoDatasetIfEmpty(db, clobberDemo);
    expect(seeded.seeded).toBe(false);
    if (!seeded.seeded) expect(seeded.reason).toMatch(/blocks already present/);
    const blocks = await db
      .prepare(`SELECT block_id, block_name FROM blocks`)
      .all();
    expect(blocks.results).toEqual([
      { block_id: "blk_keep_geo", block_name: "Officer Geography" },
    ]);
    expect(await countMaster(db)).toMatchObject({
      teachers: 0,
      schools: 0,
      centres: 0,
      blocks: 1,
    });
  });

  it("does not wipe published duty history when teachers were deleted", async () => {
    await upsertExamCycle(db, {
      examCycleId: "ec_hist",
      name: "Has history",
      academicYear: "2027",
      status: "OPEN",
      ruleVersionId: "rv-2027-1",
      createdBy: "officer",
    });
    await db
      .prepare(
        `INSERT INTO duty_assignment_history
          (history_id, assignment_id, exam_cycle_id, teacher_id, duty_type_code, exam_date, session_code, academic_year, published_at)
         VALUES ('h_keep', 'a_keep', 'ec_hist', 't_gone', 'CHIEF_EXAMINATION', '2027-03-15', 'MORNING', '2027', ?)`,
      )
      .bind(new Date().toISOString())
      .run();
    const seeded = await seedDemoDatasetIfEmpty(db, clobberDemo);
    expect(seeded.seeded).toBe(false);
    if (!seeded.seeded) expect(seeded.reason).toMatch(/duty history/);
    const hist = await db
      .prepare(
        `SELECT history_id, teacher_id FROM duty_assignment_history WHERE history_id = 'h_keep'`,
      )
      .first<{ history_id: string; teacher_id: string }>();
    expect(hist).toEqual({ history_id: "h_keep", teacher_id: "t_gone" });
    expect(await countMaster(db)).toMatchObject({ teachers: 0, history: 1 });
  });

  it("does not remaster leftover snapshots when masters are empty", async () => {
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO input_snapshots (snapshot_id, payload_hash, created_at)
         VALUES ('snap_keep', ?, ?)`,
      )
      .bind("a".repeat(64), now)
      .run();
    const seeded = await seedDemoDatasetIfEmpty(db, clobberDemo);
    expect(seeded.seeded).toBe(false);
    if (!seeded.seeded) expect(seeded.reason).toMatch(/snapshots already present/);
    const snap = await db
      .prepare(
        `SELECT snapshot_id FROM input_snapshots WHERE snapshot_id = 'snap_keep'`,
      )
      .first<{ snapshot_id: string }>();
    expect(snap?.snapshot_id).toBe("snap_keep");
    expect(await countMaster(db)).toMatchObject({
      teachers: 0,
      schools: 0,
      centres: 0,
    });
  });

  it("does not remaster leftover source imports when masters are empty", async () => {
    await insertSourceImport(db, {
      importId: "imp_keep",
      filename: "officer.xlsx",
      fileHash: "b".repeat(64),
      uploadedBy: "officer",
      status: "UPLOADED",
    });
    const seeded = await seedDemoDatasetIfEmpty(db, clobberDemo);
    expect(seeded.seeded).toBe(false);
    if (!seeded.seeded)
      expect(seeded.reason).toMatch(/source imports already present/);
    expect(await countMaster(db)).toMatchObject({ teachers: 0 });
  });

  it("does not remaster leftover export records when masters are empty", async () => {
    await insertExportRecord(db, {
      exportId: "exp_keep",
      createdBy: "officer",
      exportType: "theory-xlsx",
    });
    const seeded = await seedDemoDatasetIfEmpty(db, clobberDemo);
    expect(seeded.seeded).toBe(false);
    if (!seeded.seeded)
      expect(seeded.reason).toMatch(/export records already present/);
    expect(await countMaster(db)).toMatchObject({ teachers: 0 });
  });

  it("does not remaster leftover persisted audit when masters are empty", async () => {
    await insertAudit(db, {
      auditId: "aud_keep",
      userId: "officer",
      action: "IMPORT",
      entity: "source_import",
      entityId: "imp_gone",
    });
    const seeded = await seedDemoDatasetIfEmpty(db, clobberDemo);
    expect(seeded.seeded).toBe(false);
    if (!seeded.seeded)
      expect(seeded.reason).toMatch(/persisted audit already present/);
    expect(await countMaster(db)).toMatchObject({ teachers: 0 });
  });

  it("does not treat empty or session-shaped audit_logs as a first-boot block", async () => {
    const empty = await sqlite
      .prepare(`SELECT COUNT(*) AS n FROM audit_logs`)
      .get() as { n: number };
    expect(empty.n).toBe(0);
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO audit_logs (audit_id, action, timestamp)
         VALUES ('', 'LOGIN', ?)`,
      )
      .run(now);
    const seeded = await seedDemoDatasetIfEmpty(db, clobberDemo);
    expect(seeded).toEqual({ seeded: true });
    expect(await countMaster(db)).toMatchObject({ teachers: 1 });
  });
});

describe("master list APIs for blocks and subjects", () => {
  let db: ReturnType<typeof createSqliteClient>;
  let sqlite: Database.Database;

  beforeEach(async () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    db = createSqliteClient(sqlite);
    await applyMigrations(db, join(process.cwd(), ".."));
  });

  afterEach(() => {
    sqlite.close();
  });

  it("lists seed subjects and no blocks until restore", async () => {
    const subjects = await listSubjects(db);
    expect(subjects.length).toBe(8);
    expect(
      subjects.some((s) => (s as { code: string }).code === "PHY"),
    ).toBe(true);
    expect(await listBlocks(db)).toEqual([]);
    const counts = await countMaster(db);
    expect(counts.subjects).toBe(8);
    expect(counts.blocks).toBe(0);
  });

  it("lists restored blocks and keeps seed subjects", async () => {
    const r = await transactionalRestore(
      db,
      {
        blocks: [
          { blockId: "b1", blockCode: "B1", blockName: "North" },
          { blockId: "b2", blockCode: "B2", blockName: "South" },
        ],
        schools: [
          {
            schoolId: "s1",
            schoolCode: "S1",
            schoolName: "School",
            blockId: "b1",
            active: true,
          },
        ],
        centres: [],
        teachers: [],
      },
      { adminConfirmed: true, includeHistory: true },
    );
    expect(r.ok).toBe(true);
    const blocks = await listBlocks(db);
    expect(blocks.map((b) => (b as { block_code: string }).block_code)).toEqual(
      ["B1", "B2"],
    );
    expect((await listSubjects(db)).length).toBe(8);
    const counts = await countMaster(db);
    expect(counts.blocks).toBe(2);
    expect(counts.subjects).toBe(8);
  });
});
