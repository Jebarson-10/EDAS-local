import type { CentreChecklistRow } from "./centreChecklist.js";
import type {
  WorkspaceSchool,
  WorkspaceCentre,
  WorkspaceStandard,
} from "./examWorkspace.js";

/** Only spelling/abbreviation normalisation. No fuzzy assignment of a school. */
export function canonicalSchoolNameKey(value: string) {
  return value
    .toUpperCase()
    .replace(/\bG(?:OVT|OVERNMENT)\b/g, "GOVERNMENT")
    .replace(/\bGGHSS\b/g, "GOVERNMENT GIRLS HIGHER SECONDARY SCHOOL")
    .replace(/\bGBHSS\b/g, "GOVERNMENT BOYS HIGHER SECONDARY SCHOOL")
    .replace(/\bGHSS\b/g, "GOVERNMENT HIGHER SECONDARY SCHOOL")
    .replace(/\bGHS\b/g, "GOVERNMENT HIGH SCHOOL")
    .replace(/\bHR\s*\.?\s*SEC(?:ONDARY)?\b/g, "HIGHER SECONDARY")
    .replace(/\bHSS\b/g, "HIGHER SECONDARY SCHOOL")
    .replace(/\bMATRICULATION\b/g, "MATRIC")
    .replace(/\bSEC\b/g, "SECONDARY")
    .replace(/\bGOBICHETTIPALAYAM\b/g, "GOBI")
    .replace(/\bMPL\b/g, "MUNICIPAL")
    .replace(/(?:[\s,.-]+ERODE)?[\s,.-]*\d{6}\s*$/, "")
    .replace(
      /(?:[\s,.-]+ERODE)?[\s,.-]*(?:ERODE|DISTRICT|\(DT\)|TK)[\s,.-]*$/,
      "",
    )
    .replace(/[^A-Z0-9]/g, "");
}
export type WorkspaceChecklistRow = CentreChecklistRow & { udise: string };
/** Advisory only: these suggestions never populate an identity automatically. */
export function workspaceSchoolCandidates(
  name: string,
  schools: WorkspaceSchool[],
  limit = 3,
) {
  const pairs = (s: string) => {
    const values = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) values.add(s.slice(i, i + 2));
    return values;
  };
  const target = pairs(canonicalSchoolNameKey(name));
  return schools
    .map((s) => {
      const candidate = pairs(canonicalSchoolNameKey(s.name));
      let same = 0;
      for (const p of candidate) if (target.has(p)) same++;
      return {
        udise: s.udise,
        name: s.name,
        similarity:
          target.size + candidate.size
            ? (2 * same) / (target.size + candidate.size)
            : 0,
      };
    })
    .sort(
      (a, b) => b.similarity - a.similarity || a.udise.localeCompare(b.udise),
    )
    .slice(0, limit);
}
export function prepareWorkspaceChecklist(
  rows: CentreChecklistRow[],
  schools: WorkspaceSchool[],
) {
  const names = new Map<string, WorkspaceSchool[]>();
  for (const s of schools) {
    const key = canonicalSchoolNameKey(s.name);
    names.set(key, [...(names.get(key) ?? []), s]);
  }
  const unique = (name: string) => {
    const found = names.get(canonicalSchoolNameKey(name));
    return found?.length === 1 ? found[0]!.udise : "";
  };
  return {
    rows: rows.map((row) => ({ ...row, udise: unique(row.schoolName) })),
    hosts: Object.fromEntries(
      [...new Set(rows.map((r) => r.centreCode))].map((code) => [
        code,
        unique(rows.find((r) => r.centreCode === code)!.centreName),
      ]),
    ),
  };
}
export function reviewedWorkspaceCentres(
  rows: WorkspaceChecklistRow[],
  hosts: Record<string, string>,
  standard: WorkspaceStandard,
  schools: WorkspaceSchool[],
): WorkspaceCentre[] {
  const ids = new Set(schools.map((s) => s.udise));
  if (!rows.length) throw new Error("Read the checklist first.");
  return [...new Set(rows.map((r) => r.centreCode))].map((code) => {
    const group = rows.filter((r) => r.centreCode === code);
    if (
      !ids.has(hosts[code] ?? "") ||
      group.some(
        (r) =>
          !ids.has(r.udise) ||
          r.studentCount == null ||
          !Number.isInteger(r.studentCount) ||
          r.studentCount < 0,
      )
    )
      throw new Error(
        `Centre ${code}: select the host and every linked school, and check each student count.`,
      );
    const students = group.reduce((sum, r) => sum + r.studentCount!, 0);
    if (!students)
      throw new Error(
        `Centre ${code}: total students must be greater than zero.`,
      );
    return {
      standard,
      code,
      udise: hosts[code]!,
      students,
      clubbedUdise: [
        ...new Set(group.map((r) => r.udise).filter((u) => u !== hosts[code])),
      ],
    };
  });
}
