import ExcelJS from "exceljs";
import {
  emptyExamWorkspace,
  importWorkspaceSheet,
} from "../shared/src/index.ts";

async function main() {
  let workspace = emptyExamWorkspace("input-check", "Input check");
  for (const path of process.argv.slice(2)) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(path);
    for (const sheet of book.worksheets) {
      const lines: unknown[][] = [];
      sheet.eachRow({ includeEmpty: true }, (row) =>
        lines.push((row.values as unknown[]).slice(1)),
      );
      const result = importWorkspaceSheet(workspace, lines);
      console.log(
        JSON.stringify({
          sheet: sheet.name,
          kind: result.kind,
          rows: result.count,
          errors: result.errors.slice(0, 20),
          errorCount: result.errors.length,
          warnings: result.warnings,
        }),
      );
      workspace = result.workspace;
    }
  }
  console.log(
    JSON.stringify({
      schools: workspace.schools.length,
      staff: workspace.staff.length,
      centres: workspace.centres.length,
      posts: Object.fromEntries(
        [...new Set(workspace.staff.map((t) => t.post))].map((post) => [
          post,
          workspace.staff.filter((t) => t.post === post).length,
        ]),
      ),
      missingCoordinates: workspace.schools.filter(
        (s) => s.latitude == null || s.longitude == null,
      ).length,
      missingPostDates: workspace.staff.filter((t) => !t.postDate).length,
    }),
  );
}
void main();
