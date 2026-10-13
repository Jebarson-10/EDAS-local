/** Recognise explicit school-level words; ambiguous names need manual classification. */
export function inferSchoolLevel(name: string): "HIGHER_SECONDARY" | "HIGH" | null {
  const text = name.toUpperCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  if (/\b(GHSS|GGHSS|GBHSS|GMHSS|HSS|HR SEC|HR SECONDARY|HIGHER SECONDARY)\b/.test(text)) return "HIGHER_SECONDARY";
  if (/\b(GHS|HIGH SCHOOL)\b/.test(text)) return "HIGH";
  return null;
}

/** Post aliases only: ASST alone and unrelated support posts remain unclassified. */
export function officePost(designation: string): "JUNIOR_ASSISTANT" | "OFFICE_ASSISTANT" | "RECORD_CLERK" | null {
  const key = designation.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (["JA", "JASST", "JUNASST", "JRASST", "JRASSISTANT", "JUNIORASSISTANT", "JUNIORASST", "JUNNIORASST", "JUNIORASSISANT", "JUNIORASSITANT", "JUNIORASSIATANT"].includes(key)) return "JUNIOR_ASSISTANT";
  if (["OA", "OFFASST", "OFFICEASSISTANT", "OFFICEASST"].includes(key)) return "OFFICE_ASSISTANT";
  if (["RC", "RECORDCLERK", "RECORDCLEARK"].includes(key)) return "RECORD_CLERK";
  return null;
}
