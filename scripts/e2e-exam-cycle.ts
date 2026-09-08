/**
 * End-to-end exam-cycle simulation against local SQLite API + engines.
 * Prerequisites: none (boots its own DB file under .data/e2e-*.sqlite)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { DEFAULT_RULE_PARAMETERS } from "../shared/src/index.ts";
import {
  allocateTheory,
  type TheoryDataset,
  type TheoryRequirement,
} from "../allocation-engine/src/index.ts";
import { validateTheoryAllocation } from "../validator/src/index.ts";
import { createSqliteClient } from "../worker/src/db/client.ts";
import { applyMigrations } from "../worker/src/db/migrate.ts";
import {
  persistAllocationRun,
  publishRunToHistory,
  transactionalRestore,
  updateExamCycleStatus,
  upsertExamCycle,
  countMaster,
  insertAudit,
  replaceClubbingRelationships,
  updateCentreCapacities,
  persistPracticalBatches,
  listExaminerPairs,
  createExamCycle,
  listExamCycles,
} from "../worker/src/db/repos.ts";
import { readFileSync } from "node:fs";

const ROOT = process.cwd();
mkdirSync(join(ROOT, ".data"), { recursive: true });
const DB_PATH = join(ROOT, ".data", `e2e-${Date.now()}.sqlite`);

async function main() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("foreign_keys = ON");
  const db = createSqliteClient(sqlite);
  await applyMigrations(db, ROOT);

  const demo = JSON.parse(
    readFileSync(join(ROOT, "frontend/public/demo-dataset.json"), "utf8"),
  );

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
  if (!restored.ok) throw new Error(restored.error);
  console.log("1. restored demo", restored.counts);

  await upsertExamCycle(db, {
    examCycleId: "ec_e2e",
    name: "E2E Synthetic Cycle",
    academicYear: "2027",
    status: "OPEN",
    ruleVersionId: "rv-2027-1",
    createdBy: "e2e",
  });

  const centreId = demo.centres[0]?.centreId as string;
  const schoolId =
    (demo.schools.find(
      (s: { schoolId: string }) =>
        !demo.relationships?.some(
          (r: { schoolId: string; relationshipType: string }) =>
            r.schoolId === s.schoolId && r.relationshipType === "HOST",
        ),
    )?.schoolId as string) ?? (demo.schools[1]?.schoolId as string);

  const club = await replaceClubbingRelationships(db, {
    asOfDate: "2027-03-01",
    relationships: [
      {
        centreId,
        schoolId,
        relationshipType: "CLUBBED",
        effectiveFrom: "2027-03-01",
      },
    ],
  });
  if (!club.ok) throw new Error(club.error);
  const capN = await updateCentreCapacities(db, [{ centreId, capacity: 194 }]);
  if (capN !== 1) throw new Error("capacity update failed");
  console.log("1b. clubbing+capacity", {
    inserted: club.inserted,
    capacity: capN,
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
  console.log("2. allocated", {
    assignments: result.assignments.length,
    status: validation.status,
  });
  if (validation.status === "INVALID") throw new Error("validation INVALID");

  const runId = randomUUID();
  await persistAllocationRun(db, {
    runId,
    examCycleId: "ec_e2e",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: result.algorithmVersion,
    module: "THEORY",
    validationStatus: validation.status,
    createdBy: "e2e",
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
  });
  await updateExamCycleStatus(db, "ec_e2e", "ALLOCATION_GENERATED", {
    force: true,
  });
  console.log("3. persisted run", runId);
  const { listAllocationDecisionReasons } =
    await import("../worker/src/db/repos.ts");
  const reasons = await listAllocationDecisionReasons(db, runId);
  if (reasons.length < 1) {
    throw new Error(
      "expected decision-trace reasons to persist into allocation_decision_reasons",
    );
  }
  console.log("3a. decision reasons", reasons.length);

  const teachers = demo.teachers as Array<{
    teacherId: string;
    schoolId: string;
  }>;
  const internal =
    teachers.find((t) => t.schoolId === schoolId) ?? teachers[0]!;
  const external =
    teachers.find((t) => t.schoolId !== internal.schoolId) ?? teachers[1]!;
  const prac = await persistPracticalBatches(db, {
    examCycleId: "ec_e2e",
    runId,
    batches: [
      {
        batchId: `batch_${schoolId}_phy_0`,
        schoolId,
        subjectCode: "PHY",
        studentCount: 24,
        batchIndex: 0,
        examDate: "2027-03-20",
        sessionCode: "MORNING",
        internalExaminerId: internal.teacherId,
        externalExaminerId: external.teacherId,
      },
    ],
  });
  if (!prac.ok) throw new Error(prac.error);
  const pairs = await listExaminerPairs(db);
  if (prac.pairs !== 1 || pairs.length !== 1) {
    throw new Error(
      `expected practical persistence to record examiner pair memory, got ${pairs.length}`,
    );
  }
  console.log("3b. practical batches", prac);

  const publishedResult = await publishRunToHistory(
    db,
    runId,
    "ec_e2e",
    "2027",
  );
  if (!publishedResult.ok) throw new Error(publishedResult.error);
  const published = publishedResult.published;
  await updateExamCycleStatus(db, "ec_e2e", "PUBLISHED", { force: true });
  await insertAudit(db, {
    auditId: randomUUID(),
    userId: "e2e",
    action: "PUBLISH",
    entity: "allocation_run",
    entityId: runId,
    newValue: String(published),
  });
  console.log("4. published history rows", published);

  const republish = await publishRunToHistory(db, runId, "ec_e2e", "2027");
  if (
    !republish.ok ||
    !republish.alreadyPublished ||
    republish.published !== 0
  ) {
    throw new Error("second publish must be idempotent (published=0)");
  }
  console.log("4a. idempotent republish", republish);

  const amd = await createExamCycle(db, {
    examCycleId: "ec_e2e_amd",
    name: "E2E Amendment",
    academicYear: "2027",
    ruleVersionId: "rv-2027-1",
    createdBy: "e2e",
    amendedFromId: "ec_e2e",
    amendmentReason: "E2E correction path",
  });
  if (!amd.ok) throw new Error(amd.error);
  const cycles = await listExamCycles(db);
  const prev = cycles.find(
    (c) => (c as { exam_cycle_id: string }).exam_cycle_id === "ec_e2e",
  ) as { status: string };
  const next = cycles.find(
    (c) => (c as { exam_cycle_id: string }).exam_cycle_id === "ec_e2e_amd",
  ) as { status: string; amended_from_id: string };
  if (prev.status !== "PUBLISHED" || next.status !== "DRAFT") {
    throw new Error("amendment did not preserve published previous cycle");
  }
  if (next.amended_from_id !== "ec_e2e") {
    throw new Error("amendment linkage missing");
  }
  console.log("4b. amendment", { previous: prev.status, next: next.status });

  // The second cycle is where single-cycle assumptions surface: batch keys,
  // pair memory and published history all repeat for the same schools.
  await updateExamCycleStatus(db, "ec_e2e_amd", "ALLOCATION_GENERATED", {
    force: true,
  });
  const amdRequirements: TheoryRequirement[] = requirements.map((r) => ({
    ...r,
    examDate: "2027-04-15",
  }));
  const amdResult = allocateTheory(
    amdRequirements,
    { ...dataset, asOfDate: "2027-04-01" },
    DEFAULT_RULE_PARAMETERS,
  );
  const amdValidation = validateTheoryAllocation(
    amdRequirements,
    amdResult,
    { ...dataset, asOfDate: "2027-04-01" },
    DEFAULT_RULE_PARAMETERS,
  );
  if (amdValidation.status === "INVALID") {
    throw new Error("amendment allocation validation INVALID");
  }
  const amdRunId = randomUUID();
  await persistAllocationRun(db, {
    runId: amdRunId,
    examCycleId: "ec_e2e_amd",
    ruleVersionId: "rv-2027-1",
    algorithmVersion: amdResult.algorithmVersion,
    module: "THEORY",
    validationStatus: amdValidation.status,
    createdBy: "e2e",
    summaryJson: JSON.stringify({
      assignments: amdResult.assignments.length,
    }),
    results: amdResult.assignments.map((a) => ({
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
  });

  // Same batch key as cycle one: unique only within a cycle.
  const amdPrac = await persistPracticalBatches(db, {
    examCycleId: "ec_e2e_amd",
    runId: amdRunId,
    batches: [
      {
        batchId: `batch_${schoolId}_phy_0`,
        schoolId,
        subjectCode: "PHY",
        studentCount: 26,
        batchIndex: 0,
        examDate: "2027-04-20",
        sessionCode: "MORNING",
        internalExaminerId: external.teacherId,
        externalExaminerId: internal.teacherId,
      },
    ],
  });
  if (!amdPrac.ok) {
    throw new Error(`second cycle practical persist failed: ${amdPrac.error}`);
  }
  const { listPracticalBatches } = await import("../worker/src/db/repos.ts");
  const firstCyclePrac = await listPracticalBatches(db, "ec_e2e");
  const amdCyclePrac = await listPracticalBatches(db, "ec_e2e_amd");
  if (
    firstCyclePrac.batches.length !== 1 ||
    firstCyclePrac.schedules.length !== 1
  ) {
    throw new Error(
      `second cycle disturbed cycle-one practical rows (batches=${firstCyclePrac.batches.length} schedules=${firstCyclePrac.schedules.length})`,
    );
  }
  if (
    amdCyclePrac.batches.length !== 1 ||
    amdCyclePrac.schedules.length !== 1
  ) {
    throw new Error("second cycle practical rows missing after persist");
  }
  // Pair memory must keep both cycles: the annual role switch reads history.
  const pairsAfter = await listExaminerPairs(db);
  if (pairsAfter.length !== 2) {
    throw new Error(
      `expected pair memory for both cycles, got ${pairsAfter.length}`,
    );
  }
  console.log("4c. second cycle practical", amdPrac);

  const amdPublished = await publishRunToHistory(
    db,
    amdRunId,
    "ec_e2e_amd",
    "2027",
  );
  if (!amdPublished.ok) throw new Error(amdPublished.error);
  if (amdPublished.published !== amdResult.assignments.length) {
    throw new Error(
      `second cycle publish wrote ${amdPublished.published} of ${amdResult.assignments.length} rows`,
    );
  }
  await updateExamCycleStatus(db, "ec_e2e_amd", "PUBLISHED", { force: true });
  console.log("4d. second cycle published", amdPublished.published);

  const counts = await countMaster(db);
  console.log("5. final counts", counts);
  if (published !== result.assignments.length) {
    throw new Error("published count mismatch");
  }
  if ((counts.history ?? 0) < published) {
    throw new Error("history not retained");
  }

  console.log("E2E_CYCLE_OK", DB_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
