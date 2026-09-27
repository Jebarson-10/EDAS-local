/** Read recorded practical diagnostics without inventing reasons for older runs. */
export function practicalRunDetails(summaryJson: string | null | undefined) {
  const batches: Array<{ batchKey: string; schoolId: string; subjectId: string; batchIndex: number; studentCount: number }> = [];
  const diagnostics: Array<{ schoolId: string; subjectId: string; batchKey: string; message: string; exclusionTallies: Record<string, number> }> = [];
  let message: string | undefined;
  try {
    const summary = JSON.parse(summaryJson ?? "{}") as Record<string, unknown>;
    if (!summary || typeof summary !== "object") return { batches, diagnostics, message };
    if (typeof summary.message === "string") message = summary.message;
    if (Array.isArray(summary.plannedBatches)) for (const item of summary.plannedBatches) {
      if (!item || typeof item !== "object") continue;
      if (["batchKey", "schoolId", "subjectId"].every(key => typeof item[key] === "string") && Number.isInteger(item.batchIndex) && item.batchIndex >= 1 && Number.isInteger(item.studentCount) && item.studentCount > 0) batches.push({ batchKey: item.batchKey, schoolId: item.schoolId, subjectId: item.subjectId, batchIndex: item.batchIndex, studentCount: item.studentCount });
    }
    if (Array.isArray(summary.diagnostics)) for (const item of summary.diagnostics) {
      if (!item || typeof item !== "object" || !["schoolId", "subjectId", "batchKey", "message"].every(key => typeof item[key] === "string")) continue;
      const exclusionTallies: Record<string, number> = {};
      if (item.exclusionTallies && typeof item.exclusionTallies === "object") for (const [key, value] of Object.entries(item.exclusionTallies)) {
        if (typeof value === "number" && Number.isInteger(value) && value >= 0) exclusionTallies[key] = value;
      }
      diagnostics.push({ schoolId: item.schoolId, subjectId: item.subjectId, batchKey: item.batchKey, message: item.message, exclusionTallies });
    }
  } catch { /* Older or invalid summaries have no recorded details. */ }
  return { batches, diagnostics, message };
}
