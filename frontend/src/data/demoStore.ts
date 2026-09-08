import type { HistoricalDuty, Teacher } from "@exam-duty/shared";

export interface DemoDataset {
  meta: { note: string; counts: Record<string, number>; slice?: string };
  blocks: Array<{ blockId: string; blockCode: string; blockName: string }>;
  schools: Array<{
    schoolId: string;
    schoolCode: string;
    schoolName: string;
    blockId: string;
    latitude: number;
    longitude: number;
    active: boolean;
  }>;
  centres: Array<{
    centreId: string;
    centreCode: string;
    centreName: string;
    blockId: string;
    latitude: number;
    longitude: number;
    capacity?: number;
    active: boolean;
  }>;
  relationships: Array<{
    centreId: string;
    schoolId: string;
    relationshipType: "HOST" | "CLUBBED";
    effectiveFrom: string;
    effectiveTo?: string | null;
  }>;
  teachers: Teacher[];
  history: HistoricalDuty[];
  /** Seed / D1 subject catalogue — optional on older demo JSON. */
  subjects?: Array<{
    subjectId: string;
    code: string;
    name: string;
    isPractical: boolean;
    active: boolean;
  }>;
}

/** Inline minimal demo if JSON seed not yet generated. */
function inlineDemo(): DemoDataset {
  const blocks = [
    { blockId: "blk_01", blockCode: "B1", blockName: "Synthetic Block 1" },
    { blockId: "blk_02", blockCode: "B2", blockName: "Synthetic Block 2" },
  ];
  const schools = Array.from({ length: 12 }, (_, i) => ({
    schoolId: `sch_${i + 1}`,
    schoolCode: `S${i + 1}`,
    schoolName: `Synthetic School ${i + 1}`,
    blockId: blocks[i % 2]!.blockId,
    latitude: 11.33 + i * 0.008,
    longitude: 77.71 + i * 0.006,
    active: true,
  }));
  const centres = Array.from({ length: 6 }, (_, i) => ({
    centreId: `ctr_${i + 1}`,
    centreCode: `C${i + 1}`,
    centreName: `Synthetic Centre ${i + 1}`,
    blockId: blocks[i % 2]!.blockId,
    latitude: schools[i]!.latitude,
    longitude: schools[i]!.longitude,
    capacity: 240,
    active: true,
  }));
  const relationships = centres.flatMap((c, i) => {
    const rel: Array<{
      centreId: string;
      schoolId: string;
      relationshipType: "HOST" | "CLUBBED";
      effectiveFrom: string;
    }> = [
      {
        centreId: c.centreId,
        schoolId: schools[i]!.schoolId,
        relationshipType: "HOST",
        effectiveFrom: "2020-01-01",
      },
    ];
    if (i % 2 === 0) {
      rel.push({
        centreId: c.centreId,
        schoolId: schools[(i + 3) % schools.length]!.schoolId,
        relationshipType: "CLUBBED",
        effectiveFrom: "2024-01-01",
      });
    }
    return rel;
  });
  const teachers: Teacher[] = Array.from({ length: 48 }, (_, i) => ({
    teacherId: `tch_${i + 1}`,
    employeeCode: `SYN${String(i + 1).padStart(4, "0")}`,
    name: `Synthetic Teacher ${i + 1}`,
    schoolId: schools[i % schools.length]!.schoolId,
    designation: i % 8 === 0 ? "HM" : i % 3 === 0 ? "SENIOR_PG" : "PG",
    subject: "MAT",
    seniorityRank: i + 1,
    homeLatitude: schools[i % schools.length]!.latitude + 0.002,
    homeLongitude: schools[i % schools.length]!.longitude + 0.002,
    isActive: true,
    dataQuality: "Imported",
  }));
  const subjects = [
    {
      subjectId: "sub-phy",
      code: "PHY",
      name: "Physics",
      isPractical: true,
      active: true,
    },
    {
      subjectId: "sub-che",
      code: "CHE",
      name: "Chemistry",
      isPractical: true,
      active: true,
    },
    {
      subjectId: "sub-bio",
      code: "BIO",
      name: "Biology",
      isPractical: true,
      active: true,
    },
    {
      subjectId: "sub-cs",
      code: "CS",
      name: "Computer Science",
      isPractical: true,
      active: true,
    },
    {
      subjectId: "sub-voc",
      code: "VOC",
      name: "Vocational",
      isPractical: true,
      active: true,
    },
    {
      subjectId: "sub-eng",
      code: "ENG",
      name: "English",
      isPractical: false,
      active: true,
    },
    {
      subjectId: "sub-tam",
      code: "TAM",
      name: "Tamil",
      isPractical: false,
      active: true,
    },
    {
      subjectId: "sub-mat",
      code: "MAT",
      name: "Mathematics",
      isPractical: false,
      active: true,
    },
  ];
  const history: HistoricalDuty[] = teachers.slice(0, 20).map((t, i) => ({
    teacherId: t.teacherId,
    centreId: centres[i % centres.length]!.centreId,
    dutyTypeCode: "CHIEF_EXAMINATION",
    examDate: "2026-03-12",
    sessionCode: "MORNING",
    academicYear: "2026",
    dataQuality: "Confirmed",
  }));
  return {
    meta: {
      note: "SYNTHETIC DATA ONLY — not real government records",
      counts: {
        blocks: blocks.length,
        schools: schools.length,
        centres: centres.length,
        teachers: teachers.length,
        history: history.length,
        subjects: subjects.length,
      },
      slice: "inline-demo",
    },
    blocks,
    schools,
    centres,
    relationships,
    teachers,
    history,
    subjects,
  };
}

export async function loadDemoDataset(): Promise<DemoDataset> {
  try {
    const res = await fetch("/demo-dataset.json");
    if (res.ok) {
      return (await res.json()) as DemoDataset;
    }
  } catch {
    // fall through
  }
  return inlineDemo();
}
