/**
 * Subject code normalisation shared by the API (which resolves `subjects` rows)
 * and the UI (which must map persisted subject codes back onto the subject
 * identifiers the allocation engine was given).
 *
 * This is a spelling/alias mapping only — it encodes no allotment rule.
 */
const SUBJECT_CODE_ALIASES: Record<string, string> = {
  PHYSICS: "PHY",
  CHEMISTRY: "CHE",
  BIOLOGY: "BIO",
  BOTANY: "BIO",
  ZOOLOGY: "BIO",
  COMPUTER: "CS",
  "COMPUTER SCIENCE": "CS",
  CS: "CS",
  PHY: "PHY",
  CHE: "CHE",
  BIO: "BIO",
};

export interface NormalizedSubject {
  /** Upper-cased, whitespace-collapsed input — used as the subject name. */
  name: string;
  /** Canonical short code stored in `subjects.code`. */
  code: string;
}

export function normalizeSubject(subjectCode: string): NormalizedSubject {
  const name = subjectCode.trim().toUpperCase().replace(/\s+/g, " ");
  return { name, code: SUBJECT_CODE_ALIASES[name] ?? name.slice(0, 16) };
}
