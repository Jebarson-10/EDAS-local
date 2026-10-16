import ExcelJS from "exceljs";
import {
  importWorkspaceSheet,
  type ExamWorkspace,
  type WorkspaceAssignment,
  type WorkspaceStandard,
} from "@exam-duty/shared";
import { allocateWorkspace } from "@exam-duty/allocation-engine";
import { validateWorkspaceRun } from "@exam-duty/validator";

self.onmessage = async (
  event: MessageEvent<{
    kind: "import" | "generate";
    workspace: ExamWorkspace;
    file?: ArrayBuffer;
    standard: WorkspaceStandard;
    module: "THEORY" | "PRACTICAL";
    seed: string;
    other: WorkspaceAssignment[];
  }>,
) => {
  try {
    const input = event.data;
    if (input.kind === "import") {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(input.file!);
      let workspace = input.workspace;
      const notes: string[] = [],
        warnings: string[] = [],
        errors: string[] = [];
      let count = 0;
      // Schools must be processed before staff regardless of workbook tab order.
      const sheets = [...workbook.worksheets].sort(
        (a, b) =>
          Number(/school/i.test(b.name)) - Number(/school/i.test(a.name)),
      );
      for (const sheet of sheets) {
        if (/^(instructions|guide|readme)$/i.test(sheet.name)) continue;
        const lines: unknown[][] = [];
        sheet.eachRow({ includeEmpty: true }, (row) =>
          lines.push((row.values as unknown[]).slice(1)),
        );
        if (!lines.some((r) => r.some((v) => v != null && v !== ""))) continue;
        const result = importWorkspaceSheet(workspace, lines);
        workspace = result.workspace;
        errors.push(...result.errors.map((e) => `${sheet.name}: ${e}`));
        warnings.push(...result.warnings.map((e) => `${sheet.name}: ${e}`));
        notes.push(`${result.kind}: ${result.count} rows`);
        count += result.count;
      }
      self.postMessage({
        ok: true,
        workspace: errors.length ? input.workspace : workspace,
        errors,
        warnings,
        notes,
        count,
      });
    } else {
      const result = allocateWorkspace(
        input.workspace,
        input.standard,
        input.module,
        input.seed,
        input.other,
      );
      if (!result.errors.length)
        result.errors.push(
          ...validateWorkspaceRun(input.workspace, result, input.other),
        );
      self.postMessage({ ok: true, result });
    }
  } catch (error) {
    self.postMessage({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not complete this action.",
    });
  }
};
