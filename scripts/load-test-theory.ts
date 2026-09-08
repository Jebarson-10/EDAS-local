/**
 * Synthetic load test — theory allocation against large dataset.
 * Run: npx tsx scripts/load-test-theory.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_RULE_PARAMETERS } from "../shared/src/index.ts";
import {
  allocateTheory,
  type TheoryDataset,
  type TheoryRequirement,
} from "../allocation-engine/src/index.ts";
import { validateTheoryAllocation } from "../validator/src/index.ts";

const path = join(process.cwd(), "database/seeds/synthetic/dataset.json");
if (!existsSync(path)) {
  console.error("Missing synthetic dataset. Run: npm run seed:synthetic");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(path, "utf8")) as {
  teachers: TheoryDataset["teachers"];
  schools: TheoryDataset["schools"];
  centres: TheoryDataset["centres"];
  relationships: TheoryDataset["relationships"];
  history: TheoryDataset["history"];
  meta: { counts: Record<string, number> };
};

const dataset: TheoryDataset = {
  teachers: raw.teachers,
  schools: raw.schools,
  centres: raw.centres,
  relationships: raw.relationships,
  exemptions: [],
  history: raw.history,
  calendar: [],
  academicYear: "2027",
  asOfDate: "2027-03-01",
};

const requirements: TheoryRequirement[] = raw.centres.map((c) => ({
  requirementKey: `${c.centreId}-CHIEF`,
  centreId: c.centreId,
  roleCode: "CHIEF_EXAMINATION",
  examDate: "2027-03-15",
  sessionCode: "MORNING",
  preferredDesignations: ["HM", "PRINCIPAL"],
  fallbackDesignations: ["SENIOR_PG"],
}));

console.log("Load counts", raw.meta.counts);
console.log("Requirements", requirements.length);

const t0 = performance.now();
const result = allocateTheory(requirements, dataset, DEFAULT_RULE_PARAMETERS);
const t1 = performance.now();
const validation = validateTheoryAllocation(
  requirements,
  result,
  dataset,
  DEFAULT_RULE_PARAMETERS,
);
const t2 = performance.now();

console.log({
  allocateMs: Math.round(t1 - t0),
  validateMs: Math.round(t2 - t1),
  assignments: result.assignments.length,
  shortages: result.shortages.length,
  feasible: result.feasible,
  validation: validation.status,
  errors: validation.errors,
});

if (
  result.assignments.length + result.shortages.length !==
  requirements.length
) {
  console.error("Invariant failed: assignments+shortages != requirements");
  process.exit(1);
}
console.log("LOAD_TEST_OK");
