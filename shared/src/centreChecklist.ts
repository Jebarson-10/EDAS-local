/** The official centre-and-school checklist. Counts are per school, not per centre. */
export interface CentreChecklistRow {
  centreCode: string;
  centreName: string;
  sourceSchoolCode: string;
  schoolName: string;
  studentCount: number | null;
  page: number;
  sourceLine: string;
}

export function schoolReferenceKey(value: string): string {
  // The district prefix in 13A is absent from some staff returns.
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^\d{3}[A-Z]{4}\d{4}$/.test(compact) ? compact.slice(3) : compact;
}

export function schoolNameKey(value: string): string {
  return value.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function parseCentreChecklist(pages: string[]) {
  const rows: CentreChecklistRow[] = [];
  const errors: string[] = [];
  let standard: "10" | "12" | null = null;
  let academicYear: string | null = null;
  let centreCode = "";
  let centreName = "";
  pages.forEach((text, pageIndex) => {
    const pageStandard = /\bSSLC\b/i.test(text) ? "10" : /\bHSE|\bHSC|HIGHER SECONDARY/i.test(text) ? "12" : null;
    if (pageStandard && standard && pageStandard !== standard) errors.push(`Page ${pageIndex + 1}: different examination standards appear in this file.`);
    standard ??= pageStandard;
    academicYear ??= text.match(/(?:MARCH|APRIL|EXAMINATION)[^\n]*?\b(20\d{2})\b/i)?.[1] ?? null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const centre = line.match(/Cent(?:re|er)\s*Code\s*[:.]?\s*(\d+)\s+Cent(?:re|er)\s*Name\s*[:.]?\s*(.+)/i);
      if (centre) { centreCode = centre[1]!; centreName = centre[2]!.trim(); continue; }
      if (!line || /SCHOOL\s*CODE|MIN[_. ]?REG|MAX[_. ]?REG|^Page\s+\d|CHECK LIST|District (Code|Name)/i.test(line)) continue;
      if (/Cent(?:re|er)\s*Code/i.test(line)) {
        centreCode = ""; centreName = "";
        errors.push(`Page ${pageIndex + 1}: check the centre heading: ${line}`);
        continue;
      }
      // Three trailing columns are registration bounds and count. Preserve an
      // unreadable count for correction rather than converting it to zero.
      const row = line.match(/^\d{3}\s+([A-Z0-9]+)\s+(.+?)\s+(?:\d+|\[1\]|[Oo])\s+(?:\d+|\[1\]|[Oo])\s+(\S+)\s*$/i);
      if (!row) {
        if (/^\d{3}\s/.test(line)) errors.push(`Page ${pageIndex + 1}: could not read a school row: ${line}`);
        continue;
      }
      if (!centreCode) { errors.push(`Page ${pageIndex + 1}: school has no readable centre heading: ${line}`); continue; }
      const count = /^\d+$/.test(row[3]!) ? Number(row[3]) : null;
      rows.push({ centreCode, centreName, sourceSchoolCode: row[1]!, schoolName: row[2]!.trim(), studentCount: count, page: pageIndex + 1, sourceLine: line });
    }
  });
  if (!rows.length) errors.push("No school rows were found. Check that this is the centre and school checklist.");
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.centreCode}|${row.sourceSchoolCode}`;
    if (seen.has(key)) errors.push(`School ${row.sourceSchoolCode} appears twice at centre ${row.centreCode}. Check the repeated row.`);
    seen.add(key);
  }
  return { rows, errors, standard, academicYear };
}

export interface ReviewedChecklistRow extends CentreChecklistRow {
  schoolId?: string;
  blockId: string;
  hostSchoolKey: string;
}
