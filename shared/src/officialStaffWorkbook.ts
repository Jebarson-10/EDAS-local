import { normalizeImportValue } from "./importValues.js";
import { normalizeImportedDesignation } from "./excelTeachers.js";

export type OfficialStaffWorkbookSheet = {
  name: string;
  lines: unknown[][];
};

export type OfficialStaffWorkbookParse = {
  detectedSheetNames: string[];
  rows: Array<Record<string, unknown>>;
  warnings: string[];
};

const recognisedSheets = new Set([
  "HM",
  "PG",
  "BT",
  "BT NON",
  "SGT",
  "SPL",
  "NON TEACHING",
]);

function cellText(value: unknown): string {
  if (!value || typeof value !== "object" || value instanceof Date) {
    return String(value ?? "");
  }
  const cell = value as {
    result?: unknown;
    text?: string;
    richText?: Array<{ text?: string }>;
  };
  if (cell.result != null) return cellText(cell.result);
  if (cell.richText) return cell.richText.map((item) => item.text ?? "").join("");
  if (cell.text != null) return cell.text;
  return String(value);
}

function clean(value: unknown): string {
  return cellText(value)
    .trim()
    .replace(/\s+/g, " ");
}

function heading(value: unknown): string {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function textAt(row: unknown[], index: number | undefined): string | undefined {
  if (index == null) return undefined;
  const text = clean(row[index]);
  return text || undefined;
}

function isNumberOnly(value: string | undefined): boolean {
  return Boolean(value && /^\d+(?:\.0+)?$/.test(value));
}

function dateAt(row: unknown[], indexes: number[]): string | undefined {
  for (const index of indexes) {
    if (index < 0) continue;
    try {
      const raw = row[index];
      const date = normalizeImportValue(
        "joiningDate",
        raw instanceof Date ? raw : cellText(raw),
      );
      if (typeof date === "string") return date;
    } catch {
      // The official form may split a date over three columns; try the next form.
    }
  }
  for (const index of indexes) {
    const day = clean(row[index]);
    const month = clean(row[index + 1]);
    const year = clean(row[index + 2]);
    if (!day || !month || !year) continue;
    try {
      const date = normalizeImportValue(
        "joiningDate",
        `${day}/${month}/${year}`,
      );
      if (typeof date === "string") return date;
    } catch {
      // Keep looking; a nearby date field may be the actual appointment date.
    }
  }
  return undefined;
}

function headerRowIndex(lines: unknown[][]): number {
  return lines.findIndex((row) => {
    const headings = Array.from(row, heading);
    return (
      headings.includes("SCHOOLCODE") &&
      headings.includes("NAMEOFTHESCHOOL") &&
      headings.some((item) =>
        ["HEADMASTERNAME", "TEACHERSNAME", "NAMEOFTHEEMPLOYEE"].some(
          (nameHeading) => item.startsWith(nameHeading),
        ),
      )
    );
  });
}

function isFormInstructionRow(name: string, schoolName: string, schoolCode: string | undefined): boolean {
  const joined = `${name} ${schoolName} ${schoolCode ?? ""}`.toUpperCase();
  return !schoolCode ||
    /^\d+$/.test(name) ||
    /S\.?(NO|NUMBER)|TEACHERS? NAME|HEADMASTER NAME|NAME OF THE EMPLOYEE|NAME OF THE SCHOOL|SCHOOL CODE/.test(joined);
}

function designationForSheet(
  sheetName: string,
  supplied: string | undefined,
): string | undefined {
  // The SPL form represents the special-teacher pool. Its individual post
  // names vary, but this pool is confirmed for hall invigilation only.
  if (sheetName === "SPL") return "SPECIAL_TEACHER";
  const normalised = supplied ? normalizeImportedDesignation(supplied) : "";
  if (normalised) return normalised;
  if (sheetName === "HM") return "HM";
  if (sheetName === "PG") return "PG";
  if (sheetName === "BT" || sheetName === "BT NON") return "BT";
  if (sheetName === "SGT") return "SGT";
  if (sheetName === "SPL") return "SPECIAL_TEACHER";
  return undefined;
}

/**
 * Reads the CEO's seven-tab staff workbook. It deliberately uses the school
 * name, not the source "SCHOOL CODE", because in EDAS a blank centre code
 * means a school is not a centre. That avoids accidentally turning every
 * school in the source staff list into an exam centre.
 */
export function parseOfficialStaffWorkbook(
  sheets: OfficialStaffWorkbookSheet[],
): OfficialStaffWorkbookParse {
  const rows: Array<Record<string, unknown>> = [];
  const detectedSheetNames: string[] = [];
  const warnings: string[] = [];

  for (const sheet of sheets) {
    const sheetName = clean(sheet.name).toUpperCase();
    if (!recognisedSheets.has(sheetName)) continue;
    const headerIndex = headerRowIndex(sheet.lines);
    if (headerIndex < 0) continue;
    detectedSheetNames.push(sheet.name);

    const headers = Array.from(sheet.lines[headerIndex] ?? [], heading);
    const firstIndex = (names: string[]) =>
      headers.findIndex((item) => names.includes(item));
    const schoolNameIndex = firstIndex(["NAMEOFTHESCHOOL"]);
    const schoolCodeIndex = firstIndex(["SCHOOLCODE"]);
    const nameIndex = headers.findIndex((item) =>
      ["HEADMASTERNAME", "TEACHERSNAME", "NAMEOFTHEEMPLOYEE"].some(
        (nameHeading) => item.startsWith(nameHeading),
      ),
    );
    const designationIndex = firstIndex(["DESIGNATION"]);
    const subjectIndexes = headers
      .map((item, index) => (item.includes("SUBJECT") ? index : -1))
      .filter((index) => index >= 0);
    const handlingSubjectIndex = headers.findIndex((item) =>
      sheetName === "PG"
        ? item.includes("1112THHANDLINGSUBJECT")
        : sheetName === "BT"
          ? item.includes("10THHANDLINGSUBJECT")
          : item === "HANDLINGSUBJECTS",
    );
    const majorSubjectIndex = firstIndex(["MAJORSUBJECT"]);
    const appointmentIndex = headers.findIndex((item) =>
      item.startsWith("DATEOFAPPOINTMENT"),
    );
    const retirementIndex = headers.findIndex((item) => item.startsWith("DATEOFRETIREMENT"));
    const schoolTypeIndex = headers.findIndex((item) => item.startsWith("TYPE"));
    const sexIndex = headers.findIndex((item) => item.startsWith("SEX"));
    const mobileIndex = headers.findIndex((item) => item.startsWith("MOBILENO"));
    const qualificationIndex = firstIndex(["QUALIFICATION"]);
    const residentialIndex = headers.findIndex((item) => item.startsWith("RESIDENTIALUNION"));
    const previousExamIndex = headers.findIndex((item) =>
      item.startsWith("PREVIOUSEXAMDUTY") || item.startsWith("LASTSSLCHSCEXAMINATIONDUTY"),
    );
    const previousCampIndex = headers.findIndex((item) => item.startsWith("PREVIOUSCAMPDUTY"));
    const exceptionIndex = headers.findIndex((item) =>
      item.startsWith("IFEMPOLYEEISPHYSICALLY") || item.startsWith("REMARKS"),
    );
    const blockIndex = firstIndex(["BLOCK"]);
    const additionalSubjectIndex = headers.findIndex((item) => item.startsWith("ADDITIONALHANDLINGSUBJECT"));

    let added = 0;
    for (let index = headerIndex + 1; index < sheet.lines.length; index += 1) {
      const source = sheet.lines[index] ?? [];
      const name = textAt(source, nameIndex);
      const schoolName = textAt(source, schoolNameIndex);
      const sourceSchoolCode = textAt(source, schoolCodeIndex);
      if (!name || !schoolName || isNumberOnly(name) || isFormInstructionRow(name, schoolName, sourceSchoolCode)) continue;
      const designation = designationForSheet(
        sheetName,
        textAt(source, designationIndex),
      );
      if (!designation) {
        warnings.push(`${sheet.name}, row ${index + 1}: no staff post was found.`);
        continue;
      }
      // FORM-02 and FORM-03 explicitly state the subject actually handled at
      // the relevant standard. That field is authoritative for practical duty;
      // use a major subject only when no handling-subject field exists.
      const subject =
        textAt(source, handlingSubjectIndex >= 0 ? handlingSubjectIndex : undefined) ??
        textAt(source, additionalSubjectIndex >= 0 ? additionalSubjectIndex : undefined) ??
        textAt(source, subjectIndexes.length === 1 ? subjectIndexes[0] : majorSubjectIndex);
      const details = Object.fromEntries(
        [
          ["Source sheet", sheet.name],
          ["School reference code", sourceSchoolCode],
          ["School type", textAt(source, schoolTypeIndex)],
          ["Sex", textAt(source, sexIndex)],
          ["Mobile number", textAt(source, mobileIndex)],
          ["Qualification", textAt(source, qualificationIndex)],
          ["Major subject", textAt(source, majorSubjectIndex)],
          ["Handling subject", textAt(source, handlingSubjectIndex >= 0 ? handlingSubjectIndex : undefined)],
          ["Additional handling subjects", textAt(source, additionalSubjectIndex >= 0 ? additionalSubjectIndex : undefined)],
          ["Retirement date", retirementIndex >= 0 ? dateAt(source, [retirementIndex]) : undefined],
          ["Residential union/block", textAt(source, residentialIndex)],
          ["Previous exam duty", textAt(source, previousExamIndex)],
          ["Previous camp duty", textAt(source, previousCampIndex)],
          ["Health, leave or remarks", textAt(source, exceptionIndex)],
          ["Reporting block", textAt(source, blockIndex)],
        ].filter((entry): entry is [string, string] => Boolean(entry[1])),
      );
      rows.push({
        name,
        schoolName,
        // This official code identifies the school, not the examination centre.
        // Keep centre code blank so an ordinary school is never made a centre.
        schoolCode: "",
        ...(sourceSchoolCode ? { sourceSchoolCode } : {}),
        designation,
        ...(subject ? { subject } : {}),
        ...(appointmentIndex >= 0
          ? { joiningDate: dateAt(source, [appointmentIndex]) }
          : {}),
        isActive: true,
        staffCategory:
          sheetName === "NON TEACHING" ? "NON_TEACHING" : "TEACHING",
        ...(Object.keys(details).length ? { officialDetails: details } : {}),
      });
      added += 1;
    }
    if (added === 0) {
      warnings.push(`${sheet.name}: no staff rows were found below the headings.`);
    }
    if (subjectIndexes.length > 1 && handlingSubjectIndex < 0) {
      warnings.push(
        `${sheet.name}: major and handling subject were left blank for review; choose the practical subject manually.`,
      );
    }
  }

  // FORM-02 supplies appointment dates but no usable seniority-rank column.
  // Earlier appointment date receives the lower rank. The row's source order
  // breaks exact-date ties deterministically; S.NO is never used as rank.
  const rankedPgRows = rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        row.designation === "PG" && typeof row.joiningDate === "string",
    )
    .sort((left, right) => {
      const date = String(left.row.joiningDate).localeCompare(
        String(right.row.joiningDate),
      );
      return date || left.index - right.index;
    });
  rankedPgRows.forEach(({ row }, index) => {
    row.seniorityRank = index + 1;
  });

  return { detectedSheetNames, rows, warnings };
}
