/**
 * Local UAT evidence pack (synthetic data only).
 * Covers inventable items from docs/uat-plan.md against SQLite + engines.
 * Does NOT satisfy §107 — live CF D1/R2, Access IdP, staging UAT, and human promote remain.
 *
 * Writes: .data/uat-local-latest.json (+ /opt/cursor/artifacts/uat-local-evidence.json when present)
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import Database from "better-sqlite3";
import {
  DEFAULT_RULE_PARAMETERS,
  applyStoredRuleParameters,
  backupArchiveOfficerMessage,
  backupCatalogListNote,
  backupCatalogRowHasStoredPayload,
  importUploadOfficerMessage,
  inlineCanonicalBackupPayload,
  isLoadableBackupPayload,
  publishBackupSuffix,
  buildHydrateReport,
  classifyHydrateList,
  catalogUsableForGenerate,
  firstUnusableGenerateCatalogLabel,
  pickAuthoritativeList,
  conflictsFromPersistedReasons,
  hallAssignmentsFromPersistedResults,
  hallShortagesFromPersisted,
  feasibleFromPersistedSummary,
  issuesFromPersisted,
  issuesFromPersistedReasons,
  practicalBatchesFromPersistedResults,
  practicalSchedulesFromPersistedResults,
  roleSwitchAppliedFromPersisted,
  mergeOverrideIntoDecisionTrace,
  theoryAssignmentsFromPersistedResults,
  theoryShortagesFromPersisted,
  validCountFromPersistedSummary,
  practicalSubjectFromBatchOrTrace,
  assignmentsToCalendarEvents,
  examWindowDates,
  examWindowDraftInputs,
  examWindowDraftWouldClearStored,
  normalizeSubject,
  sha256Hex,
  shouldApplySessionAfterApi,
  shouldApplySessionAfterApis,
  pickHydrateExamCycle,
  latestRunForModule,
  latestRunForModuleInCycle,
  latestRunInCycle,
  publishableSiblingRun,
  runsForExamCycle,
  allocationRunsToHydrate,
  allocationRunReasonsFromFetch,
  allocationRunResultsFromFetch,
  mergeAllocationRunsWithLatestPerModule,
  allocationRunBodySchema,
  parseBody,
  validationFindingsFromRunBody,
  type DutyCalendarEvent,
  type ExaminerPairHistory,
  type Teacher,
} from "../shared/src/index.ts";
import {
  allocateHall,
  allocateTheory,
  schedulePractical,
  type TheoryDataset,
  type TheoryRequirement,
} from "../allocation-engine/src/index.ts";
import {
  validatePracticalAllocation,
  validateTheoryAllocation,
} from "../validator/src/index.ts";
import { createSqliteClient } from "../worker/src/db/client.ts";
import { applyMigrations } from "../worker/src/db/migrate.ts";
import {
  assertExamCycleMutable,
  createExamCycle,
  ensureExamCycleIfMissing,
  seedDemoDatasetIfEmpty,
  getExamCycleStatus,
  insertAudit,
  buildCanonicalBackup,
  countMaster,
  listAllocationDecisionReasons,
  listBlocks,
  listExamCycles,
  listRuleVersions,
  listSubjects,
  listExaminerPairs,
  listRuleParameters,
  insertSourceImport,
  insertSourceImportRows,
  insertExportRecord,
  listSourceImports,
  listSourceImportRows,
  listExportRecords,
  listExemptions,
  listAllocationRuns,
  persistAllocationRun,
  persistPracticalBatches,
  recordManualOverride,
  listAllocationRunResults,
  listDutyHistory,
  publishRunToHistory,
  setExamCycleWindow,
  transactionalRestore,
  updateExamCycleStatus,
  upsertExamCycle,
  upsertExemption,
} from "../worker/src/db/repos.ts";
import {
  DefaultAuthAdapter,
  parseEmailRoleMap,
} from "../worker/src/auth/adapter.ts";
import { hasPermission } from "../worker/src/index.ts";

type Check = { id: string; title: string; ok: boolean; detail?: string };

const ROOT = process.cwd();
const checks: Check[] = [];

function record(id: string, title: string, ok: boolean, detail?: string) {
  checks.push({ id, title, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${id} — ${title}${detail ? ` (${detail})` : ""}`,
  );
}

function unusedListenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port =
        addr && typeof addr === "object" ? addr.port : Number.NaN;
      server.close((err) => {
        if (err) reject(err);
        else if (!Number.isFinite(port)) reject(new Error("no listen port"));
        else resolve(port);
      });
    });
  });
}

async function waitForHealth(
  base: string,
  timeoutMs = 20000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      last = await res.text();
      if (res.ok) return JSON.parse(last) as Record<string, unknown>;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`health timeout: ${last}`);
}

async function withLocalApi<T>(
  dbPath: string,
  fn: (base: string) => Promise<T>,
): Promise<T> {
  const port = await unusedListenPort();
  const tsx = join(ROOT, "node_modules/tsx/dist/cli.mjs");
  const child = spawn(
    process.execPath,
    [tsx, join(ROOT, "scripts/local-api-server.ts")],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        API_PORT: String(port),
        SQLITE_PATH: dbPath,
        ENVIRONMENT: "development",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const base = `http://127.0.0.1:${port}`;
  let spawnErr = "";
  child.stderr?.on("data", (chunk) => {
    spawnErr += String(chunk);
  });
  child.stdout?.on("data", (chunk) => {
    spawnErr += String(chunk);
  });
  try {
    await waitForHealth(base);
    if (child.exitCode !== null) {
      throw new Error(
        `local API exited ${child.exitCode}${spawnErr ? `: ${spawnErr.slice(-800)}` : ""}`,
      );
    }
    return await fn(base);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

async function main() {
  mkdirSync(join(ROOT, ".data"), { recursive: true });
  const dbPath = join(ROOT, `.data/uat-local-${Date.now()}.sqlite`);
  const demoPath = join(ROOT, "frontend/public/demo-dataset.json");
  if (!existsSync(demoPath)) {
    console.error(
      "Missing frontend/public/demo-dataset.json — run npm run seed:synthetic",
    );
    process.exit(1);
  }
  const demo = JSON.parse(readFileSync(demoPath, "utf8"));

  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  const db = createSqliteClient(sqlite);
  await applyMigrations(db, ROOT);

  const now = new Date().toISOString();
  for (const b of demo.blocks ?? []) {
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO blocks (block_id, block_code, block_name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run(b.blockId, b.blockCode, b.blockName, now, now);
  }

  const restored = await transactionalRestore(db, demo, {
    adminConfirmed: true,
    includeHistory: true,
  });
  record(
    "UAT-01",
    "Restore synthetic master + history",
    restored.ok,
    restored.ok ? JSON.stringify(restored.counts) : restored.error,
  );
  if (!restored.ok) process.exit(1);

  await upsertExamCycle(db, {
    examCycleId: "ec_uat_local",
    name: "UAT Local Synthetic",
    academicYear: "2027",
    status: "OPEN",
    ruleVersionId: "rv-2027-1",
    createdBy: "uat-local",
  });

  const dataset: TheoryDataset = {
    teachers: demo.teachers,
    schools: demo.schools,
    centres: demo.centres,
    relationships: demo.relationships,
    exemptions: [],
    history: demo.history,
    calendar: [],
    academicYear: "2027",
    asOfDate: "2027-03-01",
  };
  const requirements: TheoryRequirement[] = demo.centres.map(
    (c: { centreId: string }) => ({
      requirementKey: `${c.centreId}-CHIEF`,
      centreId: c.centreId,
      roleCode: "CHIEF_EXAMINATION",
      examDate: "2027-03-15",
      sessionCode: "MORNING" as const,
      preferredDesignations: ["HM", "PRINCIPAL"],
      fallbackDesignations: ["SENIOR_PG"],
    }),
  );

  const result = allocateTheory(requirements, dataset, DEFAULT_RULE_PARAMETERS);
  const validation = validateTheoryAllocation(
    requirements,
    result,
    dataset,
    DEFAULT_RULE_PARAMETERS,
  );
  record(
    "UAT-02",
    "Theory allocate + independent validate",
    validation.status !== "INVALID" && result.assignments.length > 0,
    `assignments=${result.assignments.length} status=${validation.status}`,
  );

  const runId = randomUUID();
  const persisted = await persistAllocationRun(db, {
    runId,
    examCycleId: "ec_uat_local",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: result.algorithmVersion,
    module: "THEORY",
    validationStatus: validation.status,
    createdBy: "uat-local",
    summaryJson: JSON.stringify({ assignments: result.assignments.length }),
    results: result.assignments.map((a) => ({
      resultId: randomUUID(),
      teacherId: a.teacherId,
      centreId: a.centreId,
      dutyTypeCode: a.roleCode,
      roleCode: a.roleCode,
      examDate: a.examDate,
      sessionCode: a.sessionCode,
      score: a.score,
      decisionTraceJson: JSON.stringify(a.decisionTrace),
      usedFallback: a.usedFallbackBand,
    })),
    validationFindings: [
      ...validation.issues.map((i) => ({
        ruleCode: i.ruleCode,
        severity: i.severity,
        message: i.message,
        teacherId: i.teacherId,
        centreId: i.centreId,
        examDate: i.date,
      })),
      ...validation.conflicts.map((c) => ({
        ruleCode: c.ruleCode,
        severity: c.severity,
        message: c.message,
        teacherId: c.teacherId,
        examDate: c.date,
        sessionCode: c.session,
        details: { duties: c.duties },
      })),
    ],
  });
  await updateExamCycleStatus(db, "ec_uat_local", "ALLOCATION_GENERATED", {
    force: true,
  });
  const reasons = await listAllocationDecisionReasons(db, runId);
  record(
    "UAT-03",
    "Persist run + decision reasons",
    persisted.reasonCount > 0 && reasons.length > 0,
    `reasonCount=${persisted.reasonCount}`,
  );

  const pub = await publishRunToHistory(db, runId, "ec_uat_local", "2027");
  record(
    "UAT-04",
    "Publish → immutable history",
    pub.ok === true && pub.ok && pub.published > 0,
    pub.ok ? `published=${pub.published}` : pub.error,
  );

  const republish = await publishRunToHistory(
    db,
    runId,
    "ec_uat_local",
    "2027",
  );
  record(
    "UAT-05",
    "Idempotent republish",
    republish.ok === true &&
      republish.ok &&
      Boolean(republish.alreadyPublished),
    republish.ok
      ? `alreadyPublished=${republish.alreadyPublished}`
      : republish.error,
  );

  const backup = await buildCanonicalBackup(db);
  const checksum = await sha256Hex(JSON.stringify(backup));
  record(
    "UAT-06",
    "Canonical backup includes runs/reasons/audit",
    (backup.allocation_runs?.length ?? 0) > 0 &&
      (backup.allocation_decision_reasons?.length ?? 0) > 0 &&
      checksum.length === 64,
    `runs=${backup.allocation_runs?.length ?? 0} reasons=${backup.allocation_decision_reasons?.length ?? 0}`,
  );

  const counts = await countMaster(db);
  record(
    "UAT-07",
    "Master counts available",
    counts.teachers > 0 && counts.centres > 0 && counts.history > 0,
    JSON.stringify(counts),
  );

  const adapter = new DefaultAuthAdapter();
  const accessViewer = adapter.resolve(
    new Request("https://uat.test/api/me", {
      headers: { "Cf-Access-Authenticated-User-Email": "viewer@uat.example" },
    }),
    "staging",
  );
  record(
    "UAT-08",
    "Access without map defaults VIEWER (no invented roles)",
    accessViewer?.role === "VIEWER",
    accessViewer?.role,
  );

  const mapped = adapter.resolve(
    new Request("https://uat.test/api/me", {
      headers: { "Cf-Access-Authenticated-User-Email": "admin@uat.example" },
    }),
    "production",
    {
      emailRoleMap: parseEmailRoleMap(
        JSON.stringify({ "admin@uat.example": "ADMIN" }),
      ),
    },
  );
  record(
    "UAT-09",
    "ACCESS_EMAIL_ROLE_MAP applies when client provides OQ-010",
    mapped?.role === "ADMIN" && hasPermission("ADMIN", "rules.manage"),
    mapped?.role,
  );

  const spoof = adapter.resolve(
    new Request("https://uat.test/api/me", {
      headers: { "X-Dev-Role": "ADMIN" },
    }),
    "staging",
  );
  record("UAT-10", "Staging refuses X-Dev-Role spoof", spoof === null);

  // Same-DB restore is the real staging/prod DR path (FK child→parent wipe order).
  await persistPracticalBatches(db, {
    examCycleId: "ec_uat_local",
    runId,
    batches: [
      {
        batchId: "uat_pb_1",
        schoolId: demo.schools[0]?.schoolId ?? "s1",
        subjectCode: "PHYSICS",
        studentCount: 30,
        batchIndex: 0,
        examDate: "2027-03-20",
        sessionCode: "MORNING",
        internalExaminerId: demo.teachers[0]?.teacherId,
        externalExaminerId: demo.teachers[1]?.teacherId,
      },
    ],
  });
  const beforeSame = await countMaster(db);
  const sameDb = await transactionalRestore(db, backup, {
    adminConfirmed: true,
    includeHistory: true,
  });
  const afterSame = await countMaster(db);
  record(
    "UAT-11",
    "Same-DB canonical restore (FK-safe overwrite)",
    sameDb.ok === true && afterSame.teachers === beforeSame.teachers,
    sameDb.ok
      ? `teachers=${afterSame.teachers} practicalInBackup=${backup.practical_batches?.length ?? 0}`
      : sameDb.error,
  );

  // Examiner pair memory must survive the cycle boundary and drive the next
  // cycle's role switch (AGENTS rule 9). Both teachers are made eligible for
  // either role because the switch is only observable when they are — see
  // OQ-008 for the real-world eligibility question.
  const pairSchoolId = String(demo.schools[0]?.schoolId ?? "");
  const pairTeachers = [
    (demo.teachers as Teacher[]).find((t) => t.schoolId === pairSchoolId),
    (demo.teachers as Teacher[]).find((t) => t.schoolId !== pairSchoolId),
  ].filter((t): t is Teacher => Boolean(t));
  const pairIds = new Set(pairTeachers.map((t) => t.teacherId));
  const pairDemand = [
    { schoolId: pairSchoolId, subjectId: "PHYSICS", studentCount: 30 },
  ];
  const practicalDataset = (
    pairHistory: ExaminerPairHistory[],
    academicYear: string,
    examDate: string,
  ) => ({
    teachers: pairTeachers,
    exemptions: [],
    calendar: [],
    pairHistory,
    availableDates: [examDate],
    asOfDate: examDate,
    academicYear,
    internalEligible: (t: Teacher) => pairIds.has(t.teacherId),
    externalEligible: (t: Teacher) => pairIds.has(t.teacherId),
  });

  for (const [cycleId, year] of [
    ["ec_uat_prac_2027", "2027"],
    ["ec_uat_prac_2028", "2028"],
  ] as const) {
    await upsertExamCycle(db, {
      examCycleId: cycleId,
      name: `UAT Practical ${year}`,
      academicYear: year,
      status: "OPEN",
      ruleVersionId: "rv-2027-1",
      createdBy: "uat-local",
    });
  }

  const firstCycle = schedulePractical(
    pairDemand,
    practicalDataset([], "2027", "2027-03-25"),
    DEFAULT_RULE_PARAMETERS,
  );
  const firstSchedule = firstCycle.schedules[0];
  const firstPersist = await persistPracticalBatches(db, {
    examCycleId: "ec_uat_prac_2027",
    batches: firstCycle.batches.map((b) => ({
      batchId: `uat_pair_2027_${b.batchIndex}`,
      schoolId: b.schoolId,
      subjectCode: b.subjectId,
      studentCount: b.studentCount,
      batchIndex: b.batchIndex,
      examDate: firstSchedule?.examDate,
      sessionCode: firstSchedule?.sessionCode,
      internalExaminerId: firstSchedule?.internalExaminerId,
      externalExaminerId: firstSchedule?.externalExaminerId,
    })),
  });
  const storedPairs = (await listExaminerPairs(db)) as Array<{
    teacher_a_id: string;
    teacher_b_id: string;
    subject_code: string | null;
    subject_id: string;
    school_id: string;
    academic_year: string;
    internal_teacher_id: string;
    external_teacher_id: string;
    exam_cycle_id: string | null;
  }>;
  record(
    "UAT-12",
    "Practical run persists examiner pair memory with academic year",
    firstPersist.ok === true &&
      firstPersist.ok &&
      firstPersist.pairs === 1 &&
      storedPairs.length === 1 &&
      storedPairs[0]!.academic_year === "2027" &&
      storedPairs[0]!.internal_teacher_id === firstSchedule?.internalExaminerId,
    firstPersist.ok
      ? `pairs=${storedPairs.length} year=${storedPairs[0]?.academic_year} internal=${storedPairs[0]?.internal_teacher_id}`
      : firstPersist.error,
  );

  // Hydration mirrors the UI: persisted subject codes map back onto the
  // subject ids the engine was handed.
  const subjectIdByCode = new Map(
    pairDemand.map((d) => [normalizeSubject(d.subjectId).code, d.subjectId]),
  );
  const hydrated: ExaminerPairHistory[] = storedPairs
    .filter((p) => p.exam_cycle_id !== "ec_uat_prac_2028")
    .map((p) => ({
      teacherAId: p.teacher_a_id,
      teacherBId: p.teacher_b_id,
      subjectId: subjectIdByCode.get(p.subject_code ?? "") ?? p.subject_id,
      schoolId: p.school_id,
      academicYear: p.academic_year,
      internalTeacherId: p.internal_teacher_id,
      externalTeacherId: p.external_teacher_id,
    }));
  const secondCycle = schedulePractical(
    pairDemand,
    practicalDataset(hydrated, "2028", "2028-03-25"),
    DEFAULT_RULE_PARAMETERS,
  );
  const secondSchedule = secondCycle.schedules[0];
  record(
    "UAT-13",
    "Next cycle applies annual role switch from persisted pairs",
    hydrated.length === 1 &&
      secondSchedule?.roleSwitchApplied === true &&
      secondSchedule?.internalExaminerId ===
        firstSchedule?.externalExaminerId &&
      secondSchedule?.externalExaminerId === firstSchedule?.internalExaminerId,
    `history=${hydrated.length} internal ${firstSchedule?.internalExaminerId}→${secondSchedule?.internalExaminerId} switch=${secondSchedule?.roleSwitchApplied}`,
  );

  await persistPracticalBatches(db, {
    examCycleId: "ec_uat_prac_2028",
    batches: secondCycle.batches.map((b) => ({
      batchId: `uat_pair_2028_${b.batchIndex}`,
      schoolId: b.schoolId,
      subjectCode: b.subjectId,
      studentCount: b.studentCount,
      batchIndex: b.batchIndex,
      examDate: secondSchedule?.examDate,
      sessionCode: secondSchedule?.sessionCode,
      internalExaminerId: secondSchedule?.internalExaminerId,
      externalExaminerId: secondSchedule?.externalExaminerId,
    })),
  });
  const bothYears = (await listExaminerPairs(db)) as Array<{
    academic_year: string;
  }>;
  record(
    "UAT-14",
    "Persisting a later cycle keeps earlier pair memory (no history loss)",
    bothYears.length === 2 &&
      bothYears.map((p) => p.academic_year).join(",") === "2028,2027",
    `years=${bothYears.map((p) => p.academic_year).join(",")}`,
  );

  const pairBackup = await buildCanonicalBackup(db);
  const pairRestore = await transactionalRestore(db, pairBackup, {
    adminConfirmed: true,
    includeHistory: true,
  });
  const afterRestore = (await listExaminerPairs(db)) as Array<{
    academic_year: string;
  }>;
  record(
    "UAT-15",
    "Pair memory survives same-DB canonical restore",
    pairRestore.ok === true &&
      (pairBackup.examiner_pairs?.length ?? 0) === 2 &&
      afterRestore.length === 2,
    pairRestore.ok
      ? `backup=${pairBackup.examiner_pairs?.length ?? 0} restored=${afterRestore.length}`
      : pairRestore.error,
  );

  // Cross-module double-booking: hall must respect duties theory already took
  // in the same date + session (OQ-009 interim = hard block).
  const centreSchoolIds = new Map<string, Set<string>>();
  for (const r of demo.relationships as Array<{
    centreId: string;
    schoolId: string;
  }>) {
    const set = centreSchoolIds.get(r.centreId) ?? new Set<string>();
    set.add(r.schoolId);
    centreSchoolIds.set(r.centreId, set);
  }
  const hallDemands = (demo.centres as Array<{ centreId: string }>).map(
    (c, i) => ({
      centreId: c.centreId,
      totalStudents: 80 + ((i * 23) % 140),
      examDate: "2027-03-15",
      sessionCode: "MORNING" as const,
    }),
  );
  const hallDataset = (calendar: DutyCalendarEvent[]) => ({
    teachers: demo.teachers as Teacher[],
    schools: demo.schools,
    centres: demo.centres,
    exemptions: [],
    history: demo.history,
    calendar,
    academicYear: "2027",
    asOfDate: "2027-03-01",
    centreSchoolIds,
  });
  const theoryCalendar = assignmentsToCalendarEvents(
    result.assignments.map((a) => ({
      teacherId: a.teacherId,
      examDate: a.examDate,
      sessionCode: a.sessionCode,
      roleCode: a.roleCode,
      centreId: a.centreId,
    })),
  );
  const theorySlots = new Set(
    theoryCalendar.map((e) => `${e.teacherId}|${e.date}|${e.session}`),
  );
  const clashesFor = (hall: { assignments: Array<Record<string, unknown>> }) =>
    hall.assignments.filter((a) =>
      theorySlots.has(`${a.teacherId}|${a.examDate}|${a.sessionCode}`),
    ).length;
  const hallBlind = allocateHall(
    hallDemands,
    hallDataset([]),
    DEFAULT_RULE_PARAMETERS,
  );
  const hallGuarded = allocateHall(
    hallDemands,
    hallDataset(theoryCalendar),
    DEFAULT_RULE_PARAMETERS,
  );
  record(
    "UAT-16",
    "Hall respects theory duties in the same session (no double-booking)",
    clashesFor(hallBlind) > 0 &&
      clashesFor(hallGuarded) === 0 &&
      hallGuarded.assignments.length > 0,
    `withoutCalendar=${clashesFor(hallBlind)} withCalendar=${clashesFor(hallGuarded)} assignments=${hallGuarded.assignments.length}`,
  );

  // Exam window: an officer-set start/end must reach the engine and survive DR.
  // The window only bounds dates — no timetable is derived from it (OQ-020).
  const windowSet = await setExamCycleWindow(db, "ec_uat_prac_2028", {
    startDate: "2027-04-05",
    endDate: "2027-04-07",
  });
  const windowDates = examWindowDates(
    { startDate: "2027-04-05", endDate: "2027-04-07" },
    5,
    "2027-03-01",
  );
  const storedWindow = (await listExamCycles(db)).find(
    (c) => c.exam_cycle_id === "ec_uat_prac_2028",
  ) as { start_date: string | null; end_date: string | null };
  record(
    "UAT-17",
    "Officer exam window persists and clips the practical date list",
    windowSet.ok === true &&
      storedWindow?.start_date === "2027-04-05" &&
      storedWindow?.end_date === "2027-04-07" &&
      windowDates.length === 3 &&
      windowDates[0] === "2027-04-05" &&
      windowDates[2] === "2027-04-07",
    `stored=${storedWindow?.start_date}→${storedWindow?.end_date} dates=${windowDates.join(",")}`,
  );

  const windowBackup = await buildCanonicalBackup(db);
  await setExamCycleWindow(db, "ec_uat_prac_2028", {
    startDate: null,
    endDate: null,
  });
  const windowRestore = await transactionalRestore(db, windowBackup, {
    adminConfirmed: true,
    includeHistory: true,
  });
  const restoredWindow = (await listExamCycles(db)).find(
    (c) => c.exam_cycle_id === "ec_uat_prac_2028",
  ) as { start_date: string | null; end_date: string | null };
  record(
    "UAT-18",
    "Exam window survives same-DB canonical restore",
    windowRestore.ok === true &&
      restoredWindow?.start_date === "2027-04-05" &&
      restoredWindow?.end_date === "2027-04-07",
    windowRestore.ok
      ? `restored=${restoredWindow?.start_date}→${restoredWindow?.end_date}`
      : windowRestore.error,
  );

  const seedParams = (await listRuleParameters(db, "rv-2027-1")) as Array<{
    param_key: string;
    param_value: string;
    value_type: string;
  }>;
  const appliedSeed = applyStoredRuleParameters(seedParams);
  record(
    "UAT-19",
    "Seed rule_parameters rehydrate to the documented defaults",
    seedParams.length === 18 &&
      appliedSeed.applied.length === 18 &&
      appliedSeed.invalid.length === 0 &&
      appliedSeed.parameters.maximum_distance_km ===
        DEFAULT_RULE_PARAMETERS.maximum_distance_km &&
      appliedSeed.parameters.repeat_years ===
        DEFAULT_RULE_PARAMETERS.repeat_years &&
      appliedSeed.parameters.practical_completion_days ===
        DEFAULT_RULE_PARAMETERS.practical_completion_days,
    `rows=${seedParams.length} applied=${appliedSeed.applied.length}`,
  );

  const hydrateOk = buildHydrateReport({
    teachers: classifyHydrateList({ teachers: [{ id: "t" }] }, [{ id: "t" }]),
    schools: classifyHydrateList({ schools: [] }, []),
    rule_parameters: classifyHydrateList(null, []),
  });
  record(
    "UAT-20",
    "Hydrate report treats a missing API body as failed, not empty",
    hydrateOk.failed.includes("rule_parameters") &&
      hydrateOk.empty.includes("schools") &&
      hydrateOk.ok.includes("teachers"),
    `failed=${hydrateOk.failed.join(",")} empty=${hydrateOk.empty.join(",")}`,
  );

  const listedBlocks = await listBlocks(db);
  const listedSubjects = await listSubjects(db);
  const masterCounts = await countMaster(db);
  const demoBlockCount = Array.isArray(demo.blocks) ? demo.blocks.length : 0;
  record(
    "UAT-21",
    "GET-equivalent listBlocks/listSubjects match D1 after restore",
    listedBlocks.length === masterCounts.blocks &&
      masterCounts.blocks === demoBlockCount &&
      listedSubjects.length === masterCounts.subjects &&
      listedSubjects.length >= 8 &&
      listedSubjects.some((s) => (s as { code: string }).code === "PHY"),
    `blocks=${listedBlocks.length} subjects=${listedSubjects.length}`,
  );

  record(
    "UAT-22",
    "VIEWER has audit.read but not import.apply (GET provenance / POST apply)",
    hasPermission("VIEWER", "audit.read") &&
      !hasPermission("VIEWER", "import.apply") &&
      hasPermission("DATA_OPERATOR", "import.apply"),
  );

  await insertSourceImport(db, {
    importId: "imp_uat_22",
    filename: "uat-teachers.xlsx",
    fileHash: "a".repeat(64),
    uploadedBy: "uat-local",
    status: "UPLOADED",
  });
  const listedImports = await listSourceImports(db);
  record(
    "UAT-23",
    "Source import provenance is listable after upload (GET /api/imports)",
    listedImports.some((i) => (i as { import_id: string }).import_id === "imp_uat_22"),
    `imports=${listedImports.length}`,
  );

  const conflictRunId = "run_uat_conflict_hydrate";
  await persistAllocationRun(db, {
    runId: conflictRunId,
    examCycleId: "ec_uat_local",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "uat-conflict",
    module: "THEORY",
    validationStatus: "INVALID",
    createdBy: "uat-local",
    summaryJson: "{}",
    results: [
      {
        resultId: "res_uat_conflict",
        teacherId: demo.teachers[0]?.teacherId ?? "t1",
        centreId: demo.centres[0]?.centreId ?? "c1",
        dutyTypeCode: "CHIEF_EXAMINATION",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 1,
        decisionTraceJson: "{}",
        usedFallback: false,
      },
    ],
    validationFindings: [
      {
        ruleCode: "RULE-CONFLICT-SESSION",
        severity: "ERROR",
        message: "Teacher has multiple duties in the same date and session",
        teacherId: demo.teachers[0]?.teacherId ?? "t1",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        details: { duties: ["THEORY", "HALL"], source: "conflict-engine" },
      },
    ],
  });
  const conflictReasons = await listAllocationDecisionReasons(
    db,
    conflictRunId,
  );
  const reconstructed = conflictsFromPersistedReasons(
    conflictReasons as Array<{
      rule_code: string;
      severity: string;
      message: string;
      teacher_id: string;
      exam_date: string;
      session_code: string;
      details_json: string | null;
    }>,
  );
  record(
    "UAT-24",
    "Persisted RULE-CONFLICT-* reasons reconstruct the conflict table",
    reconstructed.length === 1 &&
      reconstructed[0]?.ruleCode === "RULE-CONFLICT-SESSION" &&
      reconstructed[0]?.duties.includes("THEORY") &&
      reconstructed[0]?.duties.includes("HALL"),
    `reasons=${conflictReasons.length} reconstructed=${reconstructed.length}`,
  );

  // Audit GET /api/imports and /api/exports read these tables. A fresh-DB
  // restore used to start without them; a same-DB restore left post-snapshot
  // uploads in place. Canonical backup now archives them as a point-in-time set.
  const rowWrite = await insertSourceImportRows(db, "imp_uat_22", [
    { rowNumber: 1, status: "NEW", entityKey: "SYN0001" },
    { rowNumber: 2, status: "UPDATED", entityKey: "SYN0002" },
  ]);
  await insertExportRecord(db, {
    exportId: "exp_uat_25",
    createdBy: "uat-local",
    exportType: "theory-xlsx",
    examCycleId: "ec_uat_local",
  });
  const provenanceBackup = await buildCanonicalBackup(db);
  await insertSourceImport(db, {
    importId: "imp_uat_after_snapshot",
    filename: "stale-after-backup.xlsx",
    fileHash: "b".repeat(64),
    uploadedBy: "uat-local",
    status: "UPLOADED",
  });
  const provenanceRestore = await transactionalRestore(db, provenanceBackup, {
    adminConfirmed: true,
    includeHistory: true,
  });
  const restoredImports = await listSourceImports(db);
  const restoredImportIds = restoredImports.map(
    (i) => (i as { import_id: string }).import_id,
  );
  const restoredRows = await listSourceImportRows(db, "imp_uat_22");
  const restoredExports = await listExportRecords(db);
  record(
    "UAT-25",
    "Same-DB restore reloads import provenance and export receipts",
    rowWrite.ok === true &&
      provenanceRestore.ok === true &&
      restoredImportIds.includes("imp_uat_22") &&
      !restoredImportIds.includes("imp_uat_after_snapshot") &&
      restoredRows.length === 2 &&
      restoredExports.some(
        (e) => (e as { export_id: string }).export_id === "exp_uat_25",
      ) &&
      (provenanceBackup.source_imports?.length ?? 0) >= 1 &&
      (provenanceBackup.source_import_rows?.length ?? 0) === 2 &&
      (provenanceBackup.export_records?.length ?? 0) >= 1,
    provenanceRestore.ok
      ? `imports=${restoredImportIds.length} rows=${restoredRows.length} exports=${restoredExports.length}`
      : provenanceRestore.error,
  );

  const demoHistory = Array.isArray(demo.history) ? demo.history : [];
  const emptyHistory = pickAuthoritativeList("empty", demoHistory, []);
  const failedHistory = pickAuthoritativeList("failed", demoHistory, []);
  record(
    "UAT-26",
    "Empty D1 history is authoritative — demo history is not reused",
    demoHistory.length > 0 &&
      emptyHistory.length === 0 &&
      failedHistory.length === demoHistory.length,
    `demoHistory=${demoHistory.length} emptyPicked=${emptyHistory.length} failedPicked=${failedHistory.length}`,
  );

  const leftoverSnapshot = await buildCanonicalBackup(db);
  sqlite
    .prepare(
      `INSERT INTO subjects (subject_id, code, name, is_practical, active)
       VALUES ('sub_uat_leftover', 'UATLEFT', 'UAT leftover subject', 0, 1)`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO rule_parameters (id, rule_version_id, param_key, param_value, value_type)
       VALUES ('rp_uat_leftover', 'rv-2027-1', 'leftover_soft_weight', '99', 'number')`,
    )
    .run();
  const leftoverRestore = await transactionalRestore(db, leftoverSnapshot, {
    adminConfirmed: true,
    includeHistory: true,
  });
  const subjectsAfterLeftover = await listSubjects(db);
  const paramsAfterLeftover = await listRuleParameters(db, "rv-2027-1");
  record(
    "UAT-27",
    "Same-DB canonical restore drops leftover subjects and rule_parameters",
    leftoverRestore.ok === true &&
      !subjectsAfterLeftover.some(
        (s) => (s as { code: string }).code === "UATLEFT",
      ) &&
      !paramsAfterLeftover.some(
        (p) =>
          (p as { param_key: string }).param_key === "leftover_soft_weight",
      ),
    leftoverRestore.ok
      ? `subjects=${subjectsAfterLeftover.length} params=${paramsAfterLeftover.length}`
      : leftoverRestore.error,
  );

  const cycleSnapshot = await buildCanonicalBackup(db);
  sqlite
    .prepare(
      `INSERT INTO rule_versions
        (rule_version_id, version_label, description, created_at, created_by, is_active)
       VALUES ('rv_uat_leftover', 'uat-leftover.1', 'post-snapshot version', ?, 'uat-local', 0)`,
    )
    .run(new Date().toISOString());
  await upsertExamCycle(db, {
    examCycleId: "ec_uat_leftover",
    name: "UAT leftover cycle",
    academicYear: "2028",
    status: "OPEN",
    ruleVersionId: "rv-2027-1",
    createdBy: "uat-local",
  });
  const cycleRestore = await transactionalRestore(db, cycleSnapshot, {
    adminConfirmed: true,
    includeHistory: true,
  });
  const cyclesAfterLeftover = await listExamCycles(db);
  const versionsAfterLeftover = await listRuleVersions(db);
  record(
    "UAT-28",
    "Same-DB canonical restore drops leftover exam_cycles and rule_versions",
    cycleRestore.ok === true &&
      !cyclesAfterLeftover.some(
        (c) =>
          (c as { exam_cycle_id: string }).exam_cycle_id === "ec_uat_leftover",
      ) &&
      !versionsAfterLeftover.some(
        (v) =>
          (v as { rule_version_id: string }).rule_version_id ===
          "rv_uat_leftover",
      ) &&
      versionsAfterLeftover.some(
        (v) =>
          (v as { rule_version_id: string }).rule_version_id === "rv-2027-1",
      ),
    cycleRestore.ok
      ? `cycles=${cyclesAfterLeftover.length} versions=${versionsAfterLeftover.length}`
      : cycleRestore.error,
  );

  sqlite
    .prepare(
      `INSERT INTO audit_logs
        (audit_id, user_id, action, entity, entity_id, timestamp)
       VALUES ('aud_uat_keep', 'uat-local', 'KEEP', 'exam_cycle', 'ec_keep', ?)`,
    )
    .run(new Date().toISOString());
  const sessionAuditSnapshot = await buildCanonicalBackup(db);
  const sessionAuditRestore = await transactionalRestore(
    db,
    {
      ...sessionAuditSnapshot,
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
  const keptSessionAudit = sqlite
    .prepare(`SELECT audit_id FROM audit_logs WHERE audit_id='aud_uat_keep'`)
    .get();
  const ghostLogin = sqlite
    .prepare(`SELECT action FROM audit_logs WHERE action='LOGIN'`)
    .all();
  record(
    "UAT-29",
    "Session-shaped audit_logs do not wipe persisted GET /api/audit rows",
    sessionAuditRestore.ok === true &&
      Boolean(keptSessionAudit) &&
      ghostLogin.length === 0,
    sessionAuditRestore.ok
      ? `kept=${Boolean(keptSessionAudit)} ghostLogin=${ghostLogin.length}`
      : sessionAuditRestore.error,
  );

  const exemptionMasters = {
    schools: [
      {
        schoolId: "s_uat_ex",
        schoolCode: "SUATEX",
        schoolName: "UAT Exemption School",
        blockId: "b1",
        active: true,
      },
    ],
    centres: [
      {
        centreId: "c_uat_ex",
        centreCode: "CUATEX",
        centreName: "UAT Exemption Centre",
        blockId: "b1",
        active: true,
      },
    ],
    teachers: [
      {
        teacherId: "t_uat_ex",
        employeeCode: "UATEX1",
        name: "UAT Exemption Teacher",
        schoolId: "s_uat_ex",
        designation: "HM",
        isActive: true,
      },
    ],
    relationships: [],
    history: [],
  };
  const exemptionSeed = await transactionalRestore(
    db,
    {
      ...exemptionMasters,
      teacher_exemptions: [
        {
          id: "ex_uat_keep",
          teacherId: "t_uat_ex",
          reason: "UAT keep",
          effectiveFrom: "2027-01-01",
          isExempted: true,
        },
      ],
    },
    { adminConfirmed: true, includeHistory: false },
  );
  const exemptionSnapshot = await buildCanonicalBackup(db);
  sqlite
    .prepare(
      `INSERT INTO teacher_exemptions
        (id, teacher_id, is_exempted, reason, effective_from, created_at, created_by)
       VALUES ('ex_uat_leftover', 't_uat_ex', 1, 'UAT leftover', '2027-06-01', ?, 'uat-local')`,
    )
    .run(new Date().toISOString());
  const exemptionRestore = await transactionalRestore(db, exemptionSnapshot, {
    adminConfirmed: true,
    includeHistory: false,
  });
  const exemptionsAfterLeftover = await listExemptions(db);
  record(
    "UAT-30",
    "Same-DB canonical restore drops leftover teacher_exemptions",
    exemptionSeed.ok === true &&
      exemptionRestore.ok === true &&
      exemptionsAfterLeftover.some(
        (e) => (e as { id: string }).id === "ex_uat_keep",
      ) &&
      !exemptionsAfterLeftover.some(
        (e) => (e as { id: string }).id === "ex_uat_leftover",
      ),
    exemptionRestore.ok
      ? `exemptions=${exemptionsAfterLeftover.length}`
      : exemptionRestore.error,
  );

  const omitRestore = await transactionalRestore(db, exemptionMasters, {
    adminConfirmed: true,
    includeHistory: false,
  });
  const exemptionsAfterOmit = await listExemptions(db);
  const emptyKeyRestore = await transactionalRestore(
    db,
    { ...exemptionMasters, teacher_exemptions: [] },
    { adminConfirmed: true, includeHistory: false },
  );
  const exemptionsAfterEmpty = await listExemptions(db);
  record(
    "UAT-31",
    "Omitting teacher_exemptions leaves live rows; empty key wipes leftovers",
    omitRestore.ok === true &&
      exemptionsAfterOmit.some(
        (e) => (e as { id: string }).id === "ex_uat_keep",
      ) &&
      emptyKeyRestore.ok === true &&
      exemptionsAfterEmpty.length === 0,
    emptyKeyRestore.ok
      ? `omitKept=${exemptionsAfterOmit.length} empty=${exemptionsAfterEmpty.length}`
      : emptyKeyRestore.error,
  );

  const historySeed = await transactionalRestore(
    db,
    {
      ...exemptionMasters,
      teachers: [
        {
          teacherId: "t_uat_ex",
          employeeCode: "UATEX1",
          name: "UAT Exemption Teacher",
          schoolId: "s_uat_ex",
          designation: "HM",
          isActive: true,
        },
      ],
      history: [
        {
          teacherId: "t_uat_ex",
          centreId: "c_uat_ex",
          dutyTypeCode: "CHIEF_EXAMINATION",
          examDate: "2026-03-01",
          sessionCode: "MORNING",
          academicYear: "2026",
        },
      ],
    },
    { adminConfirmed: true, includeHistory: true },
  );
  const historySnapshot = await buildCanonicalBackup(db);
  sqlite
    .prepare(
      `INSERT INTO duty_assignment_history
        (history_id, assignment_id, exam_cycle_id, teacher_id, centre_id, duty_type_code, exam_date, session_code, academic_year, published_at)
       VALUES ('h_uat_leftover', 'a_uat_leftover', 'ec_uat_left', 't_uat_ex', 'c_uat_ex', 'CHIEF_EXAMINATION', '2026-06-01', 'MORNING', '2026', ?)`,
    )
    .run(new Date().toISOString());
  const historyRestore = await transactionalRestore(db, historySnapshot, {
    adminConfirmed: true,
    includeHistory: true,
  });
  const leftoverHistory = sqlite
    .prepare(
      `SELECT history_id FROM duty_assignment_history WHERE history_id='h_uat_leftover'`,
    )
    .get();
  sqlite
    .prepare(
      `INSERT INTO duty_assignment_history
        (history_id, assignment_id, exam_cycle_id, teacher_id, centre_id, duty_type_code, exam_date, session_code, academic_year, published_at)
       VALUES ('h_uat_keep', 'a_uat_keep', 'ec_uat_keep', 't_uat_ex', 'c_uat_ex', 'CHIEF_EXAMINATION', '2026-07-01', 'AFTERNOON', '2026', ?)`,
    )
    .run(new Date().toISOString());
  const preserveRestore = await transactionalRestore(db, historySnapshot, {
    adminConfirmed: true,
    includeHistory: false,
  });
  const keptHistory = sqlite
    .prepare(
      `SELECT history_id FROM duty_assignment_history WHERE history_id='h_uat_keep'`,
    )
    .get();
  const historyCounts = await countMaster(db);
  record(
    "UAT-32",
    "includeHistory=true drops leftover duty_assignment_history; false still preserves",
    historySeed.ok === true &&
      historyRestore.ok === true &&
      leftoverHistory == null &&
      preserveRestore.ok === true &&
      Boolean(keptHistory) &&
      historyCounts.history >= 1,
    historyRestore.ok
      ? `history=${historyCounts.history} leftover=${Boolean(leftoverHistory)} kept=${Boolean(keptHistory)}`
      : historyRestore.error,
  );

  const runMasters = {
    schools: [
      {
        schoolId: "s_uat_run",
        schoolCode: "SUATRN",
        schoolName: "UAT Run School",
        blockId: "b1",
        active: true,
      },
      {
        schoolId: "s_uat_run_b",
        schoolCode: "SUATRNB",
        schoolName: "UAT Run School B",
        blockId: "b1",
        active: true,
      },
    ],
    centres: [
      {
        centreId: "c_uat_run",
        centreCode: "CUATRN",
        centreName: "UAT Run Centre",
        blockId: "b1",
        active: true,
      },
    ],
    teachers: [
      {
        teacherId: "t_uat_run_a",
        employeeCode: "UATRNA",
        name: "UAT Run Teacher A",
        schoolId: "s_uat_run",
        designation: "PG",
        isActive: true,
      },
      {
        teacherId: "t_uat_run_b",
        employeeCode: "UATRNB",
        name: "UAT Run Teacher B",
        schoolId: "s_uat_run_b",
        designation: "PG",
        isActive: true,
      },
    ],
    relationships: [],
    history: [],
  };
  const runSeed = await transactionalRestore(db, runMasters, {
    adminConfirmed: true,
    includeHistory: false,
  });
  await upsertExamCycle(db, {
    examCycleId: "ec_uat_run",
    name: "UAT run leftover",
    academicYear: "2027",
    status: "OPEN",
    ruleVersionId: "rv-2027-1",
    createdBy: "uat-local",
  });
  await persistAllocationRun(db, {
    runId: "run_uat_keep",
    examCycleId: "ec_uat_run",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "theory-1.1.0",
    module: "THEORY",
    validationStatus: "VALID",
    createdBy: "uat-local",
    summaryJson: "{}",
    results: [],
  });
  sqlite
    .prepare(
      `INSERT INTO examiner_pairs
        (pair_id, teacher_a_id, teacher_b_id, subject_id, school_id, academic_year,
         internal_teacher_id, external_teacher_id, exam_cycle_id)
       VALUES ('pair_uat_keep', 't_uat_run_a', 't_uat_run_b', 'sub-phy', 's_uat_run', '2027', 't_uat_run_a', 't_uat_run_b', 'ec_uat_run')`,
    )
    .run();
  const runSnapshot = await buildCanonicalBackup(db);
  sqlite
    .prepare(
      `INSERT INTO allocation_runs
        (run_id, exam_cycle_id, rule_version_id, algorithm_version, module, created_by, created_at, status)
       VALUES ('run_uat_leftover', 'ec_uat_run', 'rv-2027-1', 'leftover', 'THEORY', 'uat-local', ?, 'GENERATED')`,
    )
    .run(new Date().toISOString());
  sqlite
    .prepare(
      `INSERT INTO examiner_pairs
        (pair_id, teacher_a_id, teacher_b_id, subject_id, school_id, academic_year,
         internal_teacher_id, external_teacher_id, exam_cycle_id)
       VALUES ('pair_uat_leftover', 't_uat_run_a', 't_uat_run_b', 'sub-phy', 's_uat_run', '2028', 't_uat_run_a', 't_uat_run_b', 'ec_uat_run')`,
    )
    .run();
  const runCanonicalRestore = await transactionalRestore(db, runSnapshot, {
    adminConfirmed: true,
    includeHistory: false,
  });
  const runsAfterCanonical = await listAllocationRuns(db, "ec_uat_run");
  const pairsAfterCanonical = await listExaminerPairs(db);
  const omitRunRestore = await transactionalRestore(db, runMasters, {
    adminConfirmed: true,
    includeHistory: false,
  });
  const runsAfterOmit = await listAllocationRuns(db, "ec_uat_run");
  const pairsAfterOmit = await listExaminerPairs(db);
  record(
    "UAT-33",
    "Omitting allocation_runs/examiner_pairs leaves live rows; canonical still replaces leftovers",
    runSeed.ok === true &&
      runCanonicalRestore.ok === true &&
      runsAfterCanonical.some(
        (r) => (r as { run_id: string }).run_id === "run_uat_keep",
      ) &&
      !runsAfterCanonical.some(
        (r) => (r as { run_id: string }).run_id === "run_uat_leftover",
      ) &&
      pairsAfterCanonical.some(
        (p) => (p as { pair_id: string }).pair_id === "pair_uat_keep",
      ) &&
      !pairsAfterCanonical.some(
        (p) => (p as { pair_id: string }).pair_id === "pair_uat_leftover",
      ) &&
      omitRunRestore.ok === true &&
      runsAfterOmit.some(
        (r) => (r as { run_id: string }).run_id === "run_uat_keep",
      ) &&
      pairsAfterOmit.some(
        (p) => (p as { pair_id: string }).pair_id === "pair_uat_keep",
      ),
    runCanonicalRestore.ok
      ? `canonicalRuns=${runsAfterCanonical.length} omitRuns=${runsAfterOmit.length} omitPairs=${pairsAfterOmit.length}`
      : runCanonicalRestore.error,
  );

  const hallTeacher = (demo.teachers as Array<{ teacherId: string; employeeCode: string }>)[0];
  const hallTeacherB = (demo.teachers as Array<{ teacherId: string; employeeCode: string }>)[1];
  const hallCentre = (demo.centres as Array<{ centreId: string }>)[0];
  const hallPersist = await persistAllocationRun(db, {
    runId: "run_uat_hall_slots",
    examCycleId: "ec_uat_local",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "hall-1.0.0",
    module: "HALL",
    validationStatus: "VALID",
    createdBy: "uat-local",
    summaryJson: "{}",
    results: [
      {
        resultId: "res_uat_hall_1",
        teacherId: hallTeacher.teacherId,
        centreId: hallCentre.centreId,
        dutyTypeCode: "HALL_INVIGILATOR",
        roleCode: "HALL_INVIGILATOR",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 0,
        decisionTraceJson: JSON.stringify({ slotIndex: 1 }),
        usedFallback: false,
      },
      {
        resultId: "res_uat_hall_0",
        teacherId: hallTeacherB.teacherId,
        centreId: hallCentre.centreId,
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
  const hallListed = (await listAllocationRunResults(
    db,
    "run_uat_hall_slots",
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
  const hallHydrated = hallAssignmentsFromPersistedResults(
    hallListed,
    new Map([
      [hallTeacher.teacherId, hallTeacher.employeeCode],
      [hallTeacherB.teacherId, hallTeacherB.employeeCode],
    ]),
  );
  const hallByTeacher = new Map(hallHydrated.map((a) => [a.teacherId, a]));
  record(
    "UAT-34",
    "Hall hydrate reads persisted slotIndex (not result-array order)",
    hallPersist.reasonCount >= 0 &&
      hallListed.length === 2 &&
      hallByTeacher.get(hallTeacher.teacherId)?.slotIndex === 1 &&
      hallByTeacher.get(hallTeacherB.teacherId)?.slotIndex === 0 &&
      hallByTeacher.get(hallTeacher.teacherId)?.employeeCode ===
        hallTeacher.employeeCode,
    `slots=${hallHydrated.map((a) => a.slotIndex).join(",")} codes=${hallHydrated
      .map((a) => a.employeeCode)
      .join(",")}`,
  );

  const flagTeacher = (
    demo.teachers as Array<{ teacherId: string; employeeCode: string }>
  )[0];
  const flagTeacherB = (
    demo.teachers as Array<{ teacherId: string; employeeCode: string }>
  )[1];
  const flagCentre = (demo.centres as Array<{ centreId: string }>)[0];
  const flagSchool = (demo.schools as Array<{ schoolId: string }>)[0];
  const theoryFlagPersist = await persistAllocationRun(db, {
    runId: "run_uat_theory_fallback",
    examCycleId: "ec_uat_local",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "theory-1.0.0",
    module: "THEORY",
    validationStatus: "VALID_WITH_WARNINGS",
    createdBy: "uat-local",
    summaryJson: JSON.stringify({
      assignments: 2,
      shortages: 1,
      feasible: false,
    }),
    results: [
      {
        resultId: "res_uat_theory_fb_yes",
        teacherId: flagTeacher.teacherId,
        centreId: flagCentre.centreId,
        dutyTypeCode: "CHIEF_EXAMINATION",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 4,
        decisionTraceJson: JSON.stringify({
          teacherId: flagTeacher.teacherId,
          targetId: flagCentre.centreId,
          eligibility: "PASS",
          reasons: [
            {
              ruleCode: "INFO-HM-FALLBACK",
              severity: "WARNING",
              message: "Preferred band shortage; used fallback",
            },
          ],
          score: 4,
          selectedBecause: "fallback band",
        }),
        usedFallback: true,
      },
      {
        resultId: "res_uat_theory_fb_no",
        teacherId: flagTeacherB.teacherId,
        centreId: flagCentre.centreId,
        dutyTypeCode: "CHIEF_EXAMINATION",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-15",
        sessionCode: "AFTERNOON",
        score: 1,
        decisionTraceJson: JSON.stringify({
          teacherId: flagTeacherB.teacherId,
          targetId: flagCentre.centreId,
        }),
        usedFallback: false,
      },
    ],
  });
  const theoryFlagListed = (await listAllocationRunResults(
    db,
    "run_uat_theory_fallback",
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
  const theoryFlagHydrated = theoryAssignmentsFromPersistedResults(
    theoryFlagListed,
    new Map([
      [flagTeacher.teacherId, flagTeacher.employeeCode],
      [flagTeacherB.teacherId, flagTeacherB.employeeCode],
    ]),
  );
  const theoryFlagByTeacher = new Map(
    theoryFlagHydrated.map((a) => [a.teacherId, a]),
  );
  const theoryFeasible = feasibleFromPersistedSummary(
    JSON.stringify({ assignments: 2, shortages: 1, feasible: false }),
    theoryFlagHydrated.length,
  );

  const practicalFlagPersist = await persistAllocationRun(db, {
    runId: "run_uat_practical_switch",
    examCycleId: "ec_uat_local",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "practical-1.0.0",
    module: "PRACTICAL",
    validationStatus: "VALID",
    createdBy: "uat-local",
    summaryJson: JSON.stringify({
      schedules: 2,
      batches: 2,
      feasible: true,
    }),
    results: [
      {
        resultId: "res_uat_prac_switch_yes",
        teacherId: flagTeacher.teacherId,
        centreId: flagSchool.schoolId,
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
        resultId: "res_uat_prac_switch_no",
        teacherId: flagTeacherB.teacherId,
        centreId: flagSchool.schoolId,
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
  const practicalFlagListed = (await listAllocationRunResults(
    db,
    "run_uat_practical_switch",
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
  const practicalSwitchByTeacher = new Map(
    practicalFlagListed.map((row) => [
      row.teacher_id,
      roleSwitchAppliedFromPersisted(row),
    ]),
  );

  const theoryFlagSnapshot = await buildCanonicalBackup(db);
  sqlite
    .prepare(
      `INSERT INTO allocation_run_results
        (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override)
       VALUES ('res_uat_theory_fb_leftover', 'run_uat_theory_fallback', ?, ?, 'CHIEF_EXAMINATION', 'CHIEF_EXAMINATION', '2027-03-16', 'MORNING', 9, '{"usedFallbackBand":true}', 1, 0)`,
    )
    .run(flagTeacher.teacherId, flagCentre.centreId);
  const theoryFlagRestore = await transactionalRestore(db, theoryFlagSnapshot, {
    adminConfirmed: true,
    includeHistory: false,
  });
  const theoryFlagAfterRestore = (await listAllocationRunResults(
    db,
    "run_uat_theory_fallback",
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
  const theoryFlagRestoredHydrated = theoryAssignmentsFromPersistedResults(
    theoryFlagAfterRestore,
  );
  const theoryRestoredByTeacher = new Map(
    theoryFlagRestoredHydrated.map((a) => [a.teacherId, a]),
  );

  record(
    "UAT-35",
    "Theory fallback + practical role-switch hydrate from persisted traces (not invented false)",
    theoryFlagPersist.reasonCount >= 0 &&
      practicalFlagPersist.reasonCount >= 0 &&
      theoryFlagByTeacher.get(flagTeacher.teacherId)?.usedFallbackBand ===
        true &&
      theoryFlagByTeacher.get(flagTeacherB.teacherId)?.usedFallbackBand ===
        false &&
      theoryFeasible === false &&
      practicalSwitchByTeacher.get(flagTeacher.teacherId) === true &&
      practicalSwitchByTeacher.get(flagTeacherB.teacherId) === false &&
      theoryFlagRestore.ok === true &&
      theoryFlagAfterRestore.length === 2 &&
      theoryRestoredByTeacher.get(flagTeacher.teacherId)?.usedFallbackBand ===
        true &&
      theoryRestoredByTeacher.get(flagTeacherB.teacherId)?.usedFallbackBand ===
        false &&
      !theoryFlagAfterRestore.some((r) => r.exam_date === "2027-03-16"),
    `theoryFb=${theoryFlagHydrated.map((a) => a.usedFallbackBand).join(",")} pracSwitch=${[
      practicalSwitchByTeacher.get(flagTeacher.teacherId),
      practicalSwitchByTeacher.get(flagTeacherB.teacherId),
    ].join(",")} restored=${theoryFlagAfterRestore.length} feasible=${theoryFeasible}`,
  );

  const overrideWhyPersist = await persistAllocationRun(db, {
    runId: "run_uat_override_why",
    examCycleId: "ec_uat_local",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "theory-1.0.0",
    module: "THEORY",
    validationStatus: "VALID",
    createdBy: "uat-local",
    summaryJson: JSON.stringify({ assignments: 1, shortages: 0, feasible: true }),
    results: [
      {
        resultId: "res_uat_override_why",
        teacherId: flagTeacher.teacherId,
        centreId: "ctr_uat_override_why",
        dutyTypeCode: "CHIEF_EXAMINATION",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 4,
        decisionTraceJson: JSON.stringify({
          teacherId: flagTeacher.teacherId,
          targetId: "ctr_uat_override_why",
          eligibility: "PASS",
          requirementKey: "ctr_uat_override_why-CHIEF",
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
          score: 4,
        }),
        usedFallback: false,
      },
    ],
  });
  const overrideWhyRecord = await recordManualOverride(db, {
    runId: "run_uat_override_why",
    requirementKey: "ctr_uat_override_why-CHIEF",
    centreId: "ctr_uat_override_why",
    oldTeacherId: flagTeacher.teacherId,
    newTeacherId: flagTeacherB.teacherId,
    reason: "UAT override Why",
    changedBy: "uat-local",
  });
  const overrideWhyListed = (await listAllocationRunResults(
    db,
    "run_uat_override_why",
  )) as Array<{
    result_id?: string;
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
  const overrideWhyHydrated = theoryAssignmentsFromPersistedResults(
    overrideWhyListed,
    new Map([
      [flagTeacher.teacherId, flagTeacher.employeeCode],
      [flagTeacherB.teacherId, flagTeacherB.employeeCode],
    ]),
  );
  const overrideWhyTrace = overrideWhyHydrated[0]?.decisionTrace;
  const overrideWhyReasons = (await listAllocationDecisionReasons(
    db,
    "run_uat_override_why",
  )) as Array<{ rule_code: string; teacher_id: string }>;
  const overrideWhyResultId =
    overrideWhyListed[0]?.result_id ?? "res_uat_override_why";
  for (const [id, code] of [
    ["adr_uat_stale_info_selected", "INFO-SELECTED"],
    ["adr_uat_stale_info_distance", "INFO-DISTANCE"],
    ["adr_uat_stale_info_fairness", "INFO-FAIRNESS"],
    ["adr_uat_stale_info_fallback", "INFO-HM-FALLBACK"],
  ] as const) {
    sqlite
      .prepare(
        `INSERT INTO allocation_decision_reasons
          (id, result_id, rule_code, severity, message, details_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, overrideWhyResultId, code, "INFO", code, null);
  }
  const overrideWhyStaleReasons = (await listAllocationDecisionReasons(
    db,
    "run_uat_override_why",
  )) as Array<{ rule_code: string; teacher_id: string }>;
  const overrideWhyStale = theoryAssignmentsFromPersistedResults(
    [
      {
        teacher_id: flagTeacher.teacherId,
        final_teacher_id: flagTeacherB.teacherId,
        is_override: 1,
        centre_id: "ctr_uat_override_why",
        role_code: "CHIEF_EXAMINATION",
        exam_date: "2027-03-15",
        session_code: "MORNING",
        score: 4,
        decision_trace_json: JSON.stringify({
          teacherId: flagTeacher.teacherId,
          selectedBecause: "lowest eligible fairness score",
          reasons: [
            {
              ruleCode: "INFO-FAIRNESS",
              severity: "INFO",
              message: "Fairness components recent=0 historyCount=1",
            },
            {
              ruleCode: "INFO-SELECTED",
              severity: "INFO",
              message: "Selected because lowest eligible fairness score",
            },
          ],
        }),
      },
    ],
    new Map([[flagTeacherB.teacherId, flagTeacherB.employeeCode]]),
  );
  const overrideWhyMerged = mergeOverrideIntoDecisionTrace(
    JSON.stringify({
      teacherId: flagTeacher.teacherId,
      selectedBecause: "lowest eligible fairness score",
    }),
    {
      newTeacherId: flagTeacherB.teacherId,
      oldTeacherId: flagTeacher.teacherId,
      requirementKey: "ctr_uat_override_why-CHIEF",
      reason: "UAT override Why",
    },
  );
  const overrideWhyLiveOk =
    overrideWhyPersist.reasonCount >= 0 &&
    overrideWhyRecord.ok === true &&
    overrideWhyListed[0]?.final_teacher_id === flagTeacherB.teacherId &&
    overrideWhyTrace?.teacherId === flagTeacherB.teacherId &&
    overrideWhyTrace?.selectedBecause === "manual override" &&
    overrideWhyTrace?.reasons.some((r) => r.ruleCode === "MANUAL_OVERRIDE") ===
      true &&
    overrideWhyTrace?.reasons.some((r) => r.ruleCode.startsWith("INFO-")) !==
      true &&
    overrideWhyReasons.some(
      (r) =>
        r.rule_code === "MANUAL_OVERRIDE" &&
        r.teacher_id === flagTeacherB.teacherId,
    ) &&
    overrideWhyReasons.some((r) => r.rule_code.startsWith("INFO-")) !== true &&
    overrideWhyStaleReasons.some((r) => r.rule_code.startsWith("INFO-")) !==
      true &&
    overrideWhyStale[0]?.decisionTrace.teacherId === flagTeacherB.teacherId &&
    overrideWhyStale[0]?.decisionTrace.selectedBecause === "manual override" &&
    JSON.parse(overrideWhyMerged).teacherId === flagTeacherB.teacherId;

  const overrideRulesPersist = await persistAllocationRun(db, {
    runId: "run_uat_override_rules",
    examCycleId: "ec_uat_local",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "theory-1.0.0",
    module: "THEORY",
    validationStatus: "INVALID",
    createdBy: "uat-local",
    summaryJson: JSON.stringify({ assignments: 1, shortages: 1, feasible: false }),
    results: [
      {
        resultId: "res_uat_override_rules",
        teacherId: flagTeacher.teacherId,
        centreId: "ctr_uat_override_rules",
        dutyTypeCode: "CHIEF_EXAMINATION",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 4,
        decisionTraceJson: JSON.stringify({
          teacherId: flagTeacher.teacherId,
          targetId: "ctr_uat_override_rules",
          eligibility: "PASS",
          requirementKey: "ctr_uat_override_rules-CHIEF",
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
          score: 4,
        }),
        usedFallback: true,
      },
    ],
    validationFindings: [
      {
        ruleCode: "RULE-CONFLICT-SESSION",
        severity: "ERROR",
        message: "Teacher has multiple duties in the same date and session",
        teacherId: flagTeacher.teacherId,
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        details: { duties: ["THEORY", "HALL"], source: "conflict-engine" },
      },
      {
        ruleCode: "RULE-SHORTAGE",
        severity: "ERROR",
        message: "NO FEASIBLE ALLOCATION — other centre",
        details: {
          requirementKey: "c-other-CHIEF",
          required: 1,
          eligible: 0,
          shortage: 1,
        },
      },
    ],
  });
  const overrideRulesRecord = await recordManualOverride(db, {
    runId: "run_uat_override_rules",
    requirementKey: "ctr_uat_override_rules-CHIEF",
    centreId: "ctr_uat_override_rules",
    oldTeacherId: flagTeacher.teacherId,
    newTeacherId: flagTeacherB.teacherId,
    reason: "UAT override generate RULE-*",
    changedBy: "uat-local",
  });
  const overrideRulesReasons = (await listAllocationDecisionReasons(
    db,
    "run_uat_override_rules",
  )) as Array<{ rule_code: string; teacher_id: string }>;
  for (const [id, code] of [
    ["adr_uat_stale_rule_distance", "RULE-THEORY-DISTANCE"],
    ["adr_uat_stale_rule_conflict", "RULE-CONFLICT-SESSION"],
    ["adr_uat_stale_unverified", "UNVERIFIED_HISTORY_USED"],
  ] as const) {
    sqlite
      .prepare(
        `INSERT INTO allocation_decision_reasons
          (id, result_id, rule_code, severity, message, details_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, "res_uat_override_rules", code, "ERROR", code, null);
  }
  const overrideRulesStaleReasons = (await listAllocationDecisionReasons(
    db,
    "run_uat_override_rules",
  )) as Array<{ rule_code: string; teacher_id: string }>;
  const overrideRulesLiveOk =
    overrideRulesPersist.reasonCount >= 0 &&
    overrideRulesRecord.ok === true &&
    overrideRulesReasons.some(
      (r) =>
        r.rule_code === "MANUAL_OVERRIDE" &&
        r.teacher_id === flagTeacherB.teacherId,
    ) &&
    overrideRulesReasons.some(
      (r) => r.rule_code === "RULE-SHORTAGE" && r.teacher_id === "",
    ) === true &&
    overrideRulesReasons.some((r) => r.rule_code === "RULE-THEORY-DISTANCE") !==
      true &&
    overrideRulesReasons.some((r) => r.rule_code.startsWith("RULE-CONFLICT-")) !==
      true &&
    overrideRulesReasons.some((r) => r.rule_code === "UNVERIFIED_HISTORY_USED") !==
      true &&
    overrideRulesReasons.every(
      (r) => r.rule_code === "MANUAL_OVERRIDE" || r.teacher_id !== flagTeacherB.teacherId,
    ) &&
    overrideRulesStaleReasons.some((r) => r.rule_code === "RULE-THEORY-DISTANCE") !==
      true &&
    overrideRulesStaleReasons.some((r) => r.rule_code.startsWith("RULE-CONFLICT-")) !==
      true &&
    overrideRulesStaleReasons.some(
      (r) => r.rule_code === "UNVERIFIED_HISTORY_USED",
    ) !== true;

  const uatTheoryShortages = [
    {
      requirementKey: `${flagCentre.centreId}-CHIEF`,
      required: 1,
      eligible: 0,
      shortage: 1,
      exclusionTallies: { UNKNOWN_CENTRE: 1 },
      message: "NO FEASIBLE ALLOCATION — centre not found",
    },
  ];
  const uatHallShortages = [
    {
      centreId: flagCentre.centreId,
      required: 11,
      eligible: 3,
      shortage: 8,
      message: "NO FEASIBLE ALLOCATION",
    },
  ];
  const theoryShortagePersist = await persistAllocationRun(db, {
    runId: "run_uat_theory_shortage",
    examCycleId: "ec_uat_local",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "theory-1.0.0",
    module: "THEORY",
    validationStatus: "INVALID",
    createdBy: "uat-local",
    summaryJson: JSON.stringify({
      assignments: 1,
      shortages: uatTheoryShortages,
      shortageCount: 1,
      feasible: false,
    }),
    results: [
      {
        resultId: "res_uat_theory_shortage_ok",
        teacherId: flagTeacher.teacherId,
        centreId: flagCentre.centreId,
        dutyTypeCode: "CHIEF_EXAMINATION",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 2,
        decisionTraceJson: JSON.stringify({
          teacherId: flagTeacher.teacherId,
          requirementKey: `${flagCentre.centreId}-CHIEF`,
        }),
        usedFallback: false,
      },
    ],
    validationFindings: [
      {
        ruleCode: "RULE-SHORTAGE",
        severity: "ERROR",
        message: "NO FEASIBLE ALLOCATION — centre not found",
        details: uatTheoryShortages[0],
      },
    ],
  });
  const hallShortagePersist = await persistAllocationRun(db, {
    runId: "run_uat_hall_shortage",
    examCycleId: "ec_uat_local",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "hall-1.0.0",
    module: "HALL",
    validationStatus: "INVALID",
    createdBy: "uat-local",
    summaryJson: JSON.stringify({
      assignments: 0,
      shortages: uatHallShortages,
      shortageCount: 1,
      feasible: false,
    }),
    results: [],
  });
  const shortageRunsBefore = (await listAllocationRuns(
    db,
    "ec_uat_local",
  )) as Array<{ run_id: string; summary_json: string | null }>;
  const theoryShortageReasons = (await listAllocationDecisionReasons(
    db,
    "run_uat_theory_shortage",
  )) as Array<{
    rule_code: string;
    severity: string;
    message: string;
    details_json: string | null;
  }>;
  const theoryShortageHydrated = theoryShortagesFromPersisted(
    shortageRunsBefore.find((r) => r.run_id === "run_uat_theory_shortage")
      ?.summary_json,
    theoryShortageReasons,
  );
  const hallShortageHydrated = hallShortagesFromPersisted(
    shortageRunsBefore.find((r) => r.run_id === "run_uat_hall_shortage")
      ?.summary_json,
  );
  const countOnlyInvented = theoryShortagesFromPersisted(
    JSON.stringify({ assignments: 1, shortages: 1, feasible: false }),
  );
  const persistedIssueErrors = issuesFromPersistedReasons(
    theoryShortageReasons,
  ).filter((i) => i.severity === "ERROR").length;
  const theoryShortageListed = (await listAllocationRunResults(
    db,
    "run_uat_theory_shortage",
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
  const theoryShortageKey =
    theoryAssignmentsFromPersistedResults(theoryShortageListed)[0]
      ?.requirementKey;

  const shortageSnapshot = await buildCanonicalBackup(db);
  sqlite
    .prepare(
      `INSERT INTO allocation_run_results
        (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override)
       VALUES ('res_uat_theory_shortage_leftover', 'run_uat_theory_shortage', ?, ?, 'CHIEF_EXAMINATION', 'CHIEF_EXAMINATION', '2027-03-16', 'MORNING', 9, '{}', 1, 0)`,
    )
    .run(flagTeacher.teacherId, flagCentre.centreId);
  const shortageRestore = await transactionalRestore(db, shortageSnapshot, {
    adminConfirmed: true,
    includeHistory: false,
  });
  const shortageRunsAfter = (await listAllocationRuns(
    db,
    "ec_uat_local",
  )) as Array<{ run_id: string; summary_json: string | null }>;
  const theoryShortageAfterRestore = (await listAllocationRunResults(
    db,
    "run_uat_theory_shortage",
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
  const theoryShortageRestored = theoryShortagesFromPersisted(
    shortageRunsAfter.find((r) => r.run_id === "run_uat_theory_shortage")
      ?.summary_json,
  );
  const hallShortageRestored = hallShortagesFromPersisted(
    shortageRunsAfter.find((r) => r.run_id === "run_uat_hall_shortage")
      ?.summary_json,
  );

  record(
    "UAT-36",
    "Theory/hall shortage objects + requirementKey hydrate from persisted JSON (not invented empty/count)",
    theoryShortagePersist.reasonCount >= 1 &&
      hallShortagePersist.reasonCount >= 0 &&
      theoryShortageHydrated.length === 1 &&
      theoryShortageHydrated[0]?.requirementKey ===
        `${flagCentre.centreId}-CHIEF` &&
      theoryShortageHydrated[0]?.required === 1 &&
      theoryShortageHydrated[0]?.eligible === 0 &&
      theoryShortageHydrated[0]?.shortage === 1 &&
      hallShortageHydrated[0]?.required === 11 &&
      hallShortageHydrated[0]?.eligible === 3 &&
      countOnlyInvented.length === 0 &&
      persistedIssueErrors >= 1 &&
      theoryShortageKey === `${flagCentre.centreId}-CHIEF` &&
      shortageRestore.ok === true &&
      theoryShortageAfterRestore.length === 1 &&
      theoryShortageRestored[0]?.requirementKey ===
        `${flagCentre.centreId}-CHIEF` &&
      hallShortageRestored[0]?.shortage === 8 &&
      !theoryShortageAfterRestore.some((r) => r.exam_date === "2027-03-16"),
    `theory=${theoryShortageHydrated.length} hall=${hallShortageHydrated.length} key=${theoryShortageKey} errors=${persistedIssueErrors} restored=${theoryShortageAfterRestore.length}`,
  );

  const practicalIdentityPersist = await persistAllocationRun(db, {
    runId: "run_uat_practical_identity",
    examCycleId: "ec_uat_local",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "practical-1.0.0",
    module: "PRACTICAL",
    validationStatus: "VALID",
    createdBy: "uat-local",
    summaryJson: JSON.stringify({
      schedules: 2,
      batches: 2,
      feasible: true,
    }),
    results: [
      {
        resultId: "res_uat_prac_id_phy",
        teacherId: flagTeacher.teacherId,
        centreId: flagSchool.schoolId,
        dutyTypeCode: "PRACTICAL_INTERNAL",
        roleCode: "PRACTICAL_INTERNAL",
        examDate: "2027-03-01",
        sessionCode: "MORNING",
        score: 0,
        decisionTraceJson: JSON.stringify({
          batchKey: `${flagSchool.schoolId}|PHYSICS|1`,
          schoolId: flagSchool.schoolId,
          subjectId: "PHYSICS",
          externalExaminerId: flagTeacherB.teacherId,
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
        resultId: "res_uat_prac_id_che",
        teacherId: flagTeacherB.teacherId,
        centreId: flagSchool.schoolId,
        dutyTypeCode: "PRACTICAL_INTERNAL",
        roleCode: "PRACTICAL_INTERNAL",
        examDate: "2027-03-01",
        sessionCode: "AFTERNOON",
        score: 0,
        decisionTraceJson: JSON.stringify({
          batchKey: `${flagSchool.schoolId}|CHEMISTRY|1`,
          schoolId: flagSchool.schoolId,
          subjectId: "CHEMISTRY",
          externalExaminerId: flagTeacher.teacherId,
          decisionNotes: [],
          roleSwitchApplied: false,
          batchIndex: 1,
          studentCount: 35,
        }),
        usedFallback: false,
      },
    ],
  });
  const practicalIdentityListed = (await listAllocationRunResults(
    db,
    "run_uat_practical_identity",
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
  const practicalIdentityHydrated = practicalSchedulesFromPersistedResults(
    practicalIdentityListed,
  );
  const practicalIdentityBatches = practicalBatchesFromPersistedResults(
    practicalIdentityListed,
  );
  const identityByInternal = new Map(
    practicalIdentityHydrated.map((s) => [s.internalExaminerId, s]),
  );
  const notesOnlyInvented = practicalSchedulesFromPersistedResults([
    {
      teacher_id: flagTeacher.teacherId,
      centre_id: flagSchool.schoolId,
      role_code: "PRACTICAL_INTERNAL",
      exam_date: "2027-03-01",
      session_code: "MORNING",
      score: 0,
      decision_trace_json: JSON.stringify([
        "Applied annual role switch from academic year 2026",
      ]),
    },
  ]);

  const practicalIdentitySnapshot = await buildCanonicalBackup(db);
  sqlite
    .prepare(
      `INSERT INTO allocation_run_results
        (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override)
       VALUES ('res_uat_prac_id_leftover', 'run_uat_practical_identity', ?, ?, 'PRACTICAL_INTERNAL', 'PRACTICAL_INTERNAL', '2027-03-16', 'MORNING', 9, '{"subjectId":"UNK"}', 1, 0)`,
    )
    .run(flagTeacher.teacherId, flagSchool.schoolId);
  const practicalIdentityRestore = await transactionalRestore(
    db,
    practicalIdentitySnapshot,
    { adminConfirmed: true, includeHistory: false },
  );
  const practicalIdentityAfterRestore = (await listAllocationRunResults(
    db,
    "run_uat_practical_identity",
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
  const practicalIdentityRestored = practicalSchedulesFromPersistedResults(
    practicalIdentityAfterRestore,
  );
  const restoredByInternal = new Map(
    practicalIdentityRestored.map((s) => [s.internalExaminerId, s]),
  );

  record(
    "UAT-37",
    "Practical batch/subject/external hydrate from persisted traces (not invented UNK)",
    practicalIdentityPersist.reasonCount >= 0 &&
      identityByInternal.get(flagTeacher.teacherId)?.subjectId === "PHYSICS" &&
      identityByInternal.get(flagTeacher.teacherId)?.batchKey ===
        `${flagSchool.schoolId}|PHYSICS|1` &&
      identityByInternal.get(flagTeacher.teacherId)?.externalExaminerId ===
        flagTeacherB.teacherId &&
      identityByInternal.get(flagTeacher.teacherId)?.roleSwitchApplied ===
        true &&
      identityByInternal.get(flagTeacherB.teacherId)?.subjectId ===
        "CHEMISTRY" &&
      identityByInternal.get(flagTeacherB.teacherId)?.externalExaminerId ===
        flagTeacher.teacherId &&
      practicalIdentityBatches.length === 2 &&
      practicalIdentityBatches[0]?.studentCount === 40 &&
      notesOnlyInvented[0]?.subjectId === "" &&
      notesOnlyInvented[0]?.subjectId !== "UNK" &&
      notesOnlyInvented[0]?.batchKey === "" &&
      notesOnlyInvented[0]?.externalExaminerId === "" &&
      practicalIdentityRestore.ok === true &&
      practicalIdentityAfterRestore.length === 2 &&
      restoredByInternal.get(flagTeacher.teacherId)?.subjectId === "PHYSICS" &&
      restoredByInternal.get(flagTeacher.teacherId)?.externalExaminerId ===
        flagTeacherB.teacherId &&
      !practicalIdentityAfterRestore.some((r) => r.exam_date === "2027-03-16") &&
      !practicalIdentityRestored.some((s) => s.subjectId === "UNK"),
    `subjects=${practicalIdentityHydrated.map((s) => s.subjectId).join(",")} ext=${practicalIdentityHydrated
      .map((s) => s.externalExaminerId)
      .join(",")} batches=${practicalIdentityBatches.length} restored=${practicalIdentityAfterRestore.length}`,
  );

  const leftoverUnkSkipped =
    practicalSubjectFromBatchOrTrace(
      { subject_code: "UNK", subject_id: "UNK" },
      "PHYSICS",
    ) === "PHYSICS" &&
    practicalSubjectFromBatchOrTrace({ subject_code: "UNK" }, "") === "" &&
    practicalSubjectFromBatchOrTrace({ subject_code: "UNK" }, "") !== "UNK";

  const validCountPersist = await persistAllocationRun(db, {
    runId: "run_uat_validation_valid",
    examCycleId: "ec_uat_local",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "theory-1.0.0",
    module: "THEORY",
    validationStatus: "INVALID",
    createdBy: "uat-local",
    summaryJson: JSON.stringify({
      assignments: 3,
      valid: 1,
      warnings: 1,
      errors: 2,
      feasible: false,
    }),
    results: [
      {
        resultId: "res_uat_valid_a",
        teacherId: flagTeacher.teacherId,
        centreId: flagCentre.centreId,
        dutyTypeCode: "CHIEF_EXAMINATION",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 2,
        decisionTraceJson: JSON.stringify({
          teacherId: flagTeacher.teacherId,
          requirementKey: `${flagCentre.centreId}-CHIEF`,
        }),
        usedFallback: false,
      },
      {
        resultId: "res_uat_valid_b",
        teacherId: flagTeacherB.teacherId,
        centreId: flagCentre.centreId,
        dutyTypeCode: "CHIEF_EXAMINATION",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-15",
        sessionCode: "AFTERNOON",
        score: 1,
        decisionTraceJson: JSON.stringify({
          teacherId: flagTeacherB.teacherId,
          requirementKey: `${flagCentre.centreId}-ASST`,
        }),
        usedFallback: false,
      },
    ],
  });
  const validCountRuns = (await listAllocationRuns(
    db,
    "ec_uat_local",
  )) as Array<{ run_id: string; summary_json: string | null }>;
  const validCountSummary = validCountRuns.find(
    (r) => r.run_id === "run_uat_validation_valid",
  )?.summary_json;
  const validCountHydrated = validCountFromPersistedSummary(validCountSummary);
  const validCountInvented = validCountFromPersistedSummary(
    JSON.stringify({ assignments: 3, errors: 2, feasible: false }),
  );
  const validCountSnapshot = await buildCanonicalBackup(db);
  sqlite
    .prepare(
      `INSERT INTO allocation_run_results
        (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override)
       VALUES ('res_uat_valid_leftover', 'run_uat_validation_valid', ?, ?, 'CHIEF_EXAMINATION', 'CHIEF_EXAMINATION', '2027-03-16', 'MORNING', 9, '{}', 1, 0)`,
    )
    .run(flagTeacher.teacherId, flagCentre.centreId);
  const validCountRestore = await transactionalRestore(db, validCountSnapshot, {
    adminConfirmed: true,
    includeHistory: false,
  });
  const validCountAfterRestore = (await listAllocationRuns(
    db,
    "ec_uat_local",
  )) as Array<{ run_id: string; summary_json: string | null }>;
  const validCountRestored = validCountFromPersistedSummary(
    validCountAfterRestore.find((r) => r.run_id === "run_uat_validation_valid")
      ?.summary_json,
  );
  const validCountResultsAfter = (await listAllocationRunResults(
    db,
    "run_uat_validation_valid",
  )) as Array<{ exam_date: string }>;

  record(
    "UAT-38",
    "Validation Valid + leftover UNK subject hydrate from persist (not invented row-count/UNK)",
    leftoverUnkSkipped &&
      validCountPersist.reasonCount >= 0 &&
      validCountHydrated === 1 &&
      validCountInvented === undefined &&
      validCountRestore.ok === true &&
      validCountRestored === 1 &&
      validCountResultsAfter.length === 2 &&
      !validCountResultsAfter.some((r) => r.exam_date === "2027-03-16"),
    `valid=${validCountHydrated} invented=${validCountInvented} leftoverUnkSkipped=${leftoverUnkSkipped} restored=${validCountRestored} rows=${validCountResultsAfter.length}`,
  );

  await updateExamCycleStatus(db, "ec_uat_local", "PUBLISHED", { force: true });
  const frozenClub = await assertExamCycleMutable(
    db,
    "ec_uat_local",
    "apply clubbing",
  );
  const frozenCapacity = await assertExamCycleMutable(
    db,
    "ec_uat_local",
    "update centre capacity",
  );
  const frozenOverride = await assertExamCycleMutable(
    db,
    "ec_uat_local",
    "override",
  );
  const frozenGenerate = await assertExamCycleMutable(
    db,
    "ec_uat_local",
    "generate allocation",
  );
  const frozenImport = await assertExamCycleMutable(
    db,
    "ec_uat_local",
    "apply import",
  );
  record(
    "UAT-39",
    "Frozen cycle blocks clubbing, capacity, override, and generate (live path)",
    frozenClub.ok === false &&
      frozenCapacity.ok === false &&
      frozenOverride.ok === false &&
      frozenGenerate.ok === false,
    `club=${frozenClub.ok} cap=${frozenCapacity.ok} ov=${frozenOverride.ok} gen=${frozenGenerate.ok}`,
  );
  record(
    "UAT-40",
    "Frozen cycle blocks import apply when examCycleId is sent (live path)",
    frozenImport.ok === false,
    `import=${frozenImport.ok}`,
  );

  const bootAgain = await ensureExamCycleIfMissing(db, {
    examCycleId: "ec_uat_local",
    name: "Boot clobber",
    academicYear: "2099",
    status: "OPEN",
    ruleVersionId: "rv-2027-1",
    createdBy: "boot",
  });
  const statusAfterBoot = await getExamCycleStatus(db, "ec_uat_local");
  const replacePublished = await createExamCycle(db, {
    examCycleId: "ec_uat_local",
    name: "Create clobber",
    academicYear: "2027",
    ruleVersionId: "rv-2027-1",
    createdBy: "uat",
    status: "OPEN",
  });
  record(
    "UAT-41",
    "Local boot / create do not reset a PUBLISHED cycle",
    bootAgain.created === false &&
      statusAfterBoot === "PUBLISHED" &&
      replacePublished.ok === false,
    `bootCreated=${bootAgain.created} status=${statusAfterBoot} replace=${replacePublished.ok}`,
  );

  const seedSqlite = new Database(":memory:");
  seedSqlite.pragma("foreign_keys = ON");
  const seedDb = createSqliteClient(seedSqlite);
  await applyMigrations(seedDb, ROOT);
  await upsertExamCycle(seedDb, {
    examCycleId: "ec_seed_published",
    name: "Published before demo seed",
    academicYear: "2027",
    status: "PUBLISHED",
    ruleVersionId: "rv-2027-1",
    createdBy: "uat",
  });
  const seedNow = new Date().toISOString();
  seedSqlite
    .prepare(
      `INSERT INTO duty_assignment_history
        (history_id, assignment_id, exam_cycle_id, teacher_id, duty_type_code, exam_date, session_code, academic_year, published_at)
       VALUES ('h_seed_keep', 'a_seed_keep', 'ec_seed_published', 't_gone', 'CHIEF_EXAMINATION', '2027-03-15', 'MORNING', '2027', ?)`,
    )
    .run(seedNow);
  const demoSeed = await seedDemoDatasetIfEmpty(seedDb, demo);
  const seedStatus = await getExamCycleStatus(seedDb, "ec_seed_published");
  const seedHistory = seedSqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM duty_assignment_history WHERE history_id = 'h_seed_keep'`,
    )
    .get() as { n: number };
  const seedTeachers = seedSqlite
    .prepare(`SELECT COUNT(*) AS n FROM teachers`)
    .get() as { n: number };
  seedSqlite.close();
  record(
    "UAT-42",
    "Demo seed does not remaster a PUBLISHED cycle or wipe leftover history",
    demoSeed.seeded === false &&
      seedStatus === "PUBLISHED" &&
      seedHistory.n === 1 &&
      seedTeachers.n === 0,
    `seeded=${demoSeed.seeded} reason=${"reason" in demoSeed ? demoSeed.reason : ""} status=${seedStatus} hist=${seedHistory.n} teachers=${seedTeachers.n}`,
  );

  const blockSqlite = new Database(":memory:");
  blockSqlite.pragma("foreign_keys = ON");
  const blockDb = createSqliteClient(blockSqlite);
  await applyMigrations(blockDb, ROOT);
  const blockNow = new Date().toISOString();
  blockSqlite
    .prepare(
      `INSERT INTO blocks (block_id, block_code, block_name, active, created_at, updated_at)
       VALUES ('blk_uat_keep', 'BU', 'UAT leftover geography', 1, ?, ?)`,
    )
    .run(blockNow, blockNow);
  const blockSeed = await seedDemoDatasetIfEmpty(blockDb, demo);
  const blockRow = blockSqlite
    .prepare(
      `SELECT block_id, block_name FROM blocks WHERE block_id = 'blk_uat_keep'`,
    )
    .get() as { block_id: string; block_name: string } | undefined;
  const blockTeachers = blockSqlite
    .prepare(`SELECT COUNT(*) AS n FROM teachers`)
    .get() as { n: number };
  blockSqlite.close();
  record(
    "UAT-43",
    "Demo seed does not remaster leftover officer blocks when masters are empty",
    blockSeed.seeded === false &&
      blockRow?.block_id === "blk_uat_keep" &&
      blockRow.block_name === "UAT leftover geography" &&
      blockTeachers.n === 0,
    `seeded=${blockSeed.seeded} reason=${"reason" in blockSeed ? blockSeed.reason : ""} block=${blockRow?.block_name ?? "missing"} teachers=${blockTeachers.n}`,
  );

  const snapSqlite = new Database(":memory:");
  snapSqlite.pragma("foreign_keys = ON");
  const snapDb = createSqliteClient(snapSqlite);
  await applyMigrations(snapDb, ROOT);
  const snapNow = new Date().toISOString();
  snapSqlite
    .prepare(
      `INSERT INTO input_snapshots (snapshot_id, payload_hash, created_at)
       VALUES ('snap_uat_keep', ?, ?)`,
    )
    .run("c".repeat(64), snapNow);
  snapSqlite
    .prepare(
      `INSERT INTO source_imports
        (import_id, filename, file_hash, uploaded_by, uploaded_at, status)
       VALUES ('imp_uat_keep', 'officer.xlsx', ?, 'officer', ?, 'UPLOADED')`,
    )
    .run("d".repeat(64), snapNow);
  snapSqlite
    .prepare(
      `INSERT INTO export_records (export_id, created_at, created_by, export_type)
       VALUES ('exp_uat_keep', ?, 'officer', 'theory-xlsx')`,
    )
    .run(snapNow);
  snapSqlite
    .prepare(
      `INSERT INTO audit_logs (audit_id, user_id, action, entity, timestamp)
       VALUES ('aud_uat_keep', 'officer', 'IMPORT', 'source_import', ?)`,
    )
    .run(snapNow);
  const afterMigrateEmpty = new Database(":memory:");
  afterMigrateEmpty.pragma("foreign_keys = ON");
  const afterMigrateDb = createSqliteClient(afterMigrateEmpty);
  await applyMigrations(afterMigrateDb, ROOT);
  const emptyProv = afterMigrateEmpty
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
  const firstBootSeed = await seedDemoDatasetIfEmpty(afterMigrateDb, demo);
  afterMigrateEmpty.close();
  const snapSeed = await seedDemoDatasetIfEmpty(snapDb, demo);
  const snapRow = snapSqlite
    .prepare(
      `SELECT snapshot_id FROM input_snapshots WHERE snapshot_id = 'snap_uat_keep'`,
    )
    .get() as { snapshot_id: string } | undefined;
  const snapTeachers = snapSqlite
    .prepare(`SELECT COUNT(*) AS n FROM teachers`)
    .get() as { n: number };
  snapSqlite.close();
  record(
    "UAT-44",
    "Demo seed does not remaster leftover officer provenance when masters are empty",
    emptyProv.snapshots === 0 &&
      emptyProv.imports === 0 &&
      emptyProv.exports === 0 &&
      emptyProv.audit === 0 &&
      firstBootSeed.seeded === true &&
      snapSeed.seeded === false &&
      snapRow?.snapshot_id === "snap_uat_keep" &&
      snapTeachers.n === 0,
    `empty=${JSON.stringify(emptyProv)} firstBoot=${firstBootSeed.seeded} seeded=${snapSeed.seeded} reason=${"reason" in snapSeed ? snapSeed.reason : ""} snap=${snapRow?.snapshot_id ?? "missing"} teachers=${snapTeachers.n}`,
  );

  const sessionSqlite = new Database(":memory:");
  sessionSqlite.pragma("foreign_keys = ON");
  const sessionDb = createSqliteClient(sessionSqlite);
  await applyMigrations(sessionDb, ROOT);
  sessionSqlite
    .prepare(
      `INSERT INTO audit_logs (audit_id, action, timestamp)
       VALUES ('', 'LOGIN', ?)`,
    )
    .run(new Date().toISOString());
  const sessionSeed = await seedDemoDatasetIfEmpty(sessionDb, demo);
  const sessionTeachers = sessionSqlite
    .prepare(`SELECT COUNT(*) AS n FROM teachers`)
    .get() as { n: number };
  sessionSqlite.close();
  const persistAudSqlite = new Database(":memory:");
  persistAudSqlite.pragma("foreign_keys = ON");
  const persistAudDb = createSqliteClient(persistAudSqlite);
  await applyMigrations(persistAudDb, ROOT);
  await insertAudit(persistAudDb, {
    auditId: "aud_uat_block",
    userId: "officer",
    action: "IMPORT",
    entity: "source_import",
    entityId: "imp_gone",
  });
  const persistAudSeed = await seedDemoDatasetIfEmpty(persistAudDb, demo);
  const persistAudTeachers = persistAudSqlite
    .prepare(`SELECT COUNT(*) AS n FROM teachers`)
    .get() as { n: number };
  persistAudSqlite.close();
  record(
    "UAT-45",
    "Empty / session-shaped audit_logs do not block first-boot demo seed; persisted audit does",
    sessionSeed.seeded === true &&
      sessionTeachers.n > 0 &&
      persistAudSeed.seeded === false &&
      persistAudTeachers.n === 0,
    `session=${sessionSeed.seeded} sessionTeachers=${sessionTeachers.n} persist=${persistAudSeed.seeded} reason=${"reason" in persistAudSeed ? persistAudSeed.reason : ""} persistTeachers=${persistAudTeachers.n}`,
  );

  const httpDbPath = join(ROOT, `.data/uat-seed-prov-${Date.now()}.sqlite`);
  const httpSqlite = new Database(httpDbPath);
  httpSqlite.pragma("foreign_keys = ON");
  const httpDb = createSqliteClient(httpSqlite);
  await applyMigrations(httpDb, ROOT);
  httpSqlite
    .prepare(
      `INSERT INTO input_snapshots (snapshot_id, payload_hash, created_at)
       VALUES ('snap_uat_http', ?, ?)`,
    )
    .run("e".repeat(64), new Date().toISOString());
  httpSqlite.close();
  let httpTeachers = -1;
  let httpSnap = "";
  let httpErr = "";
  try {
    const health = await withLocalApi(httpDbPath, async (base) => {
      const teachersRes = await fetch(`${base}/api/teachers`, {
        headers: { "x-dev-role": "OFFICER" },
      });
      const teachersBody = (await teachersRes.json()) as {
        teachers?: unknown[];
      };
      httpTeachers = teachersBody.teachers?.length ?? -1;
      return waitForHealth(base);
    });
    const counts = health.counts as { teachers?: number } | undefined;
    if (typeof counts?.teachers === "number") httpTeachers = counts.teachers;
    const after = new Database(httpDbPath);
    httpSnap =
      (
        after
          .prepare(
            `SELECT snapshot_id FROM input_snapshots WHERE snapshot_id = 'snap_uat_http'`,
          )
          .get() as { snapshot_id: string } | undefined
      )?.snapshot_id ?? "";
    after.close();
  } catch (e) {
    httpErr = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      unlinkSync(httpDbPath);
    } catch {
      /* ignore */
    }
    for (const suffix of ["-wal", "-shm"]) {
      try {
        unlinkSync(httpDbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  }
  record(
    "UAT-46",
    "HTTP API boot does not remaster leftover snapshots onto demo teachers",
    httpTeachers === 0 && httpSnap === "snap_uat_http" && httpErr === "",
    `teachers=${httpTeachers} snap=${httpSnap || "missing"} err=${httpErr || "none"}`,
  );

  const httpFrozenPath = join(ROOT, `.data/uat-frozen-409-${Date.now()}.sqlite`);
  let ovStatus = -1;
  let ovConflict = false;
  let persistAccepted: boolean | undefined;
  let persistStatus = -1;
  let windowStatus = -1;
  let pubStatus = -1;
  let importStatus = -1;
  let importOk: boolean | undefined;
  let importConflict = false;
  let clubStatus = -1;
  let clubConflict = false;
  let capStatus = -1;
  let capConflict = false;
  let illegalStatus = -1;
  let illegalOk: boolean | undefined;
  let sessionHelperOk = false;
  let frozenHttpErr = "";
  try {
    await withLocalApi(httpFrozenPath, async (base) => {
      const hdrs = {
        "content-type": "application/json",
        "x-dev-role": "ADMIN",
        "x-dev-email": "admin@example.local",
      };
      const created = await fetch(`${base}/api/exam-cycles`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          examCycleId: "ec_uat_http_frozen",
          name: "UAT HTTP frozen",
          academicYear: "2027",
          ruleVersionId: "rv-2027-1",
          status: "OPEN",
        }),
      });
      if (!created.ok) {
        throw new Error(`create cycle ${created.status}`);
      }
      const persisted = await fetch(`${base}/api/allocation-runs`, {
        method: "POST",
        headers: { ...hdrs, "x-dev-role": "OFFICER" },
        body: JSON.stringify({
          runId: "run_uat_http_frozen",
          examCycleId: "ec_uat_http_frozen",
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
      const persistedBody = (await persisted.json()) as { accepted?: boolean };
      if (persisted.status !== 200 || persistedBody.accepted !== true) {
        throw new Error(`persist open ${persisted.status}`);
      }
      const published = await fetch(
        `${base}/api/exam-cycles/ec_uat_http_frozen/status`,
        {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({ status: "PUBLISHED", force: true }),
        },
      );
      if (!published.ok) throw new Error(`publish status ${published.status}`);

      const ov = await fetch(`${base}/api/manual-overrides`, {
        method: "POST",
        headers: { ...hdrs, "x-dev-role": "OFFICER" },
        body: JSON.stringify({
          runId: "run_uat_http_frozen",
          requirementKey: "c1-CHIEF",
          centreId: "c1",
          oldTeacherId: "t1",
          newTeacherId: "t2",
          reason: "stale UI",
        }),
      });
      ovStatus = ov.status;
      const ovBody = (await ov.json()) as { conflict?: boolean };
      ovConflict = ovBody.conflict === true;

      const persistFrozen = await fetch(`${base}/api/allocation-runs`, {
        method: "POST",
        headers: { ...hdrs, "x-dev-role": "OFFICER" },
        body: JSON.stringify({
          runId: "run_uat_http_frozen_2",
          examCycleId: "ec_uat_http_frozen",
          module: "THEORY",
        }),
      });
      persistStatus = persistFrozen.status;
      const persistBody = (await persistFrozen.json()) as {
        accepted?: boolean;
      };
      persistAccepted = persistBody.accepted;

      const win = await fetch(
        `${base}/api/exam-cycles/ec_uat_http_frozen/window`,
        {
          method: "POST",
          headers: { ...hdrs, "x-dev-role": "OFFICER" },
          body: JSON.stringify({
            startDate: "2027-04-01",
            endDate: "2027-04-05",
          }),
        },
      );
      windowStatus = win.status;

      const pub = await fetch(
        `${base}/api/allocation-runs/run_missing_uat/publish`,
        {
          method: "POST",
          headers: { ...hdrs, "x-dev-role": "OFFICER" },
          body: JSON.stringify({
            examCycleId: "ec_uat_http_frozen",
            academicYear: "2027",
          }),
        },
      );
      pubStatus = pub.status;

      const imp = await fetch(`${base}/api/imports/apply`, {
        method: "POST",
        headers: { ...hdrs, "x-dev-role": "OFFICER" },
        body: JSON.stringify({
          examCycleId: "ec_uat_http_frozen",
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
      importStatus = imp.status;
      const impBody = (await imp.json()) as {
        ok?: boolean;
        conflict?: boolean;
      };
      importOk = impBody.ok;
      importConflict = impBody.conflict === true;

      const club = await fetch(`${base}/api/relationships/clubbing`, {
        method: "POST",
        headers: { ...hdrs, "x-dev-role": "OFFICER" },
        body: JSON.stringify({
          examCycleId: "ec_uat_http_frozen",
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
      clubStatus = club.status;
      const clubBody = (await club.json()) as { conflict?: boolean };
      clubConflict = clubBody.conflict === true;

      const cap = await fetch(`${base}/api/centres/capacity`, {
        method: "POST",
        headers: { ...hdrs, "x-dev-role": "OFFICER" },
        body: JSON.stringify({
          examCycleId: "ec_uat_http_frozen",
          centres: [{ centreId: "c1", capacity: 40 }],
        }),
      });
      capStatus = cap.status;
      const capBody = (await cap.json()) as { conflict?: boolean };
      capConflict = capBody.conflict === true;

      const illegal = await fetch(
        `${base}/api/exam-cycles/ec_uat_http_frozen/status`,
        {
          method: "POST",
          headers: { ...hdrs, "x-dev-role": "OFFICER" },
          body: JSON.stringify({ status: "ALLOCATION_GENERATED" }),
        },
      );
      illegalStatus = illegal.status;
      const illegalBody = (await illegal.json()) as { ok?: boolean };
      illegalOk = illegalBody.ok;

      const offline = shouldApplySessionAfterApi(null);
      const accepted = shouldApplySessionAfterApi({ ok: true });
      const persistOk = shouldApplySessionAfterApi({ accepted: true });
      const refused = shouldApplySessionAfterApi({
        ok: false,
        error: "Cannot apply import while exam cycle is PUBLISHED",
      });
      const persistRefused = shouldApplySessionAfterApi({
        accepted: false,
        error: "Cannot generate allocation while exam cycle is PUBLISHED",
      });
      sessionHelperOk =
        offline.apply === true &&
        offline.offline === true &&
        accepted.apply === true &&
        persistOk.apply === true &&
        refused.apply === false &&
        persistRefused.apply === false;
    });
  } catch (e) {
    frozenHttpErr = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      unlinkSync(httpFrozenPath);
    } catch {
      /* ignore */
    }
    for (const suffix of ["-wal", "-shm"]) {
      try {
        unlinkSync(httpFrozenPath + suffix);
      } catch {
        /* ignore */
      }
    }
  }
  record(
    "UAT-47",
    "HTTP frozen-cycle override/window/persist/publish use 409; persist body accepted:false",
    ovStatus === 409 &&
      ovConflict &&
      persistStatus === 409 &&
      persistAccepted === false &&
      windowStatus === 409 &&
      pubStatus === 409 &&
      frozenHttpErr === "",
    `ov=${ovStatus} conflict=${ovConflict} persist=${persistStatus} accepted=${String(persistAccepted)} window=${windowStatus} pub=${pubStatus} err=${frozenHttpErr || "none"}`,
  );
  record(
    "UAT-48",
    "HTTP frozen import/clubbing/capacity are 409+conflict; illegal status is 400; session does not apply after reject",
    importStatus === 409 &&
      importOk === false &&
      importConflict &&
      clubStatus === 409 &&
      clubConflict &&
      capStatus === 409 &&
      capConflict &&
      illegalStatus === 400 &&
      illegalOk === false &&
      sessionHelperOk &&
      frozenHttpErr === "",
    `imp=${importStatus} ok=${String(importOk)} club=${clubStatus} cap=${capStatus} illegal=${illegalStatus} helper=${sessionHelperOk} err=${frozenHttpErr || "none"}`,
  );

  const theorySrc = readFileSync("frontend/src/pages/TheoryPage.tsx", "utf8");
  const hallSrc = readFileSync("frontend/src/pages/HallPage.tsx", "utf8");
  const practicalSrc = readFileSync("frontend/src/pages/PracticalPage.tsx", "utf8");
  const persistThenAddRun = (src: string) => {
    const persistAt = src.indexOf("const persist = await persistRun");
    const decideAt = src.indexOf("shouldApplySessionAfterApi(persist)");
    const addAt = src.indexOf("addRun({");
    return persistAt >= 0 && decideAt > persistAt && addAt > decideAt;
  };
  const overrideDecideAt = theorySrc.indexOf(
    "shouldApplySessionAfterApi(api)",
  );
  const overrideApplyAt = theorySrc.indexOf("updateRun(latest.runId");
  record(
    "UAT-49",
    "Generate persist and theory override wait for API; session keeps a run only when persist is accepted or offline",
    persistThenAddRun(theorySrc) &&
      persistThenAddRun(hallSrc) &&
      persistThenAddRun(practicalSrc) &&
      overrideDecideAt >= 0 &&
      overrideApplyAt > overrideDecideAt &&
      shouldApplySessionAfterApi({ accepted: false, error: "refused" }).apply ===
        false &&
      shouldApplySessionAfterApi(null).apply === true,
    `theory=${persistThenAddRun(theorySrc)} hall=${persistThenAddRun(hallSrc)} practical=${persistThenAddRun(practicalSrc)} override=${overrideApplyAt > overrideDecideAt}`,
  );

  const workerSrc = readFileSync("worker/src/index.ts", "utf8");
  const examCyclesGetAt = workerSrc.indexOf(
    'url.pathname === "/api/exam-cycles" && request.method === "GET"',
  );
  const examCyclesPostAt = workerSrc.indexOf(
    'url.pathname === "/api/exam-cycles" && request.method === "POST"',
  );
  const examCyclesGet = workerSrc.slice(
    examCyclesGetAt,
    examCyclesPostAt > examCyclesGetAt ? examCyclesPostAt : undefined,
  );
  const teachersGet = workerSrc.slice(
    workerSrc.indexOf('url.pathname === "/api/teachers" && request.method === "GET"'),
    workerSrc.indexOf('url.pathname === "/api/schools" && request.method === "GET"'),
  );
  record(
    "UAT-50",
    "Worker GET /api/exam-cycles D1 miss is 503 like sibling list GETs, not 200 + empty cycles",
    examCyclesGetAt >= 0 &&
      examCyclesPostAt > examCyclesGetAt &&
      examCyclesGet.includes("}, 503)") &&
      !examCyclesGet.includes("cycles: []") &&
      !examCyclesGet.includes("D1 not bound — configure wrangler") &&
      teachersGet.includes("}, 503)") &&
      classifyHydrateList(null, []) === "failed" &&
      classifyHydrateList({ cycles: [] }, []) === "empty",
    `getSlice503=${examCyclesGet.includes("}, 503)")} emptySwallow=${examCyclesGet.includes("cycles: []")} teachers503=${teachersGet.includes("}, 503)")}`,
  );

  const persistPostAt = workerSrc.indexOf(
    'url.pathname === "/api/allocation-runs" && request.method === "POST"',
  );
  const persistPublishAt = workerSrc.indexOf(
    'url.pathname.match(/^\\/api\\/allocation-runs\\/[^/]+\\/publish$/)',
  );
  const persistPost = workerSrc.slice(
    persistPostAt,
    persistPublishAt > persistPostAt ? persistPublishAt : undefined,
  );
  const localSrc = readFileSync("scripts/local-api-server.ts", "utf8");
  const localPersistAt = localSrc.indexOf(
    'url.pathname === "/api/allocation-runs" && req.method === "POST"',
  );
  const localPublishAt = localSrc.indexOf(
    'url.pathname.match(/^\\/api\\/allocation-runs\\/[^/]+\\/publish$/)',
  );
  const localPersist = localSrc.slice(
    localPersistAt,
    localPublishAt > localPersistAt ? localPublishAt : undefined,
  );
  record(
    "UAT-51",
    "POST /api/allocation-runs D1 miss is 503 + accepted:false on both surfaces, not 200 + warning-only",
    persistPostAt >= 0 &&
      persistPublishAt > persistPostAt &&
      persistPost.includes("}, 503)") &&
      persistPost.includes("accepted: false") &&
      !persistPost.includes("Persist requires D1 binding + migrations") &&
      localPersistAt >= 0 &&
      localPublishAt > localPersistAt &&
      localPersist.includes("}, 503)") &&
      localPersist.includes("accepted: false") &&
      !localPersist.includes("Persist requires D1 binding + migrations") &&
      shouldApplySessionAfterApi({
        accepted: false,
        error: "D1 not bound",
      }).apply === false,
    `worker503=${persistPost.includes("}, 503)")} local503=${localPersist.includes("503")} warningSwallow=${persistPost.includes("Persist requires D1 binding + migrations")}`,
  );

  const backupPostAt = workerSrc.indexOf(
    'url.pathname === "/api/backups" && request.method === "POST"',
  );
  const restorePostAt = workerSrc.indexOf(
    'url.pathname === "/api/restore" && request.method === "POST"',
  );
  const backupPost = workerSrc.slice(
    backupPostAt,
    restorePostAt > backupPostAt ? restorePostAt : undefined,
  );
  const localBackupAt = localSrc.indexOf(
    'url.pathname === "/api/backups" && req.method === "POST"',
  );
  const localRestoreAt = localSrc.indexOf(
    'url.pathname === "/api/restore" && req.method === "POST"',
  );
  const localBackup = localSrc.slice(
    localBackupAt,
    localRestoreAt > localBackupAt ? localRestoreAt : undefined,
  );
  const cycleSrc = readFileSync("frontend/src/pages/ExamCyclePage.tsx", "utf8");
  record(
    "UAT-52",
    "POST /api/backups catalog miss is 503 on both surfaces, not 200 + backupId when the list GET reads D1",
    backupPostAt >= 0 &&
      restorePostAt > backupPostAt &&
      backupPost.includes("Backup record failed") &&
      backupPost.includes("}, 503)") &&
      !backupPost.includes("DB optional failure path") &&
      localBackupAt >= 0 &&
      localRestoreAt > localBackupAt &&
      localBackup.includes("Backup record failed") &&
      localBackup.includes("503") &&
      cycleSrc.includes("bak?.backupId && !bak.error"),
    `worker503=${backupPost.includes("Backup record failed")} local503=${localBackup.includes("Backup record failed")} swallow=${backupPost.includes("DB optional failure path")}`,
  );

  const dashSrc = readFileSync("frontend/src/pages/DashboardPage.tsx", "utf8");
  const newestLast = latestRunForModule(
    [
      { module: "THEORY", createdAt: "2027-03-01T00:00:00.000Z", runId: "old" },
      { module: "THEORY", createdAt: "2027-03-02T00:00:00.000Z", runId: "new" },
    ],
    "THEORY",
  );
  const newestFirst = latestRunForModule(
    [
      { module: "THEORY", createdAt: "2027-03-02T00:00:00.000Z", runId: "new" },
      { module: "THEORY", createdAt: "2027-03-01T00:00:00.000Z", runId: "old" },
    ],
    "THEORY",
  );
  record(
    "UAT-53",
    "Dashboard pipeline picks each module's newest createdAt run, not the oldest session row",
    dashSrc.includes("latestRunForModule") &&
      !dashSrc.includes(".at(-1)") &&
      newestLast?.runId === "new" &&
      newestFirst?.runId === "new",
    `helper=${dashSrc.includes("latestRunForModule")} staleAt=${dashSrc.includes(".at(-1)")} last=${newestLast?.runId} first=${newestFirst?.runId}`,
  );

  const mapTeacher = demo.teachers[0]?.teacherId ?? "t1";
  const mapCentre = demo.centres[0]?.centreId ?? "c1";
  const mapParsed = parseBody(allocationRunBodySchema, {
    runId: "run_uat_issue_map",
    examCycleId: "ec_uat_local",
    module: "THEORY",
    validationIssues: [
      {
        ruleCode: "RULE-THEORY-DISTANCE",
        severity: "ERROR",
        message: "Too far",
        teacherId: mapTeacher,
        centreId: mapCentre,
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
        teacherId: mapTeacher,
        date: "2027-03-16",
        duty: "THEORY,HALL",
      },
    ],
    conflicts: [
      {
        ruleCode: "RULE-CONFLICT-SESSION",
        severity: "ERROR",
        message: "Teacher has multiple duties in the same date and session",
        teacherId: mapTeacher,
        date: "2027-03-16",
        session: "AFTERNOON",
        duties: ["THEORY", "HALL"],
      },
    ],
    results: [
      {
        teacherId: mapTeacher,
        centreId: mapCentre,
        dutyTypeCode: "CHIEF_EXAMINATION",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 1,
      },
      {
        teacherId: mapTeacher,
        centreId: mapCentre,
        dutyTypeCode: "CHIEF_EXAMINATION",
        roleCode: "CHIEF_EXAMINATION",
        examDate: "2027-03-16",
        sessionCode: "AFTERNOON",
        score: 1,
      },
    ],
  });
  const mapFindings = mapParsed.ok
    ? validationFindingsFromRunBody(mapParsed.data)
    : [];
  if (mapParsed.ok) {
    await persistAllocationRun(db, {
      runId: "run_uat_issue_map",
      examCycleId: "ec_uat_local",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "uat-map",
      module: "THEORY",
      validationStatus: "INVALID",
      createdBy: "uat-local",
      summaryJson: JSON.stringify({ errors: 3 }),
      results: (mapParsed.data.results ?? []).map((r, i) => ({
        resultId: `res_uat_map_${i}`,
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
      validationFindings: mapFindings,
    });
  }
  const mapReasons = (await listAllocationDecisionReasons(
    db,
    "run_uat_issue_map",
  )) as Array<{
    rule_code: string;
    teacher_id: string;
    exam_date: string;
    session_code: string;
  }>;
  const mapDistance = mapReasons.find(
    (r) => r.rule_code === "RULE-THEORY-DISTANCE",
  );
  const mapShortage = mapReasons.find((r) => r.rule_code === "RULE-SHORTAGE");
  const mapConflicts = mapReasons.filter((r) =>
    r.rule_code.startsWith("RULE-CONFLICT-"),
  );
  const mapSnapshot = await buildCanonicalBackup(db);
  sqlite
    .prepare(
      `INSERT INTO allocation_run_results
        (result_id, run_id, teacher_id, centre_id, duty_type_code, role_code, exam_date, session_code, score, decision_trace_json, is_generated, is_override)
       VALUES ('res_uat_map_leftover', 'run_uat_issue_map', ?, ?, 'CHIEF_EXAMINATION', 'CHIEF_EXAMINATION', '1999-01-01', 'MORNING', 9, '{}', 1, 0)`,
    )
    .run(mapTeacher, mapCentre);
  const mapRestore = await transactionalRestore(db, mapSnapshot, {
    adminConfirmed: true,
    includeHistory: false,
  });
  const mapAfter = (await listAllocationDecisionReasons(
    db,
    "run_uat_issue_map",
  )) as Array<{
    rule_code: string;
    teacher_id: string;
    exam_date: string;
  }>;
  record(
    "UAT-54",
    "Generate date/duty persist onto examDate/session; shortage is not pinned to results[0]; conflicts are stored once",
    mapParsed.ok === true &&
      mapFindings.filter((f) => f.ruleCode.startsWith("RULE-CONFLICT-"))
        .length === 1 &&
      mapDistance?.exam_date === "2027-03-16" &&
      mapDistance?.session_code === "AFTERNOON" &&
      mapShortage?.teacher_id === "" &&
      mapShortage?.exam_date === "" &&
      mapConflicts.length === 1 &&
      mapConflicts[0]?.exam_date === "2027-03-16" &&
      mapRestore.ok === true &&
      mapAfter.find((r) => r.rule_code === "RULE-THEORY-DISTANCE")?.exam_date ===
        "2027-03-16" &&
      mapAfter.filter((r) => r.rule_code.startsWith("RULE-CONFLICT-")).length ===
        1 &&
      mapAfter.find((r) => r.rule_code === "RULE-SHORTAGE")?.teacher_id === "",
    `parsed=${mapParsed.ok} when=${mapDistance?.exam_date} shortageTeacher=${mapShortage?.teacher_id} conflicts=${mapConflicts.length} restore=${mapRestore.ok}`,
  );

  const hallShortParsed = parseBody(allocationRunBodySchema, {
    runId: "run_uat_hall_shortage_centre",
    examCycleId: "ec_uat_local",
    module: "HALL",
    validationIssues: [
      {
        ruleCode: "RULE-HALL-SHORTAGE",
        severity: "ERROR",
        message: "NO FEASIBLE ALLOCATION",
        centreId: mapCentre,
        details: {
          centreId: mapCentre,
          required: 11,
          eligible: 2,
          shortage: 9,
        },
      },
    ],
    results: [
      {
        teacherId: `${mapTeacher}-filled-a`,
        centreId: mapCentre,
        dutyTypeCode: "HALL_INVIGILATOR",
        roleCode: "HALL_INVIGILATOR",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 0,
      },
      {
        teacherId: `${mapTeacher}-filled-b`,
        centreId: mapCentre,
        dutyTypeCode: "HALL_INVIGILATOR",
        roleCode: "HALL_INVIGILATOR",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 1,
      },
    ],
  });
  const hallShortFindings = hallShortParsed.ok
    ? validationFindingsFromRunBody(hallShortParsed.data)
    : [];
  if (hallShortParsed.ok) {
    await persistAllocationRun(db, {
      runId: "run_uat_hall_shortage_centre",
      examCycleId: "ec_uat_local",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "hall-1.0.0",
      module: "HALL",
      validationStatus: "INVALID",
      createdBy: "uat-local",
      summaryJson: JSON.stringify({ errors: 1 }),
      results: (hallShortParsed.data.results ?? []).map((r, i) => ({
        resultId: `res_uat_hall_short_${i}`,
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
      validationFindings: hallShortFindings,
    });
  }
  const hallShortReasons = (await listAllocationDecisionReasons(
    db,
    "run_uat_hall_shortage_centre",
  )) as Array<{
    rule_code: string;
    teacher_id: string;
    exam_date: string;
    session_code: string;
    details_json: string | null;
  }>;
  const hallShortRows = hallShortReasons.filter(
    (r) => r.rule_code === "RULE-HALL-SHORTAGE",
  );
  const hallShortDetails = hallShortRows[0]?.details_json
    ? (JSON.parse(hallShortRows[0].details_json) as {
        unmatched?: boolean;
        centreId?: string;
      })
    : {};
  record(
    "UAT-55",
    "Hall shortage with centreId is not pinned to filled assignment slots; Teacher/When stay blank",
    hallShortParsed.ok === true &&
      hallShortRows.length === 1 &&
      hallShortRows[0]?.teacher_id === "" &&
      hallShortRows[0]?.exam_date === "" &&
      hallShortRows[0]?.session_code === "" &&
      hallShortDetails.unmatched === true &&
      hallShortDetails.centreId === mapCentre,
    `parsed=${hallShortParsed.ok} rows=${hallShortRows.length} teacher=${hallShortRows[0]?.teacher_id} when=${hallShortRows[0]?.exam_date} unmatched=${hallShortDetails.unmatched}`,
  );

  const multiShortParsed = parseBody(allocationRunBodySchema, {
    runId: "run_uat_multi_shortage",
    examCycleId: "ec_uat_local",
    module: "HALL",
    validationIssues: [
      {
        ruleCode: "RULE-HALL-SHORTAGE",
        severity: "ERROR",
        message: "NO FEASIBLE ALLOCATION",
        centreId: `${mapCentre}-a`,
        details: {
          centreId: `${mapCentre}-a`,
          required: 11,
          eligible: 2,
          shortage: 9,
        },
      },
      {
        ruleCode: "RULE-HALL-SHORTAGE",
        severity: "ERROR",
        message: "NO FEASIBLE ALLOCATION",
        centreId: `${mapCentre}-b`,
        details: {
          centreId: `${mapCentre}-b`,
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
          requirementKey: `${mapCentre}-CHIEF-a`,
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
          requirementKey: `${mapCentre}-CHIEF-b`,
          required: 1,
          eligible: 0,
          shortage: 1,
        },
      },
    ],
    results: [
      {
        teacherId: `${mapTeacher}-filled`,
        centreId: mapCentre,
        dutyTypeCode: "HALL_INVIGILATOR",
        roleCode: "HALL_INVIGILATOR",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 0,
      },
    ],
  });
  const multiShortFindings = multiShortParsed.ok
    ? validationFindingsFromRunBody(multiShortParsed.data)
    : [];
  if (multiShortParsed.ok) {
    await persistAllocationRun(db, {
      runId: "run_uat_multi_shortage",
      examCycleId: "ec_uat_local",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: "hall-1.0.0",
      module: "HALL",
      validationStatus: "INVALID",
      createdBy: "uat-local",
      summaryJson: JSON.stringify({ errors: 4 }),
      results: (multiShortParsed.data.results ?? []).map((r, i) => ({
        resultId: `res_uat_multi_short_${i}`,
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
      validationFindings: multiShortFindings,
    });
  }
  const multiShortReasons = (await listAllocationDecisionReasons(
    db,
    "run_uat_multi_shortage",
  )) as Array<{
    rule_code: string;
    teacher_id: string;
    exam_date: string;
    details_json: string | null;
  }>;
  const multiHall = multiShortReasons.filter(
    (r) => r.rule_code === "RULE-HALL-SHORTAGE",
  );
  const multiTheory = multiShortReasons.filter(
    (r) => r.rule_code === "RULE-SHORTAGE",
  );
  const multiHallCentres = multiHall
    .map((r) =>
      r.details_json
        ? (JSON.parse(r.details_json) as { centreId?: string }).centreId
        : undefined,
    )
    .sort();
  const multiTheoryKeys = multiTheory
    .map((r) =>
      r.details_json
        ? (JSON.parse(r.details_json) as { requirementKey?: string })
            .requirementKey
        : undefined,
    )
    .sort();
  record(
    "UAT-56",
    "Same-message hall/theory shortages persist one row per centre or requirement; Teacher/When stay blank",
    multiShortParsed.ok === true &&
      multiShortFindings.filter((f) => f.ruleCode === "RULE-HALL-SHORTAGE")
        .length === 2 &&
      multiShortFindings.filter((f) => f.ruleCode === "RULE-SHORTAGE").length ===
        2 &&
      multiHall.length === 2 &&
      multiTheory.length === 2 &&
      multiHall.every((r) => r.teacher_id === "" && r.exam_date === "") &&
      multiTheory.every((r) => r.teacher_id === "" && r.exam_date === "") &&
      multiHallCentres.join(",") === `${mapCentre}-a,${mapCentre}-b` &&
      multiTheoryKeys.join(",") ===
        `${mapCentre}-CHIEF-a,${mapCentre}-CHIEF-b`,
    `parsed=${multiShortParsed.ok} hall=${multiHall.length} theory=${multiTheory.length} centres=${multiHallCentres.join(",")} keys=${multiTheoryKeys.join(",")}`,
  );

  const infeasiblePractical = schedulePractical(
    [{ schoolId: pairSchoolId || "s1", subjectId: "PHYSICS", studentCount: 30 }],
    {
      ...practicalDataset([], "2027", "2027-03-25"),
      availableDates: [],
    },
    DEFAULT_RULE_PARAMETERS,
  );
  const infeasibleValidation = validatePracticalAllocation(
    infeasiblePractical,
    DEFAULT_RULE_PARAMETERS,
  );
  const emptyResultsParsed = parseBody(allocationRunBodySchema, {
    runId: "run_uat_empty_results_issues",
    examCycleId: "ec_uat_local",
    module: "PRACTICAL",
    validationIssues: infeasibleValidation.issues,
    results: infeasiblePractical.schedules.map((s) => ({
      teacherId: s.internalExaminerId,
      centreId: s.schoolId,
      dutyTypeCode: "PRACTICAL_INTERNAL",
      roleCode: "PRACTICAL_INTERNAL",
      examDate: s.examDate,
      sessionCode: s.sessionCode,
      score: 0,
    })),
  });
  const emptyResultsFindings = emptyResultsParsed.ok
    ? validationFindingsFromRunBody(emptyResultsParsed.data)
    : [];
  if (emptyResultsParsed.ok) {
    await persistAllocationRun(db, {
      runId: "run_uat_empty_results_issues",
      examCycleId: "ec_uat_local",
      ruleVersionId: "rv-2027-1",
      algorithmVersion: infeasiblePractical.algorithmVersion,
      module: "PRACTICAL",
      validationStatus: infeasibleValidation.status,
      createdBy: "uat-local",
      summaryJson: JSON.stringify({
        schedules: infeasiblePractical.schedules.length,
        feasible: infeasiblePractical.feasible,
        valid: infeasibleValidation.valid,
        warnings: infeasibleValidation.warnings,
        errors: infeasibleValidation.errors,
      }),
      results: [],
      validationFindings: emptyResultsFindings,
    });
  }
  const emptyResultsRuns = (await listAllocationRuns(
    db,
    "ec_uat_local",
  )) as Array<{ run_id: string; summary_json: string | null }>;
  const emptyResultsSummary = emptyResultsRuns.find(
    (r) => r.run_id === "run_uat_empty_results_issues",
  )?.summary_json;
  const emptyResultsReasons = (await listAllocationDecisionReasons(
    db,
    "run_uat_empty_results_issues",
  )) as Array<{ rule_code: string; severity: string; message: string }>;
  const emptyResultsHydrated = issuesFromPersisted(
    emptyResultsSummary,
    emptyResultsReasons,
  );
  const emptyResultsCountOnly = issuesFromPersisted(
    JSON.stringify({ errors: infeasibleValidation.errors, feasible: false }),
  );
  const emptyResultsSnapshot = await buildCanonicalBackup(db);
  const emptyResultsRestore = await transactionalRestore(db, emptyResultsSnapshot, {
    adminConfirmed: true,
    includeHistory: false,
  });
  const emptyResultsAfter = (await listAllocationRuns(
    db,
    "ec_uat_local",
  )) as Array<{ run_id: string; summary_json: string | null }>;
  const emptyResultsRestored = issuesFromPersisted(
    emptyResultsAfter.find((r) => r.run_id === "run_uat_empty_results_issues")
      ?.summary_json,
  );
  record(
    "UAT-57",
    "Empty-results practical infeasible folds into summary.issues and hydrates after same-DB restore (no invented FK)",
    infeasiblePractical.feasible === false &&
      infeasiblePractical.schedules.length === 0 &&
      infeasibleValidation.errors >= 1 &&
      infeasibleValidation.issues.some(
        (i) => i.ruleCode === "RULE-PRACTICAL-INFEASIBLE",
      ) &&
      emptyResultsParsed.ok === true &&
      emptyResultsFindings.length >= 1 &&
      emptyResultsReasons.length === 0 &&
      emptyResultsHydrated.some(
        (i) =>
          i.ruleCode === "RULE-PRACTICAL-INFEASIBLE" && i.severity === "ERROR",
      ) &&
      emptyResultsCountOnly.length === 0 &&
      emptyResultsRestore.ok === true &&
      emptyResultsRestored.some(
        (i) => i.ruleCode === "RULE-PRACTICAL-INFEASIBLE",
      ),
    `feasible=${infeasiblePractical.feasible} schedules=${infeasiblePractical.schedules.length} errors=${infeasibleValidation.errors} reasons=${emptyResultsReasons.length} hydrated=${emptyResultsHydrated.length} restore=${emptyResultsRestore.ok}`,
  );

  const smokeSrc = readFileSync("scripts/ui-smoke.mjs", "utf8");
  record(
    "UAT-58",
    "Practical/hall generate disable while persist is in flight; smoke waits for Generating… and a pipeline run-id change after theory generate",
    practicalSrc.includes('"Generating…"') &&
      practicalSrc.includes("!pairsReady") &&
      practicalSrc.includes("!rulesReady") &&
      practicalSrc.includes("!exemptionsReady") &&
      hallSrc.includes('"Generating…"') &&
      hallSrc.includes("!rulesReady || !exemptionsReady") &&
      smokeSrc.includes("hydratedTheoryId") &&
      smokeSrc.includes("still showed hydrated") &&
      smokeSrc.includes('getByText("Generate practical schedule")'),
    `practicalBusy=${practicalSrc.includes("setBusy(true)")} hallBusy=${hallSrc.includes("setBusy(true)")} smokeHydrated=${smokeSrc.includes("hydratedTheoryId")}`,
  );

  const examCycleSrc = readFileSync(
    "frontend/src/pages/ExamCyclePage.tsx",
    "utf8",
  );
  const importSrc = readFileSync("frontend/src/pages/ImportPage.tsx", "utf8");
  const backupSrc = readFileSync("frontend/src/pages/BackupPage.tsx", "utf8");
  const masterSrc = readFileSync("frontend/src/pages/MasterDataPage.tsx", "utf8");
  record(
    "UAT-59",
    "Primary writes disable and show a busy label until persist settles; smoke waits for Applying…/Publishing…/Saving…/Archiving…/Creating…",
    examCycleSrc.includes('busyKind === "publish" ? "Publishing…"') &&
      examCycleSrc.includes("disabled={!canManage || !latest?.result || busy}") &&
      examCycleSrc.includes('busyKind === "window" ? "Saving…"') &&
      examCycleSrc.includes('busyKind === "amend" ? "Creating…"') &&
      examCycleSrc.includes("disabled={!canManage || !reason.trim() || busy}") &&
      examCycleSrc.includes("disabled={!canManage || busy}") &&
      importSrc.includes('busy ? "Applying…"') &&
      importSrc.includes('busyKind === "clubbing" ? "Applying…"') &&
      importSrc.includes('busyKind === "capacity" ? "Applying…"') &&
      importSrc.includes("disabled={!canImport || busy}") &&
      backupSrc.includes('busyKind === "archive" ? "Archiving…"') &&
      backupSrc.includes('busyKind === "restore" ? "Restoring…"') &&
      backupSrc.includes("disabled={!canBackup || busy}") &&
      backupSrc.includes("disabled={role !== \"ADMIN\" || !pendingPayload || busy}") &&
      theorySrc.includes('overrideBusy ? "Applying…"') &&
      masterSrc.includes('exBusy ? "Saving…"') &&
      smokeSrc.includes('getByText("Applying…")') &&
      smokeSrc.includes('getByText("Publishing…")') &&
      smokeSrc.includes('getByText("Saving…")') &&
      smokeSrc.includes('getByText("Archiving…")') &&
      smokeSrc.includes('getByText("Creating…")'),
    `publish=${examCycleSrc.includes("Publishing…")} import=${importSrc.includes("Applying…")} archive=${backupSrc.includes("Archiving…")} override=${theorySrc.includes("overrideBusy")} exemption=${masterSrc.includes("Saving…")}`,
  );

  const settingsSrc = readFileSync("frontend/src/pages/SettingsPage.tsx", "utf8");
  const reportsSrc = readFileSync("frontend/src/pages/ReportsPage.tsx", "utf8");
  record(
    "UAT-60",
    "Settings rule-version create/activate and report/duty-letter exports disable until persist settles; smoke waits for Creating…/Activating…/Exporting…",
    settingsSrc.includes('busyKind === "create"') &&
      settingsSrc.includes("Creating…") &&
      settingsSrc.includes('busyKind === "activate"') &&
      settingsSrc.includes("Activating…") &&
      settingsSrc.includes("disabled={role !== \"ADMIN\" || busy}") &&
      reportsSrc.includes('busyKind === "dutyIn" ? "Exporting…"') &&
      reportsSrc.includes('busyKind === "dutyOut" ? "Exporting…"') &&
      reportsSrc.includes(
        "disabled={!canExport || !practicalResult?.schedules.length || busy}",
      ) &&
      reportsSrc.includes("disabled={!canExport || !latest?.result || busy}") &&
      smokeSrc.includes('createRule.getByText("Creating…")') &&
      smokeSrc.includes('activateRule.getByText("Activating…")') &&
      smokeSrc.includes('exportDutyIn.getByText("Exporting…")'),
    `settingsCreate=${settingsSrc.includes("Creating…")} settingsActivate=${settingsSrc.includes("Activating…")} dutyIn=${reportsSrc.includes("dutyIn")} smokeExport=${smokeSrc.includes("Exporting…")}`,
  );

  const workerImportSrc = readFileSync("worker/src/index.ts", "utf8");
  const localApiSrc = readFileSync("scripts/local-api-server.ts", "utf8");
  const importRowCountPath = join(
    ROOT,
    `.data/uat-import-rowcount-${Date.now()}.sqlite`,
  );
  let uploadRowCount: number | null = null;
  let applyUpserted = -1;
  let listedRowCount: number | null = null;
  let drillFileRows = -1;
  let drillOutcomes = -1;
  let rosterN = -1;
  let importRowErr = "";
  try {
    await withLocalApi(importRowCountPath, async (base) => {
      const hdrs = {
        "content-type": "application/json",
        "x-dev-role": "OFFICER",
        "x-dev-email": "officer@example.local",
      };
      const teachersRes = await fetch(`${base}/api/teachers`, { headers: hdrs });
      const teachersBody = (await teachersRes.json()) as {
        teachers?: Array<{
          teacher_id: string;
          employee_code: string;
          name: string;
          school_id: string;
          designation: string;
        }>;
      };
      const roster = teachersBody.teachers ?? [];
      rosterN = roster.length;
      if (roster.length < 3) {
        throw new Error(`roster too small ${roster.length}`);
      }
      const upload = await fetch(`${base}/api/imports`, {
        method: "POST",
        headers: {
          ...hdrs,
          "x-filename": "teachers.json",
          "x-row-count": "2",
        },
        body: JSON.stringify([
          {
            employeeCode: roster[0]!.employee_code,
            name: roster[0]!.name,
            schoolCode: "S1",
            designation: roster[0]!.designation,
          },
          {
            employeeCode: "SYN-UAT-RC",
            name: "UAT Rowcount",
            schoolCode: "S1",
            designation: "PG",
          },
        ]),
      });
      const upBody = (await upload.json()) as {
        importId?: string;
        rowCount?: number;
        error?: string;
      };
      if (!upload.ok || !upBody.importId) {
        throw new Error(`upload ${upload.status} ${upBody.error ?? ""}`);
      }
      uploadRowCount = upBody.rowCount ?? null;
      const apply = await fetch(`${base}/api/imports/apply`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          importId: upBody.importId,
          teachers: roster.map((t) => ({
            teacher_id: t.teacher_id,
            employee_code: t.employee_code,
            name: t.name,
            school_id: t.school_id,
            designation: t.designation,
          })),
          rows: [
            {
              rowNumber: 1,
              status: "UNCHANGED",
              entityKey: roster[0]!.employee_code,
            },
            { rowNumber: 2, status: "NEW", entityKey: "SYN-UAT-RC" },
            { rowNumber: -1, status: "MISSING", entityKey: "ABSENT" },
          ],
        }),
      });
      const applyBody = (await apply.json()) as {
        ok?: boolean;
        upserted?: number;
        error?: string;
      };
      if (!apply.ok || applyBody.ok !== true) {
        throw new Error(`apply ${apply.status} ${applyBody.error ?? ""}`);
      }
      applyUpserted = applyBody.upserted ?? -1;
      const list = await fetch(`${base}/api/imports`, {
        headers: { "x-dev-role": "VIEWER" },
      });
      const listed = (await list.json()) as {
        imports?: Array<{ import_id: string; row_count: number | null }>;
      };
      listedRowCount =
        listed.imports?.find((i) => i.import_id === upBody.importId)
          ?.row_count ?? null;
      const drill = await fetch(
        `${base}/api/imports/${encodeURIComponent(upBody.importId)}/rows`,
        { headers: { "x-dev-role": "VIEWER" } },
      );
      const drillBody = (await drill.json()) as {
        rows?: Array<{ row_number: number }>;
      };
      const drillRows = drillBody.rows ?? [];
      drillOutcomes = drillRows.length;
      drillFileRows = drillRows.filter((r) => r.row_number > 0).length;
    });
  } catch (e) {
    importRowErr = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      unlinkSync(importRowCountPath);
    } catch {
      /* ignore */
    }
    for (const suffix of ["-wal", "-shm"]) {
      try {
        unlinkSync(importRowCountPath + suffix);
      } catch {
        /* ignore */
      }
    }
  }
  record(
    "UAT-61",
    "xlsx apply waits for archive; lastImportId cleared on sample/FORM-01; D1 row_count is file rows not roster upsert",
    importSrc.includes('uploadBusy ? "Uploading…"') &&
      importSrc.includes("uploadBusy") &&
      importSrc.includes("clearArchivedImport") &&
      importSrc.includes("rowCount: parsed.rows.length") &&
      importSrc.includes("await uploadImportApi") &&
      !importSrc.includes('void import("../lib/api").then') &&
      workerImportSrc.includes("importFileRowCount(parsed.data.rows)") &&
      localApiSrc.includes("importFileRowCount(parsed.data.rows)") &&
      smokeSrc.includes('getByText("Uploading…")') &&
      uploadRowCount === 2 &&
      listedRowCount === 2 &&
      applyUpserted === rosterN &&
      rosterN > 2 &&
      importRowErr === "",
    `uploadRowCount=${uploadRowCount} listed=${listedRowCount} upserted=${applyUpserted} roster=${rosterN} err=${importRowErr || "none"}`,
  );

  const appCtxSrc = readFileSync("frontend/src/state/AppContext.tsx", "utf8");
  const auditSrc = readFileSync("frontend/src/pages/AuditPage.tsx", "utf8");
  const importApplySrc = readFileSync("shared/src/importApply.ts", "utf8");
  const textareaClearsArchive = /onChange=\{\(e\) => \{[\s\S]*?clearArchivedImport\(\)/.test(
    importSrc,
  );
  record(
    "UAT-62",
    "sample/JSON apply does not invent local imp_* ids; textarea edit drops lastImportId; audit drill-down file rows match listed row_count (outcomes may include MISSING)",
    !appCtxSrc.includes('createId("imp")') &&
      appCtxSrc.includes('importId ?? "(no archive)"') &&
      importApplySrc.includes("historySourceImportId") &&
      textareaClearsArchive &&
      auditSrc.includes("file rows") &&
      auditSrc.includes("outcomes") &&
      auditSrc.includes("import-rows-count") &&
      smokeSrc.includes("Applied import (no archive)") &&
      smokeSrc.includes("import-rows-count") &&
      drillFileRows === 2 &&
      listedRowCount === 2 &&
      drillFileRows === listedRowCount &&
      drillOutcomes === 3 &&
      importRowErr === "",
    `noInventedId=${!appCtxSrc.includes('createId("imp")')} textareaClear=${textareaClearsArchive} drillFile=${drillFileRows} drillOutcomes=${drillOutcomes} listed=${listedRowCount} err=${importRowErr || "none"}`,
  );

  const exportReceiptPath = join(
    ROOT,
    `.data/uat-export-receipt-${Date.now()}.sqlite`,
  );
  let viewerExportStatus = -1;
  let officerExportOk = false;
  let officerExportId = "";
  let viewerListHasReceipt = false;
  let exportReceiptErr = "";
  try {
    await withLocalApi(exportReceiptPath, async (base) => {
      const denied = await fetch(`${base}/api/exports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-role": "VIEWER",
          "x-dev-email": "viewer@example.local",
        },
        body: JSON.stringify({
          exportType: "teacher-wise-xlsx",
          examCycleId: "ec_uat_local",
          runId: "run_uat_export",
        }),
      });
      viewerExportStatus = denied.status;
      const created = await fetch(`${base}/api/exports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-role": "OFFICER",
          "x-dev-email": "officer@example.local",
        },
        body: JSON.stringify({
          exportType: "teacher-wise-xlsx",
          examCycleId: "ec_uat_local",
          runId: "run_uat_export",
        }),
      });
      const createdBody = (await created.json()) as {
        ok?: boolean;
        exportId?: string;
        error?: string;
      };
      if (!created.ok || createdBody.ok !== true || !createdBody.exportId) {
        throw new Error(
          `officer export ${created.status} ${createdBody.error ?? ""}`,
        );
      }
      officerExportOk = true;
      officerExportId = createdBody.exportId;
      const listed = await fetch(`${base}/api/exports`, {
        headers: { "x-dev-role": "VIEWER" },
      });
      const listedBody = (await listed.json()) as {
        exports?: Array<{ export_id: string }>;
      };
      viewerListHasReceipt = Boolean(
        listedBody.exports?.some((e) => e.export_id === createdBody.exportId),
      );
    });
  } catch (e) {
    exportReceiptErr = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      unlinkSync(exportReceiptPath);
    } catch {
      /* ignore */
    }
    for (const suffix of ["-wal", "-shm"]) {
      try {
        unlinkSync(exportReceiptPath + suffix);
      } catch {
        /* ignore */
      }
    }
  }
  record(
    "UAT-63",
    "POST /api/exports is a receipt write (master.write); VIEWER is 403; Reports/Audit do not claim the file is archived",
    viewerExportStatus === 403 &&
      officerExportOk &&
      viewerListHasReceipt &&
      exportReceiptErr === "" &&
      /\/api\/exports" && request.method === "POST"[\s\S]{0,180}requirePerm\(auth, "master.write"\)/.test(
        workerImportSrc,
      ) &&
      /\/api\/exports" && req.method === "POST"[\s\S]{0,180}requirePerm\(a, "master.write"/.test(
        localApiSrc,
      ) &&
      reportsSrc.includes("Receipt recorded") &&
      reportsSrc.includes("receipt was not stored") &&
      reportsSrc.includes("the file is not archived") &&
      reportsSrc.includes("setReceipt") &&
      auditSrc.includes("Export receipts") &&
      auditSrc.includes("only the receipt is stored") &&
      smokeSrc.includes('export-receipt")') &&
      smokeSrc.includes("Receipt recorded"),
    `viewer=${viewerExportStatus} officerOk=${officerExportOk} listed=${viewerListHasReceipt} id=${officerExportId || "none"} err=${exportReceiptErr || "none"}`,
  );

  const activateCopyPath = join(
    ROOT,
    `.data/uat-activate-catalog-${Date.now()}.sqlite`,
  );
  let cycleRuleBefore = "";
  let cycleRuleAfter = "";
  let catalogActiveAfter = "";
  let activateCopyErr = "";
  try {
    await withLocalApi(activateCopyPath, async (base) => {
      const adminHeaders = {
        "content-type": "application/json",
        "x-dev-role": "ADMIN",
        "x-dev-email": "admin@example.local",
      };
      const cycles = await fetch(`${base}/api/exam-cycles`, {
        headers: adminHeaders,
      });
      const cycleBody = (await cycles.json()) as {
        cycles?: Array<{ exam_cycle_id: string; rule_version_id?: string }>;
      };
      const cycle = cycleBody.cycles?.find(
        (c) => c.exam_cycle_id === "ec_2027_hsc",
      );
      cycleRuleBefore = cycle?.rule_version_id ?? "";
      const created = await fetch(`${base}/api/rule-versions`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          versionLabel: "uat-64-catalog",
          description: "Activate must not retarget the cycle",
          cloneFromId: "rv-2027-1",
          activate: false,
        }),
      });
      const createdBody = (await created.json()) as {
        ok?: boolean;
        ruleVersionId?: string;
        error?: string;
      };
      if (!created.ok || !createdBody.ok || !createdBody.ruleVersionId) {
        throw new Error(
          `create ${created.status} ${createdBody.error ?? ""}`,
        );
      }
      const activated = await fetch(`${base}/api/rule-versions/activate`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ ruleVersionId: createdBody.ruleVersionId }),
      });
      const activatedBody = (await activated.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!activated.ok || !activatedBody.ok) {
        throw new Error(
          `activate ${activated.status} ${activatedBody.error ?? ""}`,
        );
      }
      const afterCycles = await fetch(`${base}/api/exam-cycles`, {
        headers: adminHeaders,
      });
      const afterCycleBody = (await afterCycles.json()) as {
        cycles?: Array<{ exam_cycle_id: string; rule_version_id?: string }>;
      };
      cycleRuleAfter =
        afterCycleBody.cycles?.find((c) => c.exam_cycle_id === "ec_2027_hsc")
          ?.rule_version_id ?? "";
      const versions = await fetch(`${base}/api/rule-versions`, {
        headers: adminHeaders,
      });
      const versionBody = (await versions.json()) as {
        versions?: Array<{ rule_version_id: string; is_active: number }>;
      };
      catalogActiveAfter =
        versionBody.versions?.find((v) => v.is_active)?.rule_version_id ?? "";
      if (catalogActiveAfter !== createdBody.ruleVersionId) {
        throw new Error(
          `catalog active ${catalogActiveAfter} != ${createdBody.ruleVersionId}`,
        );
      }
    });
  } catch (e) {
    activateCopyErr = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      unlinkSync(activateCopyPath);
    } catch {
      /* ignore */
    }
    for (const suffix of ["-wal", "-shm"]) {
      try {
        unlinkSync(activateCopyPath + suffix);
      } catch {
        /* ignore */
      }
    }
  }
  record(
    "UAT-64",
    "Activate success/help copy matches API: catalog is_active only; cycle stored rule id unchanged (OQ-021 unanswered); generate/import do not claim catalog-active or R2-in-production",
    cycleRuleBefore === "rv-2027-1" &&
      cycleRuleAfter === cycleRuleBefore &&
      catalogActiveAfter.startsWith("rv_") &&
      activateCopyErr === "" &&
      settingsSrc.includes("active catalog row") &&
      settingsSrc.includes("cycle's stored rule id is unchanged") &&
      settingsSrc.includes("Cycle stored rule version (UI)") &&
      !settingsSrc.includes("new allocations use this version") &&
      !settingsSrc.includes("Active rule version (UI)") &&
      theorySrc.includes("cycle's stored rule version") &&
      !theorySrc.includes("the active rule version") &&
      importSrc.includes("local filesystem in api:local") &&
      !importSrc.includes("Official imports are archived to R2") &&
      smokeSrc.includes("Activated ${createdId}") &&
      appCtxSrc.includes("Activate flips rule_versions.is_active only"),
    `cycleBefore=${cycleRuleBefore || "none"} cycleAfter=${cycleRuleAfter || "none"} catalog=${catalogActiveAfter || "none"} err=${activateCopyErr || "none"}`,
  );

  const apiTsSrc = readFileSync("frontend/src/lib/api.ts", "utf8");
  const unstoredBackup = backupArchiveOfficerMessage({
    backupId: "bak-unstored",
    stored: false,
    checksum: "abc123def456",
  });
  const storedBackup = backupArchiveOfficerMessage({
    backupId: "bak-stored",
    stored: true,
    checksum: "abc123def456",
  });
  const inlinePayload = inlineCanonicalBackupPayload({
    backupId: "bak-unstored",
    stored: false,
    payload: { teachers: [] },
  });
  record(
    "UAT-65",
    "Worker stored:false backup/import receipts are not called archives; encrypted download uses the inline canonical payload",
    unstoredBackup.ok === false &&
      unstoredBackup.text.includes("payload was not stored") &&
      !unstoredBackup.text.includes("Server archive created") &&
      storedBackup.ok === true &&
      storedBackup.text.includes("Server archive created") &&
      inlinePayload !== null &&
      Array.isArray(inlinePayload.teachers) &&
      publishBackupSuffix({ backupId: "abcdef01-xxxx", stored: false }).includes(
        "payload not stored",
      ) &&
      importUploadOfficerMessage(
        { importId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", stored: false },
        3,
      ).includes("file not archived") &&
      backupSrc.includes("inlineCanonicalBackupPayload") &&
      backupSrc.includes("backupArchiveOfficerMessage") &&
      backupSrc.includes("payload returned inline because the file was not stored") &&
      !backupSrc.includes("Server archive created: ${r.backupId}") &&
      importSrc.includes("importUploadOfficerMessage") &&
      examCycleSrc.includes("publishBackupSuffix") &&
      apiTsSrc.includes("stored?: boolean") &&
      apiTsSrc.includes("payload?: Record<string, unknown>") &&
      workerImportSrc.includes("payload: stored ? undefined : payloadObj") &&
      workerImportSrc.includes('stored ? "STORED" : "RECORDED_NO_R2"') &&
      localApiSrc.includes("stored: true") &&
      smokeSrc.includes("Archived upload") &&
      smokeSrc.includes("Server archive created"),
    `unstoredOk=${unstoredBackup.ok} storedOk=${storedBackup.ok} inline=${inlinePayload ? "yes" : "no"}`,
  );

  const unstoredRow = {
    backup_id: "bak-unstored",
    status: "RECORDED_NO_R2",
    r2_key: "backups/bak-unstored.json",
  };
  const storedRow = {
    backup_id: "bak-stored",
    status: "STORED",
    r2_key: "backups/bak-stored.json",
  };
  record(
    "UAT-66",
    "Backup catalog Load is refused for RECORDED_NO_R2 / missing r2_key; GET unstored is 404 not a snapshot",
    backupCatalogRowHasStoredPayload(unstoredRow) === false &&
      backupCatalogRowHasStoredPayload(storedRow) === true &&
      backupCatalogListNote([unstoredRow]).includes("payload not stored") &&
      isLoadableBackupPayload({
        error: "Backup payload was not stored",
        backupId: "bak-1",
      }) === false &&
      isLoadableBackupPayload({ teachers: [] }) === false &&
      isLoadableBackupPayload({ teachers: [], schools: [], centres: [] }) ===
        true &&
      backupSrc.includes("backupCatalogRowHasStoredPayload") &&
      backupSrc.includes("isLoadableBackupPayload") &&
      backupSrc.includes("Payload not stored") &&
      backupSrc.includes("disabled={!canBackup || busy || !hasStored}") &&
      !backupSrc.includes("Newest first — load one to restore it with its stored checksum") &&
      apiTsSrc.includes("isLoadableBackupPayload") &&
      workerSrc.includes('error: "Backup payload was not stored"') &&
      localApiSrc.includes('error: "Backup payload was not stored"') &&
      workerSrc.includes('meta.status === "RECORDED_NO_R2" || !key') &&
      localApiSrc.includes('meta.status === "RECORDED_NO_R2"') &&
      importSrc.includes("stored:false receipt means the file was not archived") &&
      !importSrc.includes("Uploads are archived when the API accepts them"),
    `unstoredLoad=${backupCatalogRowHasStoredPayload(unstoredRow)} storedLoad=${backupCatalogRowHasStoredPayload(storedRow)}`,
  );

  const reposSrc = readFileSync("worker/src/db/repos.ts", "utf8");
  record(
    "UAT-67",
    "Encrypted restore and POST /api/restore refuse non-snapshot JSON (catalog receipt / non-array cores) instead of preview-OK or empty-wipe",
    isLoadableBackupPayload({
      error: "Backup payload was not stored",
      backupId: "bak-1",
      stored: false,
    }) === false &&
      isLoadableBackupPayload({ teachers: { backupId: "bak-1" } }) === false &&
      isLoadableBackupPayload({ teachers: [], schools: [], centres: [] }) ===
        true &&
      backupSrc.includes("Decrypted file is not a restore snapshot") &&
      backupSrc.includes("isLoadableBackupPayload(payload)") &&
      backupSrc.includes("isLoadableBackupPayload(pendingPayload)") &&
      apiTsSrc.includes("Backup payload is not a canonical snapshot") &&
      reposSrc.includes("isLoadableBackupPayload") &&
      reposSrc.includes("missing core collections") &&
      workerSrc.includes('url.pathname === "/api/restore"') &&
      localApiSrc.includes("restore already ran") &&
      !backupSrc.includes(
        "Restore preview OK — teachers=${teachers?.length ?? 0}",
      ),
    `catalog=${isLoadableBackupPayload({ backupId: "bak-1" })} emptyCores=${isLoadableBackupPayload({ teachers: [], schools: [], centres: [] })}`,
  );

  const allOk = shouldApplySessionAfterApis([{ ok: true }, { ok: true }]);
  const mixedPublish = shouldApplySessionAfterApis([
    { ok: true },
    { error: "Allocation run run_prac not found" },
  ]);
  const timeoutPublish = shouldApplySessionAfterApis([{ ok: true }, null]);
  const offlinePublish = shouldApplySessionAfterApis([null, null]);
  record(
    "UAT-68",
    "Publish applies session only when every reached sibling succeeded; practical generate waits for pair memory and does not treat a fetch miss as an empty catalog",
    allOk.apply === true &&
      allOk.offline === false &&
      mixedPublish.apply === false &&
      timeoutPublish.apply === false &&
      offlinePublish.apply === true &&
      offlinePublish.offline === true &&
      classifyHydrateList(null, []) === "failed" &&
      classifyHydrateList({ pairs: [] }, []) === "empty" &&
      appCtxSrc.includes("shouldApplySessionAfterApis(publishResults)") &&
      practicalSrc.includes("classifyHydrateList(res, res?.pairs)") &&
      practicalSrc.includes('if (outcome === "failed" || !res)') &&
      practicalSrc.includes("pair-memory-failed") &&
      practicalSrc.includes("pair-memory-loading") &&
      practicalSrc.includes("!pairsReady") &&
      practicalSrc.includes("!rulesReady") &&
      practicalSrc.includes("!exemptionsReady") &&
      smokeSrc.includes("pair-memory-empty") &&
      !practicalSrc.includes("setPairRows(res?.pairs ?? [])"),
    `mixed=${mixedPublish.apply} timeout=${timeoutPublish.apply} offline=${offlinePublish.offline} classifyFail=${classifyHydrateList(null, [])}`,
  );

  record(
    "UAT-69",
    "Theory/practical/hall generate wait for the exemptions catalog; a GET miss is unavailable, not an empty list",
    catalogUsableForGenerate(false, undefined) === false &&
      catalogUsableForGenerate(true, "failed") === false &&
      catalogUsableForGenerate(true, "empty") === true &&
      catalogUsableForGenerate(true, "ok") === true &&
      classifyHydrateList(null, []) === "failed" &&
      classifyHydrateList({ exemptions: [] }, []) === "empty" &&
      appCtxSrc.includes("sources.exemptions = classifyHydrateList") &&
      appCtxSrc.includes("if (ex?.exemptions)") &&
      !appCtxSrc.includes("setExemptions(ex?.exemptions ?? [])") &&
      theorySrc.includes("catalogUsableForGenerate") &&
      theorySrc.includes("!exemptionsReady") &&
      theorySrc.includes("exemptions-failed") &&
      theorySrc.includes("exemptions-loading") &&
      hallSrc.includes("catalogUsableForGenerate") &&
      hallSrc.includes("!rulesReady || !exemptionsReady") &&
      practicalSrc.includes("catalogUsableForGenerate") &&
      practicalSrc.includes("Waiting for exemptions from the API") &&
      masterSrc.includes("exemptions-failed") &&
      masterSrc.includes("exemptions-empty") &&
      masterSrc.includes("Exemptions unavailable") &&
      smokeSrc.includes(
        'generateTheory.getByText("Generate theory allocation").waitFor()',
      ),
    `emptyUsable=${catalogUsableForGenerate(true, "empty")} failUsable=${catalogUsableForGenerate(true, "failed")}`,
  );

  record(
    "UAT-70",
    "Theory/practical/hall generate wait for rule parameters; a GET miss is unavailable, not a DEFAULT overlay",
    catalogUsableForGenerate(false, undefined) === false &&
      catalogUsableForGenerate(true, "failed") === false &&
      catalogUsableForGenerate(true, "empty") === true &&
      catalogUsableForGenerate(true, "ok") === true &&
      classifyHydrateList(null, []) === "failed" &&
      classifyHydrateList({ parameters: [] }, []) === "empty" &&
      appCtxSrc.includes("sources.rule_parameters = classifyHydrateList") &&
      appCtxSrc.includes("if (paramsApi?.parameters?.length)") &&
      !appCtxSrc.includes("setRules(DEFAULT_RULE_PARAMETERS)") &&
      theorySrc.includes("catalogUsableForGenerate(hydrateReady, rulesOutcome)") &&
      theorySrc.includes("!rulesReady") &&
      theorySrc.includes("rules-failed") &&
      theorySrc.includes("rules-loading") &&
      hallSrc.includes("catalogUsableForGenerate(hydrateReady, rulesOutcome)") &&
      hallSrc.includes("Rules unavailable") &&
      practicalSrc.includes("catalogUsableForGenerate(hydrateReady, rulesOutcome)") &&
      practicalSrc.includes(
        "Rule parameters could not be loaded from the API",
      ) &&
      settingsSrc.includes("rules-failed") &&
      settingsSrc.includes("seed defaults, not the stored catalog") &&
      smokeSrc.includes(
        'generateTheory.getByText("Generate theory allocation").waitFor()',
      ),
    `emptyUsable=${catalogUsableForGenerate(true, "empty")} failUsable=${catalogUsableForGenerate(true, "failed")}`,
  );

  record(
    "UAT-71",
    "Theory/hall generate wait for exam-cycles, centres, and clubbing; practical waits for exam-cycles. A GET miss is unavailable, not the session seed. Empty GET still allows first-boot generate.",
    catalogUsableForGenerate(false, undefined) === false &&
      catalogUsableForGenerate(true, "failed") === false &&
      catalogUsableForGenerate(true, "empty") === true &&
      catalogUsableForGenerate(true, "ok") === true &&
      firstUnusableGenerateCatalogLabel(true, [
        { outcome: "failed", failed: "Cycle unavailable", loading: "Loading cycle…" },
      ]) === "Cycle unavailable" &&
      firstUnusableGenerateCatalogLabel(true, [
        { outcome: "empty", failed: "Cycle unavailable", loading: "Loading cycle…" },
      ]) === null &&
      classifyHydrateList(null, []) === "failed" &&
      classifyHydrateList({ cycles: [] }, []) === "empty" &&
      classifyHydrateList({ centres: [] }, []) === "empty" &&
      classifyHydrateList({ relationships: [] }, []) === "empty" &&
      appCtxSrc.includes("sources.exam_cycles = classifyHydrateList") &&
      appCtxSrc.includes("sources.centres = classifyHydrateList") &&
      appCtxSrc.includes("sources.relationships = classifyHydrateList") &&
      appCtxSrc.includes("INITIAL_CYCLE") &&
      theorySrc.includes("catalogUsableForGenerate(hydrateReady, cyclesOutcome)") &&
      theorySrc.includes("catalogUsableForGenerate(hydrateReady, centresOutcome)") &&
      theorySrc.includes("relationshipsOutcome") &&
      theorySrc.includes("!cyclesReady") &&
      theorySrc.includes("!centresReady") &&
      theorySrc.includes("!relationshipsReady") &&
      theorySrc.includes("cycle-failed") &&
      theorySrc.includes("centres-failed") &&
      theorySrc.includes("clubbing-failed") &&
      hallSrc.includes("catalogUsableForGenerate(hydrateReady, cyclesOutcome)") &&
      hallSrc.includes("catalogUsableForGenerate(hydrateReady, centresOutcome)") &&
      hallSrc.includes("!rulesReady || !exemptionsReady") &&
      hallSrc.includes("Cycle unavailable") &&
      hallSrc.includes("Centres unavailable") &&
      hallSrc.includes("Clubbing unavailable") &&
      practicalSrc.includes("catalogUsableForGenerate(hydrateReady, cyclesOutcome)") &&
      practicalSrc.includes("!cyclesReady") &&
      practicalSrc.includes("Exam cycle could not be loaded from the API") &&
      !practicalSrc.includes("centresOutcome") &&
      !practicalSrc.includes("relationshipsOutcome") &&
      smokeSrc.includes(
        'generateTheory.getByText("Generate theory allocation").waitFor()',
      ),
    `emptyUsable=${catalogUsableForGenerate(true, "empty")} failUsable=${catalogUsableForGenerate(true, "failed")} firstBoot=${appCtxSrc.includes("ec_2027_hsc")}`,
  );

  record(
    "UAT-72",
    "Theory/hall generate wait for teachers, schools, and duty history; practical waits for teachers and schools. A GET miss is unavailable, not the session seed. Empty GET still allows first-boot generate.",
    catalogUsableForGenerate(false, undefined) === false &&
      catalogUsableForGenerate(true, "failed") === false &&
      catalogUsableForGenerate(true, "empty") === true &&
      catalogUsableForGenerate(true, "ok") === true &&
      firstUnusableGenerateCatalogLabel(true, [
        {
          outcome: "failed",
          failed: "Teachers unavailable",
          loading: "Loading teachers…",
        },
      ]) === "Teachers unavailable" &&
      firstUnusableGenerateCatalogLabel(true, [
        {
          outcome: "empty",
          failed: "Teachers unavailable",
          loading: "Loading teachers…",
        },
      ]) === null &&
      classifyHydrateList(null, []) === "failed" &&
      classifyHydrateList({ teachers: [] }, []) === "empty" &&
      classifyHydrateList({ schools: [] }, []) === "empty" &&
      classifyHydrateList({ history: [] }, []) === "empty" &&
      appCtxSrc.includes("sources.teachers = classifyHydrateList") &&
      appCtxSrc.includes("sources.schools = classifyHydrateList") &&
      appCtxSrc.includes("sources.duty_history = classifyHydrateList") &&
      appCtxSrc.includes("pickAuthoritativeList") &&
      theorySrc.includes("catalogUsableForGenerate(hydrateReady, teachersOutcome)") &&
      theorySrc.includes("catalogUsableForGenerate(hydrateReady, schoolsOutcome)") &&
      theorySrc.includes("catalogUsableForGenerate(hydrateReady, historyOutcome)") &&
      theorySrc.includes("!teachersReady") &&
      theorySrc.includes("!schoolsReady") &&
      theorySrc.includes("!historyReady") &&
      theorySrc.includes("teachers-failed") &&
      theorySrc.includes("schools-failed") &&
      theorySrc.includes("history-failed") &&
      hallSrc.includes("catalogUsableForGenerate(hydrateReady, teachersOutcome)") &&
      hallSrc.includes("catalogUsableForGenerate(hydrateReady, schoolsOutcome)") &&
      hallSrc.includes("catalogUsableForGenerate(hydrateReady, historyOutcome)") &&
      hallSrc.includes("!rulesReady || !exemptionsReady") &&
      hallSrc.includes("Teachers unavailable") &&
      hallSrc.includes("Schools unavailable") &&
      hallSrc.includes("Duty history unavailable") &&
      practicalSrc.includes("catalogUsableForGenerate(hydrateReady, teachersOutcome)") &&
      practicalSrc.includes("catalogUsableForGenerate(hydrateReady, schoolsOutcome)") &&
      practicalSrc.includes("!teachersReady") &&
      practicalSrc.includes("!schoolsReady") &&
      practicalSrc.includes("Teachers could not be loaded from the API") &&
      !practicalSrc.includes("historyOutcome") &&
      !practicalSrc.includes("historyReady") &&
      !practicalSrc.includes("centresOutcome") &&
      !practicalSrc.includes("relationshipsOutcome") &&
      !theorySrc.includes("catalogUsableForGenerate(hydrateReady, blocksOutcome)") &&
      !theorySrc.includes("catalogUsableForGenerate(hydrateReady, subjectsOutcome)") &&
      smokeSrc.includes(
        'generateTheory.getByText("Generate theory allocation").waitFor()',
      ),
    `emptyUsable=${catalogUsableForGenerate(true, "empty")} failUsable=${catalogUsableForGenerate(true, "failed")} firstBoot=${appCtxSrc.includes("ec_2027_hsc")}`,
  );

  record(
    "UAT-73",
    "Theory/practical/hall generate wait for allocation runs (cross-module calendar). A GET miss is unavailable, not an empty calendar. Empty GET still allows first-boot generate.",
    catalogUsableForGenerate(false, undefined) === false &&
      catalogUsableForGenerate(true, "failed") === false &&
      catalogUsableForGenerate(true, "empty") === true &&
      catalogUsableForGenerate(true, "ok") === true &&
      firstUnusableGenerateCatalogLabel(true, [
        {
          outcome: "failed",
          failed: "Allocation runs unavailable",
          loading: "Loading allocation runs…",
        },
      ]) === "Allocation runs unavailable" &&
      firstUnusableGenerateCatalogLabel(true, [
        {
          outcome: "empty",
          failed: "Allocation runs unavailable",
          loading: "Loading allocation runs…",
        },
      ]) === null &&
      classifyHydrateList(null, []) === "failed" &&
      classifyHydrateList({ runs: [] }, []) === "empty" &&
      appCtxSrc.includes("sources.allocation_runs = classifyHydrateList") &&
      theorySrc.includes("catalogUsableForGenerate(hydrateReady, runsOutcome)") &&
      theorySrc.includes("!runsReady") &&
      theorySrc.includes("runs-failed") &&
      theorySrc.includes("runs-loading") &&
      hallSrc.includes("catalogUsableForGenerate(hydrateReady, runsOutcome)") &&
      hallSrc.includes("Allocation runs unavailable") &&
      hallSrc.includes("!runsReady") &&
      practicalSrc.includes("catalogUsableForGenerate(hydrateReady, runsOutcome)") &&
      practicalSrc.includes("!runsReady") &&
      practicalSrc.includes("Allocation runs could not be loaded from the API") &&
      !theorySrc.includes("catalogUsableForGenerate(hydrateReady, blocksOutcome)") &&
      !theorySrc.includes("catalogUsableForGenerate(hydrateReady, subjectsOutcome)") &&
      smokeSrc.includes(
        'generateTheory.getByText("Generate theory allocation").waitFor()',
      ),
    `emptyUsable=${catalogUsableForGenerate(true, "empty")} failUsable=${catalogUsableForGenerate(true, "failed")}`,
  );

  record(
    "UAT-74",
    "Override persist + hydrate Why name the replacement teacher, not the generated pick",
    overrideWhyLiveOk &&
      theorySrc.includes("mergeOverrideIntoDecisionTrace") &&
      theorySrc.includes('data-testid="why-selected"') &&
      theorySrc.includes("decisionTrace.teacherId") &&
      theorySrc.includes("decisionTrace.selectedBecause") &&
      reposSrc.includes("mergeOverrideIntoDecisionTrace") &&
      reposSrc.includes("decision_trace_json = ?") &&
      reposSrc.includes(
        "COALESCE(arr.final_teacher_id, arr.teacher_id) AS teacher_id",
      ) &&
      smokeSrc.includes('getByTestId("why-selected")') &&
      smokeSrc.includes("manual override"),
    `live=${overrideWhyLiveOk} teacher=${overrideWhyTrace?.teacherId ?? "none"} because=${overrideWhyTrace?.selectedBecause ?? "none"}`,
  );

  const flagsSrc = readFileSync("shared/src/persistedFlags.ts", "utf8");
  record(
    "UAT-75",
    "Override persist + list omit INFO-SELECTED so Validation does not keep the generated pick",
    overrideWhyLiveOk &&
      flagsSrc.includes("isOverriddenGeneratedSelectionReason") &&
      reposSrc.includes("isOverriddenGeneratedSelectionReason") &&
      reposSrc.includes("DELETE FROM allocation_decision_reasons") &&
      reposSrc.includes("rule_code LIKE 'INFO-%'") &&
      smokeSrc.includes('getByTestId("persisted-reasons-table")') &&
      smokeSrc.includes("INFO-SELECTED") &&
      smokeSrc.includes("MANUAL_OVERRIDE"),
    `reasons=${overrideWhyReasons.map((r) => r.rule_code).join(",") || "none"} staleInfo=${overrideWhyStaleReasons.some((r) => r.rule_code.startsWith("INFO-"))}`,
  );

  record(
    "UAT-76",
    "Override persist + list omit generate INFO-* so Validation does not attribute them to the replacement",
    overrideWhyLiveOk &&
      flagsSrc.includes("isGeneratedInfoRuleCode") &&
      reposSrc.includes("rule_code LIKE 'INFO-%'") &&
      smokeSrc.includes("INFO-DISTANCE") &&
      smokeSrc.includes("INFO-FAIRNESS") &&
      smokeSrc.includes("INFO-HM-FALLBACK") &&
      overrideWhyReasons.every((r) => !r.rule_code.startsWith("INFO-")) &&
      overrideWhyStaleReasons.every((r) => !r.rule_code.startsWith("INFO-")),
    `reasons=${overrideWhyReasons.map((r) => r.rule_code).join(",") || "none"} stale=${overrideWhyStaleReasons.map((r) => r.rule_code).join(",") || "none"}`,
  );

  const conflictsSrc = readFileSync("shared/src/persistedConflicts.ts", "utf8");
  record(
    "UAT-77",
    "Override list does not attribute generate RULE-* / conflicts / fallback WARN to the replacement",
    overrideRulesLiveOk &&
      flagsSrc.includes("isCentreLevelGenerateFinding") &&
      flagsSrc.includes("teacherFromDetails === generated") &&
      conflictsSrc.includes("generated_teacher_id") &&
      conflictsSrc.includes("inheritedJoin") &&
      reposSrc.includes("generated_teacher_id") &&
      reposSrc.includes("details_json?: string | null") &&
      smokeSrc.includes("RULE-THEORY-DISTANCE") &&
      smokeSrc.includes("RULE-CONFLICT-SESSION") &&
      smokeSrc.includes("UNVERIFIED_HISTORY_USED"),
    `reasons=${overrideRulesReasons.map((r) => `${r.rule_code}:${r.teacher_id || "-"}`).join(",") || "none"} stale=${overrideRulesStaleReasons.map((r) => r.rule_code).join(",") || "none"}`,
  );

  // Leftover-wipe checks remaster the shared UAT sqlite (demo teachers gone;
  // allocation_run_results has no teacher FK, duty_assignments does). Isolate
  // so publish is judged on a real master, not a dirty-DB FK miss.
  const pracExtSqlite = new Database(":memory:");
  pracExtSqlite.pragma("foreign_keys = ON");
  const pracExtDb = createSqliteClient(pracExtSqlite);
  await applyMigrations(pracExtDb, ROOT);
  const pracExtNow = new Date().toISOString();
  for (const b of demo.blocks ?? []) {
    pracExtSqlite
      .prepare(
        `INSERT OR IGNORE INTO blocks (block_id, block_code, block_name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run(b.blockId, b.blockCode, b.blockName, pracExtNow, pracExtNow);
  }
  const pracExtRestore = await transactionalRestore(pracExtDb, demo, {
    adminConfirmed: true,
    includeHistory: true,
  });
  const pracExtCycle = await createExamCycle(pracExtDb, {
    examCycleId: "ec_uat_prac_pub",
    name: "UAT practical publish",
    academicYear: "2027",
    ruleVersionId: "rv-2027-1",
    createdBy: "uat-local",
    status: "OPEN",
  });
  const pracExtPersist = await persistAllocationRun(pracExtDb, {
    runId: "run_uat_prac_publish_ext",
    examCycleId: "ec_uat_prac_pub",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "practical-1.0.0",
    module: "PRACTICAL",
    validationStatus: "VALID",
    createdBy: "uat-local",
    summaryJson: JSON.stringify({ schedules: 1, feasible: true }),
    results: [
      {
        resultId: "res_uat_prac_pub_int",
        teacherId: flagTeacher.teacherId,
        centreId: flagSchool.schoolId,
        dutyTypeCode: "PRACTICAL_INTERNAL",
        roleCode: "PRACTICAL_INTERNAL",
        examDate: "2027-03-20",
        sessionCode: "MORNING",
        score: 0,
        decisionTraceJson: JSON.stringify({
          batchKey: `${flagSchool.schoolId}|PHYSICS|0`,
          schoolId: flagSchool.schoolId,
          subjectId: "PHYSICS",
          externalExaminerId: flagTeacherB.teacherId,
        }),
        usedFallback: false,
      },
    ],
  });
  const pracExtBatches = await persistPracticalBatches(pracExtDb, {
    examCycleId: "ec_uat_prac_pub",
    runId: "run_uat_prac_publish_ext",
    academicYear: "2027",
    batches: [
      {
        batchId: `${flagSchool.schoolId}|PHYSICS|0`,
        schoolId: flagSchool.schoolId,
        subjectCode: "PHYSICS",
        studentCount: 30,
        batchIndex: 0,
        examDate: "2027-03-20",
        sessionCode: "MORNING",
        internalExaminerId: flagTeacher.teacherId,
        externalExaminerId: flagTeacherB.teacherId,
      },
    ],
  });
  const pracExtPub = await publishRunToHistory(
    pracExtDb,
    "run_uat_prac_publish_ext",
    "ec_uat_prac_pub",
    "2027",
  );
  const pracExtHist = (await listDutyHistory(pracExtDb)) as Array<{
    run_id?: string | null;
    teacher_id: string;
    duty_type_code: string;
  }>;
  const pracExtForRun = pracExtHist.filter(
    (h) => h.run_id === "run_uat_prac_publish_ext",
  );
  const pracExtDualHydrated = practicalSchedulesFromPersistedResults([
    {
      teacher_id: flagTeacher.teacherId,
      centre_id: flagSchool.schoolId,
      duty_type_code: "PRACTICAL_INTERNAL",
      role_code: "PRACTICAL_INTERNAL",
      exam_date: "2027-03-20",
      session_code: "MORNING",
      score: 0,
      decision_trace_json: JSON.stringify({
        batchKey: `${flagSchool.schoolId}|PHYSICS|0`,
        schoolId: flagSchool.schoolId,
        subjectId: "PHYSICS",
        externalExaminerId: flagTeacherB.teacherId,
      }),
    },
    {
      teacher_id: flagTeacherB.teacherId,
      centre_id: flagSchool.schoolId,
      duty_type_code: "PRACTICAL_EXTERNAL",
      role_code: "PRACTICAL_EXTERNAL",
      exam_date: "2027-03-20",
      session_code: "MORNING",
      score: 0,
      decision_trace_json: JSON.stringify({
        batchKey: `${flagSchool.schoolId}|PHYSICS|0`,
        schoolId: flagSchool.schoolId,
        subjectId: "PHYSICS",
        externalExaminerId: flagTeacherB.teacherId,
      }),
    },
  ]);
  const practicalPageSrc = readFileSync("frontend/src/pages/PracticalPage.tsx", "utf8");
  record(
    "UAT-78",
    "Publish practical writes PRACTICAL_EXTERNAL history from schedules; hydrate does not invent a second schedule",
    pracExtRestore.ok === true &&
      pracExtCycle.ok === true &&
      pracExtPersist.reasonCount >= 0 &&
      pracExtBatches.ok === true &&
      pracExtPub.ok === true &&
      pracExtPub.ok &&
      pracExtPub.published === 2 &&
      pracExtForRun.some(
        (h) =>
          h.teacher_id === flagTeacher.teacherId &&
          h.duty_type_code === "PRACTICAL_INTERNAL",
      ) &&
      pracExtForRun.some(
        (h) =>
          h.teacher_id === flagTeacherB.teacherId &&
          h.duty_type_code === "PRACTICAL_EXTERNAL",
      ) &&
      pracExtForRun.length === 2 &&
      pracExtDualHydrated.length === 1 &&
      pracExtDualHydrated[0]?.internalExaminerId === flagTeacher.teacherId &&
      pracExtDualHydrated[0]?.externalExaminerId === flagTeacherB.teacherId &&
      practicalPageSrc.includes('dutyTypeCode: "PRACTICAL_EXTERNAL"') &&
      reposSrc.includes("practicalSchedulePublishSlots") &&
      reposSrc.includes('run.module === "PRACTICAL"'),
    `restore=${pracExtRestore.ok} batches=${pracExtBatches.ok === true ? "ok" : pracExtBatches.error} published=${pracExtPub.ok ? pracExtPub.published : pracExtPub.error} hist=${pracExtForRun.map((h) => h.duty_type_code).join(",") || "none"} schedules=${pracExtDualHydrated.length}`,
  );
  pracExtSqlite.close();

  const hallPubSqlite = new Database(":memory:");
  hallPubSqlite.pragma("foreign_keys = ON");
  const hallPubDb = createSqliteClient(hallPubSqlite);
  await applyMigrations(hallPubDb, ROOT);
  const hallPubNow = new Date().toISOString();
  for (const b of demo.blocks ?? []) {
    hallPubSqlite
      .prepare(
        `INSERT OR IGNORE INTO blocks (block_id, block_code, block_name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run(b.blockId, b.blockCode, b.blockName, hallPubNow, hallPubNow);
  }
  const hallPubRestore = await transactionalRestore(hallPubDb, demo, {
    adminConfirmed: true,
    includeHistory: true,
  });
  const hallPubCycle = await createExamCycle(hallPubDb, {
    examCycleId: "ec_uat_hall_pub",
    name: "UAT hall publish",
    academicYear: "2027",
    ruleVersionId: "rv-2027-1",
    createdBy: "uat-local",
    status: "OPEN",
  });
  const hallPubPersist = await persistAllocationRun(hallPubDb, {
    runId: "run_uat_hall_publish",
    examCycleId: "ec_uat_hall_pub",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: "hall-1.0.0",
    module: "HALL",
    validationStatus: "VALID",
    createdBy: "uat-local",
    summaryJson: JSON.stringify({ assignments: 2, feasible: true }),
    results: [
      {
        resultId: "res_uat_hall_pub_inv",
        teacherId: flagTeacher.teacherId,
        centreId: flagCentre.centreId,
        dutyTypeCode: "HALL_INVIGILATOR",
        roleCode: "HALL_INVIGILATOR",
        examDate: "2027-03-15",
        sessionCode: "MORNING",
        score: 0,
        decisionTraceJson: JSON.stringify({ slotIndex: 1 }),
        usedFallback: false,
      },
      {
        resultId: "res_uat_hall_pub_stb",
        teacherId: flagTeacherB.teacherId,
        centreId: flagCentre.centreId,
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
  const hallPub = await publishRunToHistory(
    hallPubDb,
    "run_uat_hall_publish",
    "ec_uat_hall_pub",
    "2027",
  );
  const hallPubHist = (await listDutyHistory(hallPubDb)) as Array<{
    run_id?: string | null;
    teacher_id: string;
    duty_type_code: string;
  }>;
  const hallPubForRun = hallPubHist.filter(
    (h) => h.run_id === "run_uat_hall_publish",
  );
  const hallPageSrc = readFileSync("frontend/src/pages/HallPage.tsx", "utf8");
  record(
    "UAT-79",
    "Hall/practical review tables show every persisted slot; hall publish writes invigilator and standby history",
    hallPubRestore.ok === true &&
      hallPubCycle.ok === true &&
      hallPubPersist.reasonCount >= 0 &&
      hallPub.ok === true &&
      hallPub.ok &&
      hallPub.published === 2 &&
      hallPubForRun.some(
        (h) =>
          h.teacher_id === flagTeacher.teacherId &&
          h.duty_type_code === "HALL_INVIGILATOR",
      ) &&
      hallPubForRun.some(
        (h) =>
          h.teacher_id === flagTeacherB.teacherId &&
          h.duty_type_code === "HALL_STANDBY",
      ) &&
      hallPubForRun.length === 2 &&
      hallPageSrc.includes("hallResult.assignments.map(") &&
      !hallPageSrc.includes("assignments.slice(0,") &&
      practicalPageSrc.includes("practicalResult.schedules.map(") &&
      !practicalPageSrc.includes("schedules.slice(0,") &&
      practicalPageSrc.includes("usablePairs.map(") &&
      !practicalPageSrc.includes("usablePairs.slice("),
    `restore=${hallPubRestore.ok} published=${hallPub.ok ? hallPub.published : hallPub.error} hist=${hallPubForRun.map((h) => h.duty_type_code).join(",") || "none"}`,
  );
  hallPubSqlite.close();

  const burstTheory = Array.from({ length: 9 }, (_, i) => ({
    module: "THEORY" as const,
    run_id: `t${i}`,
    created_at: `2027-03-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
  }));
  const hydrateListed = allocationRunsToHydrate([
    ...burstTheory,
    {
      module: "HALL" as const,
      run_id: "h_older",
      created_at: "2027-03-01T00:00:00.000Z",
    },
    {
      module: "PRACTICAL" as const,
      run_id: "p_older",
      created_at: "2027-03-02T00:00:00.000Z",
    },
  ]);
  record(
    "UAT-80",
    "Boot hydrate reconstructs every listed allocation run so a theory burst cannot drop persisted hall/practical",
    appCtxSrc.includes("allocationRunsToHydrate(runsApi.runs)") &&
      !appCtxSrc.includes("runsApi.runs.slice(") &&
      hydrateListed.length === 11 &&
      hydrateListed.some((r) => r.run_id === "h_older") &&
      hydrateListed.some((r) => r.run_id === "p_older"),
    `helper=${appCtxSrc.includes("allocationRunsToHydrate(runsApi.runs)")} sliced=${appCtxSrc.includes("runsApi.runs.slice(")} listed=${hydrateListed.length}`,
  );

  const resultsMiss = allocationRunResultsFromFetch(null);
  const resultsEmpty = allocationRunResultsFromFetch({ results: [] });
  const resultsOk = allocationRunResultsFromFetch({
    results: [{ teacher_id: "t1" }],
  });
  record(
    "UAT-81",
    "Boot hydrate does not treat a per-run results GET miss as empty assignments; allocation_runs catalog fails so generate cannot use an invented empty calendar",
    resultsMiss.missed === true &&
      resultsEmpty.missed === false &&
      resultsEmpty.results.length === 0 &&
      resultsOk.missed === false &&
      resultsOk.results.length === 1 &&
      appCtxSrc.includes("allocationRunResultsFromFetch(detail)") &&
      appCtxSrc.includes('sources.allocation_runs = "failed"') &&
      !appCtxSrc.includes("detail?.results ?? []"),
    `miss=${resultsMiss.missed} empty=${resultsEmpty.missed ? "missed" : resultsEmpty.results.length} helper=${appCtxSrc.includes("allocationRunResultsFromFetch(detail)")} swallow=${appCtxSrc.includes("detail?.results ?? []")}`,
  );

  const reasonsMiss = allocationRunReasonsFromFetch(null);
  const reasonsEmpty = allocationRunReasonsFromFetch({ reasons: [] });
  const reasonsOk = allocationRunReasonsFromFetch({
    reasons: [{ rule_code: "RULE-CONFLICT-SESSION" }],
  });
  record(
    "UAT-82",
    "Boot hydrate does not treat a per-run reasons GET miss as empty Validation/Why rows; allocation_runs catalog fails so generate cannot use an invented empty issue list",
    reasonsMiss.missed === true &&
      reasonsEmpty.missed === false &&
      reasonsEmpty.reasons.length === 0 &&
      reasonsOk.missed === false &&
      reasonsOk.reasons.length === 1 &&
      appCtxSrc.includes("allocationRunReasonsFromFetch(reasonsApi)") &&
      appCtxSrc.includes('sources.allocation_runs = "failed"') &&
      !appCtxSrc.includes("reasonsApi?.reasons ?? []"),
    `miss=${reasonsMiss.missed} empty=${reasonsEmpty.missed ? "missed" : reasonsEmpty.reasons.length} helper=${appCtxSrc.includes("allocationRunReasonsFromFetch(reasonsApi)")} swallow=${appCtxSrc.includes("reasonsApi?.reasons ?? []")}`,
  );

  const burstTheory100 = Array.from({ length: 100 }, (_, i) => ({
    module: "THEORY" as const,
    run_id: `t${i}`,
    created_at: `2027-06-01T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
  }));
  const mergedLatest = mergeAllocationRunsWithLatestPerModule(burstTheory100, [
    burstTheory100[burstTheory100.length - 1]!,
    {
      module: "HALL" as const,
      run_id: "h_older",
      created_at: "2027-01-01T00:00:00.000Z",
    },
    {
      module: "PRACTICAL" as const,
      run_id: "p_older",
      created_at: "2027-01-02T00:00:00.000Z",
    },
  ]);
  const calendarSrc = readFileSync(
    "frontend/src/lib/crossModuleCalendar.ts",
    "utf8",
  );
  record(
    "UAT-83",
    "Allocation-run list used for boot hydrate/calendar includes the latest run per module so a 100-run theory recency window cannot drop hall/practical",
    reposSrc.includes("mergeAllocationRunsWithLatestPerModule") &&
      reposSrc.includes("listLatestAllocationRunPerModule") &&
      calendarSrc.includes("latestRunForModule") &&
      mergedLatest.length === 102 &&
      mergedLatest.some((r) => r.run_id === "h_older") &&
      mergedLatest.some((r) => r.run_id === "p_older"),
    `helper=${reposSrc.includes("mergeAllocationRunsWithLatestPerModule")} calendar=${calendarSrc.includes("latestRunForModule")} listed=${mergedLatest.length}`,
  );

  const leftoverInvalidMix = [
    {
      module: "PRACTICAL" as const,
      runId: "p_old",
      createdAt: "2027-03-03T00:00:00.000Z",
      examCycleId: "ec_published",
      validation: { status: "INVALID" as const },
    },
    {
      module: "THEORY" as const,
      runId: "t_amend",
      createdAt: "2027-03-04T00:00:00.000Z",
      examCycleId: "ec_amend",
      validation: { status: "VALID" as const },
    },
  ];
  const amendPractical = latestRunForModuleInCycle(
    leftoverInvalidMix,
    "PRACTICAL",
    "ec_amend",
  );
  const amendTheory = latestRunForModuleInCycle(
    leftoverInvalidMix,
    "THEORY",
    "ec_amend",
  );
  const leftoverWouldBlock =
    leftoverInvalidMix.find((r) => r.module === "PRACTICAL")?.validation
      .status === "INVALID";
  const leftoverHall = publishableSiblingRun({
    runId: "run_live_hall_short",
    module: "HALL",
    result: { assignments: [{}] },
    validation: { status: "INVALID" as const },
  });
  record(
    "UAT-84",
    "Publish and calendar stay on this cycle; leftover INVALID siblings are omitted with copy instead of blocking publish",
    leftoverWouldBlock &&
      amendPractical === undefined &&
      amendTheory?.runId === "t_amend" &&
      runsForExamCycle(leftoverInvalidMix, "ec_amend").length === 1 &&
      leftoverHall.publish === undefined &&
      leftoverHall.omitted === "hall run_live_hall_short (INVALID)" &&
      appCtxSrc.includes("latestRunForModuleInCycle") &&
      appCtxSrc.includes("publishableSiblingRun") &&
      appCtxSrc.includes("omitted leftover INVALID") &&
      appCtxSrc.includes("examCycleIdRef") &&
      appCtxSrc.includes("h.examCycleId === openCycleId") &&
      appCtxSrc.includes("examCycleId: String(r.exam_cycle_id") &&
      appCtxSrc.includes("examCycleIdRef.current = amd.newCycleId") &&
      calendarSrc.includes("latestRunForModuleInCycle") &&
      calendarSrc.includes("examCycleId: string") &&
      theorySrc.includes('crossModuleCalendar(runs, "THEORY", examCycle.examCycleId)') &&
      practicalPageSrc.includes(
        'crossModuleCalendar(runs, "PRACTICAL", examCycle.examCycleId)',
      ) &&
      hallPageSrc.includes(
        'crossModuleCalendar(runs, "HALL", examCycle.examCycleId)',
      ) &&
      theorySrc.includes("examCycleId: examCycle.examCycleId") &&
      dashSrc.includes("latestRunForModuleInCycle") &&
      dashSrc.includes("runsForExamCycle"),
    `leftoverFind=${leftoverWouldBlock} amendPractical=${amendPractical?.runId ?? "none"} theory=${amendTheory?.runId} omitted=${leftoverHall.omitted} ref=${appCtxSrc.includes("examCycleIdRef")}`,
  );

  const validationSrc = readFileSync(
    "frontend/src/pages/ValidationPage.tsx",
    "utf8",
  );
  const hydratedWindow = { startDate: "2027-04-05", endDate: "2027-04-09" };
  const mountDraft = examWindowDraftInputs({
    startDate: null,
    endDate: null,
  });
  const syncedDraft = examWindowDraftInputs(hydratedWindow);
  const validationOrder = [
    {
      module: "THEORY" as const,
      runId: "t-old",
      createdAt: "2027-03-01T00:00:00.000Z",
      examCycleId: "ec_amend",
    },
    {
      module: "HALL" as const,
      runId: "h-new",
      createdAt: "2027-03-04T00:00:00.000Z",
      examCycleId: "ec_amend",
    },
  ];
  record(
    "UAT-85",
    "Exam-window draft syncs after hydrate so Save cannot wipe stored dates; Validation Latest run is newest-in-cycle by createdAt",
    examWindowDraftWouldClearStored(mountDraft, hydratedWindow) &&
      !examWindowDraftWouldClearStored(syncedDraft, hydratedWindow) &&
      examCycleSrc.includes("examWindowDraftInputs") &&
      examCycleSrc.includes("examCycle.startDate, examCycle.endDate") &&
      runsForExamCycle(validationOrder, "ec_amend")[0]?.runId === "t-old" &&
      latestRunInCycle(validationOrder, "ec_amend")?.runId === "h-new" &&
      validationSrc.includes("latestRunInCycle") &&
      !validationSrc.includes("runsForExamCycle(runs, examCycle.examCycleId)[0]"),
    `wipe=${examWindowDraftWouldClearStored(mountDraft, hydratedWindow)} synced=${!examWindowDraftWouldClearStored(syncedDraft, hydratedWindow)} validation=${latestRunInCycle(validationOrder, "ec_amend")?.runId}`,
  );

  const openExSqlite = new Database(":memory:");
  openExSqlite.pragma("foreign_keys = ON");
  const openExDb = createSqliteClient(openExSqlite);
  await applyMigrations(openExDb, ROOT);
  const openExNow = new Date().toISOString();
  for (const b of demo.blocks ?? []) {
    openExSqlite
      .prepare(
        `INSERT OR IGNORE INTO blocks (block_id, block_code, block_name, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run(b.blockId, b.blockCode, b.blockName, openExNow, openExNow);
  }
  const openExRestore = await transactionalRestore(openExDb, demo, {
    adminConfirmed: true,
    includeHistory: true,
  });
  const openExTeacherId = String(demo.teachers[0]?.teacherId ?? "");
  const openExFirst = await upsertExemption(openExDb, {
    teacherId: openExTeacherId,
    reason: "Hydrated medical",
    effectiveFrom: "2027-01-01",
    createdBy: "uat-local",
  });
  const openExResave = await upsertExemption(openExDb, {
    teacherId: openExTeacherId,
    reason: "Updated medical",
    effectiveFrom: "2027-01-01",
    createdBy: "uat-local",
  });
  const openExEnd = await upsertExemption(openExDb, {
    teacherId: openExTeacherId,
    reason: "Ended by officer",
    effectiveFrom: "2027-01-01",
    effectiveTo: "2027-06-01",
    isExempted: false,
    createdBy: "uat-local",
  });
  const openExRows = ((await listExemptions(openExDb)) as Array<{
    teacher_id: string;
    is_exempted: number;
    reason: string;
    effective_to: string | null;
  }>).filter((r) => r.teacher_id === openExTeacherId);
  const leftoverActiveAfterEnd = openExRows.some(
    (r) => r.is_exempted === 1 && !r.effective_to,
  );
  record(
    "UAT-86",
    "Exemption Save/End reuse the open D1 row so End cannot leave a leftover active that generate still honors",
    openExRestore.ok === true &&
      openExFirst.ok === true &&
      openExResave.ok === true &&
      openExEnd.ok === true &&
      openExFirst.ok &&
      openExResave.ok &&
      openExEnd.ok &&
      openExResave.id === openExFirst.id &&
      openExEnd.id === openExFirst.id &&
      openExRows.length === 1 &&
      openExRows[0]?.reason === "Ended by officer" &&
      openExRows[0]?.is_exempted === 0 &&
      leftoverActiveAfterEnd === false &&
      reposSrc.includes("openExemptionIdForTeacher") &&
      reposSrc.includes("closeSiblingOpenExemptions") &&
      masterSrc.includes("id: existing?.id") &&
      masterSrc.includes("id: e.id") &&
      appCtxSrc.includes("id: e.id") &&
      !appCtxSrc.includes("setExemptions(ex?.exemptions ?? [])"),
    `restore=${openExRestore.ok} first=${openExFirst.ok ? openExFirst.id.slice(0, 8) : openExFirst.error} resave=${openExResave.ok && openExResave.id === (openExFirst.ok ? openExFirst.id : "")} end=${openExEnd.ok && openExEnd.id === (openExFirst.ok ? openExFirst.id : "")} rows=${openExRows.length} leftoverActive=${leftoverActiveAfterEnd}`,
  );
  openExSqlite.close();

  const reloadPickSqlite = new Database(":memory:");
  reloadPickSqlite.pragma("foreign_keys = ON");
  const reloadPickDb = createSqliteClient(reloadPickSqlite);
  await applyMigrations(reloadPickDb, ROOT);
  await upsertExamCycle(reloadPickDb, {
    examCycleId: "ec_2027_hsc",
    name: "2027 HSC Public Examination (Synthetic)",
    academicYear: "2027",
    status: "OPEN",
    ruleVersionId: "rv-2027-1",
    createdBy: "uat-local",
  });
  const publishedParent = await updateExamCycleStatus(
    reloadPickDb,
    "ec_2027_hsc",
    "PUBLISHED",
    { force: true },
  );
  const reloadAmd = await createExamCycle(reloadPickDb, {
    examCycleId: "ec_reload_amd",
    name: "2027 HSC Public Examination (Synthetic) — amendment",
    academicYear: "2027",
    ruleVersionId: "rv-2027-1",
    createdBy: "uat-local",
    status: "DRAFT",
    amendedFromId: "ec_2027_hsc",
    amendmentReason: "Reload must not sit on the published parent",
  });
  const reloadListed = (await listExamCycles(reloadPickDb)) as Array<{
    exam_cycle_id: string;
    status: string;
  }>;
  const leftoverPrefer =
    reloadListed.find((c) => c.exam_cycle_id === "ec_2027_hsc") ??
    reloadListed[0];
  const reloadPicked = pickHydrateExamCycle(reloadListed, "ec_2027_hsc");
  const emptyD1Pick = pickHydrateExamCycle([], "ec_2027_hsc");
  const publishedOnlyPick = pickHydrateExamCycle(
    reloadListed.filter((c) => c.exam_cycle_id === "ec_2027_hsc"),
    "ec_2027_hsc",
  );
  record(
    "UAT-87",
    "Full reload after createAmendment sits on the DRAFT amendment, not leftover published ec_2027_hsc; empty D1 still keeps INITIAL_CYCLE",
    publishedParent.ok === true &&
      reloadAmd.ok === true &&
      leftoverPrefer?.exam_cycle_id === "ec_2027_hsc" &&
      leftoverPrefer?.status === "PUBLISHED" &&
      reloadPicked?.exam_cycle_id === "ec_reload_amd" &&
      reloadPicked?.status === "DRAFT" &&
      emptyD1Pick === undefined &&
      publishedOnlyPick?.exam_cycle_id === "ec_2027_hsc" &&
      appCtxSrc.includes("pickHydrateExamCycle") &&
      !appCtxSrc.includes("c.exam_cycle_id === INITIAL_CYCLE.examCycleId") &&
      appCtxSrc.includes("INITIAL_CYCLE"),
    `parent=${publishedParent.ok} amd=${reloadAmd.ok} leftover=${leftoverPrefer?.exam_cycle_id}:${leftoverPrefer?.status} picked=${reloadPicked?.exam_cycle_id}:${reloadPicked?.status} empty=${emptyD1Pick === undefined} publishedOnly=${publishedOnlyPick?.exam_cycle_id}`,
  );
  reloadPickSqlite.close();

  const failed = checks.filter((c) => !c.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    dbPath,
    runId,
    checksum,
    note: "Synthetic local UAT evidence only. §107 still requires live CF D1/R2, Access IdP, staging UAT, client OQ answers, and explicit human production promote.",
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.ok).length,
      failed: failed.length,
    },
    checks,
  };

  const outLocal = join(ROOT, ".data/uat-local-latest.json");
  writeFileSync(outLocal, JSON.stringify(report, null, 2));
  if (existsSync("/opt/cursor/artifacts")) {
    writeFileSync(
      "/opt/cursor/artifacts/uat-local-evidence.json",
      JSON.stringify(report, null, 2),
    );
  }

  sqlite.close();

  if (failed.length) {
    console.error(
      `\nUAT_LOCAL_FAIL ${failed.length}/${checks.length} — see ${outLocal}`,
    );
    process.exit(1);
  }
  console.log(`\nUAT_LOCAL_OK ${checks.length}/${checks.length} — ${outLocal}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
