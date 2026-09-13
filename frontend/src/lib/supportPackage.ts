/** Creates a plain JSON file for support. It never includes backup passwords or keys. */
export function downloadSupportPackage(snapshot: Record<string, unknown>) {
  const createdAt = new Date().toISOString();
  const body = JSON.stringify({
    format: "erode-exam-duty-support-file",
    formatVersion: 1,
    createdAt,
    privacy: "Contains your saved duty data and names. Share it only with people you trust to help with this app.",
    snapshot,
  }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `erode-exam-duty-check-${createdAt.replace(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
