const labels: Record<string,string> = {name:"Teacher name",designation:"Teacher post",schoolCode:"Centre code",schoolName:"School name",blockId:"Block",blockCode:"Block code",blockName:"Block name",latitude:"School latitude",longitude:"School longitude",homeLatitude:"Home latitude",homeLongitude:"Home longitude",capacity:"Student count",seniorityRank:"Seniority rank",joiningDate:"Joining date",isActive:"Teacher active",subject:"Subject",employeeCode:"Employee code"};

/** Accept Excel storage differences without weakening the actual meaning of a field. */
export function normalizeImportValue(field: string, value: unknown): unknown {
  if (value == null || String(value).trim() === "") return value;
  const text = String(value).trim();
  if (["latitude","longitude","homeLatitude","homeLongitude","capacity","seniorityRank"].includes(field)) {
    // Accept conventional Indian/international thousands separators, not decimal commas.
    const grouped = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/;
    const cleaned = grouped.test(text) ? text.replace(/,/g, "") : text;
    const n = typeof value === "number" ? value : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned) ? Number(cleaned) : NaN;
    if (!Number.isFinite(n)) throw new Error(`${labels[field]}: enter a value such as ${field.toLowerCase().includes("latitude") ? "11.34" : field.toLowerCase().includes("longitude") ? "77.72" : "50"}. Excel Text or Number format is fine.`);
    return n;
  }
  if (field === "isActive") {
    const s = text.toLowerCase();
    if (["1","true","yes","y","active","ஆம்"].includes(s)) return true;
    if (["0","false","no","n","inactive","இல்லை"].includes(s)) return false;
    throw new Error("Teacher active: enter Yes or No (1 or 0 also works).");
  }
  if (field === "joiningDate") {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0,10);
    const parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    const local = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
    if (parts || local) {
      const [year,month,day] = parts ? [Number(parts[1]),Number(parts[2]),Number(parts[3])] : [Number(local![3]),Number(local![2]),Number(local![1])];
      const date = new Date(Date.UTC(year,month-1,day));
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month-1 && date.getUTCDate() === day) return date.toISOString().slice(0,10);
    }
    throw new Error("Joining date: enter day/month/year, for example 15/06/2010, or choose an Excel date.");
  }
  return text;
}

export function friendlyImportIssue(issue: {path: (string|number)[]; code: string; message: string}): string {
  const field = String(issue.path[0] ?? "");
  const label = labels[field] ?? "Details";
  if (field.toLowerCase().includes("latitude")) return `${label}: enter a location between -90 and 90.`;
  if (field.toLowerCase().includes("longitude")) return `${label}: enter a location between -180 and 180.`;
  if (field === "capacity") return "Student count: enter a whole count of at least 1.";
  if (field === "seniorityRank") return "Seniority rank: enter a whole rank of 0 or more.";
  if (field === "isActive") return "Teacher active: enter Yes or No.";
  if (issue.code === "too_big") return `${label}: this entry is too long. Please shorten it.`;
  return `${label}: add or check this detail.`;
}
