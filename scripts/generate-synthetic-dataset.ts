/**
 * Generates a synthetic dataset for development/load tests.
 * Contains NO real government PII.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BLOCKS = 15;
const CENTRES = 350;
const SCHOOLS = 1000;
const TEACHERS = 5000;

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const rand = seeded(20270101);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

const designations = ["HM", "PRINCIPAL", "SENIOR_PG", "PG"];

const blocks = Array.from({ length: BLOCKS }, (_, i) => ({
  blockId: `blk_${String(i + 1).padStart(2, "0")}`,
  blockCode: `B${i + 1}`,
  blockName: `Synthetic Block ${i + 1}`,
}));

const schools = Array.from({ length: SCHOOLS }, (_, i) => {
  const block = blocks[i % BLOCKS]!;
  const lat = 11.2 + rand() * 0.4;
  const lon = 77.5 + rand() * 0.5;
  return {
    schoolId: `sch_${String(i + 1).padStart(4, "0")}`,
    schoolCode: `S${i + 1}`,
    schoolName: `Synthetic School ${i + 1}`,
    blockId: block.blockId,
    latitude: Number(lat.toFixed(5)),
    longitude: Number(lon.toFixed(5)),
    active: true,
  };
});

const centres = Array.from({ length: CENTRES }, (_, i) => {
  const block = blocks[i % BLOCKS]!;
  const host = schools[i % SCHOOLS]!;
  return {
    centreId: `ctr_${String(i + 1).padStart(3, "0")}`,
    centreCode: `C${i + 1}`,
    centreName: `Synthetic Centre ${i + 1}`,
    blockId: block.blockId,
    latitude: host.latitude,
    longitude: host.longitude,
    capacity: 200 + Math.floor(rand() * 200),
    active: true,
    hostSchoolId: host.schoolId,
  };
});

const relationships = centres.flatMap((c, i) => {
  const rel = [
    {
      centreId: c.centreId,
      schoolId: c.hostSchoolId,
      relationshipType: "HOST" as const,
      effectiveFrom: "2020-01-01",
    },
  ];
  // Some clubbed centres
  if (i % 7 === 0) {
    const extra = schools[(i + 3) % SCHOOLS]!;
    rel.push({
      centreId: c.centreId,
      schoolId: extra.schoolId,
      relationshipType: "CLUBBED" as const,
      effectiveFrom: "2024-01-01",
    });
    if (i % 21 === 0) {
      const extra2 = schools[(i + 9) % SCHOOLS]!;
      rel.push({
        centreId: c.centreId,
        schoolId: extra2.schoolId,
        relationshipType: "CLUBBED" as const,
        effectiveFrom: "2025-01-01",
      });
    }
  }
  return rel;
});

const teachers = Array.from({ length: TEACHERS }, (_, i) => {
  const school = schools[i % SCHOOLS]!;
  return {
    teacherId: `tch_${String(i + 1).padStart(5, "0")}`,
    employeeCode: `SYN${String(i + 1).padStart(5, "0")}`,
    name: `Synthetic Teacher ${i + 1}`,
    schoolId: school.schoolId,
    designation:
      i % 40 === 0 ? "HM" : i % 15 === 0 ? "SENIOR_PG" : pick(designations),
    subject: pick(["PHY", "CHE", "BIO", "CS", "MAT", "ENG"]),
    seniorityRank: i + 1,
    homeLatitude: Number((school.latitude + (rand() - 0.5) * 0.05).toFixed(5)),
    homeLongitude: Number(
      (school.longitude + (rand() - 0.5) * 0.05).toFixed(5),
    ),
    isActive: true,
    dataQuality: "Imported" as const,
  };
});

// Two years of synthetic duty history for repeat-centre testing
const history = teachers.slice(0, 2000).flatMap((t, i) => {
  const c2025 = centres[i % CENTRES]!;
  const c2026 = centres[(i + 17) % CENTRES]!;
  return [
    {
      teacherId: t.teacherId,
      centreId: c2025.centreId,
      dutyTypeCode: "CHIEF_EXAMINATION",
      examDate: "2025-03-12",
      sessionCode: "MORNING",
      academicYear: "2025",
      dataQuality: "Confirmed",
    },
    {
      teacherId: t.teacherId,
      centreId: c2026.centreId,
      dutyTypeCode: "CHIEF_EXAMINATION",
      examDate: "2026-03-12",
      sessionCode: "MORNING",
      academicYear: "2026",
      dataQuality: "Confirmed",
    },
  ];
});

const outDir = join(process.cwd(), "database", "seeds", "synthetic");
mkdirSync(outDir, { recursive: true });

const payload = {
  meta: {
    generatedAt: new Date().toISOString(),
    note: "SYNTHETIC DATA ONLY — not real government records",
    counts: {
      blocks: blocks.length,
      schools: schools.length,
      centres: centres.length,
      teachers: teachers.length,
      history: history.length,
    },
  },
  blocks,
  schools,
  centres: centres.map(({ hostSchoolId: _, ...c }) => c),
  relationships,
  teachers,
  history,
};

writeFileSync(join(outDir, "dataset.json"), JSON.stringify(payload));

// Smaller demo slice for UI / local API — must stay referentially consistent
const DEMO_SCHOOLS = 30;
const DEMO_CENTRES = 10;
const DEMO_TEACHERS = 120;
const demoSchools = schools.slice(0, DEMO_SCHOOLS);
const demoCentresFull = centres.slice(0, DEMO_CENTRES);
const demoSchoolIds = new Set(demoSchools.map((s) => s.schoolId));
const demoCentreIds = new Set(demoCentresFull.map((c) => c.centreId));
const demoBlockIds = new Set([
  ...demoSchools.map((s) => s.blockId),
  ...demoCentresFull.map((c) => c.blockId),
]);
const demoBlocks = blocks.filter((b) => demoBlockIds.has(b.blockId));
const demoTeachers = teachers.slice(0, DEMO_TEACHERS).map((t, i) => ({
  ...t,
  // Remap onto the demo school slice (full dataset uses i % SCHOOLS)
  schoolId: demoSchools[i % demoSchools.length]!.schoolId,
}));
const demoRelationships = relationships.filter(
  (r) => demoCentreIds.has(r.centreId) && demoSchoolIds.has(r.schoolId),
);
// Build demo history against the demo centre slice (full history uses i % CENTRES)
const demoHistory = demoTeachers.flatMap((t, i) => {
  const c2025 = demoCentresFull[i % demoCentresFull.length]!;
  const c2026 = demoCentresFull[(i + 3) % demoCentresFull.length]!;
  return [
    {
      teacherId: t.teacherId,
      centreId: c2025.centreId,
      dutyTypeCode: "CHIEF_EXAMINATION",
      examDate: "2025-03-12",
      sessionCode: "MORNING",
      academicYear: "2025",
      dataQuality: "Confirmed",
    },
    {
      teacherId: t.teacherId,
      centreId: c2026.centreId,
      dutyTypeCode: "CHIEF_EXAMINATION",
      examDate: "2026-03-12",
      sessionCode: "MORNING",
      academicYear: "2026",
      dataQuality: "Confirmed",
    },
  ];
});

const demo = {
  meta: {
    ...payload.meta,
    slice: "demo-ui",
    counts: {
      blocks: demoBlocks.length,
      schools: demoSchools.length,
      centres: demoCentresFull.length,
      teachers: demoTeachers.length,
      relationships: demoRelationships.length,
      history: demoHistory.length,
    },
  },
  blocks: demoBlocks,
  schools: demoSchools,
  centres: demoCentresFull.map(({ hostSchoolId: _, ...c }) => c),
  relationships: demoRelationships,
  teachers: demoTeachers,
  history: demoHistory,
};
writeFileSync(join(outDir, "demo-dataset.json"), JSON.stringify(demo, null, 2));

// Keep frontend public copy in sync for Vite/static load
const frontendDemo = join(
  process.cwd(),
  "frontend",
  "public",
  "demo-dataset.json",
);
writeFileSync(frontendDemo, JSON.stringify(demo, null, 2));
console.log("Wrote synthetic dataset to", outDir);
console.log("Wrote UI demo to", frontendDemo);
console.log(payload.meta.counts);
console.log("demo", demo.meta.counts);
