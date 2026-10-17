/** Read-only master/checklist review. Private output belongs outside the repository. */
import ExcelJS from "exceljs";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  emptyExamWorkspace,
  importWorkspaceSheet,
  importCell,
  parseCentreChecklist,
  canonicalSchoolNameKey,
  haversineKm,
  workspaceSchoolCandidates,
  type WorkspaceSchool,
} from "../shared/src/index.ts";
import { allocateWorkspace } from "../allocation-engine/src/workspace.ts";
import { validateWorkspaceRun } from "../validator/src/workspace.ts";

export const nameKey = canonicalSchoolNameKey;
async function main() {
  const [schoolPath, staffPath, ocrDir, output, officersPath] =
    process.argv.slice(2);
  if (!schoolPath || !staffPath || !ocrDir || !output)
    throw new Error(
      "Pass school master, teacher master, OCR folder, private output JSON path.",
    );
  let workspace = emptyExamWorkspace(
    "official-review",
    "Official input review",
  );
  const warnings: string[] = [];
  for (const path of [schoolPath, staffPath]) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(path);
    for (const sheet of book.worksheets) {
      const lines: unknown[][] = [];
      sheet.eachRow({ includeEmpty: true }, (row) =>
        lines.push((row.values as unknown[]).slice(1)),
      );
      const result = importWorkspaceSheet(workspace, lines);
      if (result.errors.length)
        throw new Error(result.errors.slice(0, 10).join("\n"));
      workspace = result.workspace;
      warnings.push(...result.warnings);
    }
  }
  const files = readdirSync(ocrDir)
    .filter((f) => /^13a-\d+\.png.txt$/.test(f))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const parsed = parseCentreChecklist(
    files.map((f) => readFileSync(join(ocrDir, f), "utf8")),
  );
  const byName = new Map<string, WorkspaceSchool[]>();
  for (const s of workspace.schools) {
    const k = nameKey(s.name);
    byName.set(k, [...(byName.get(k) ?? []), s]);
  }
  function match(name: string) {
    return byName.get(nameKey(name)) ?? [];
  }
  function suggestions(name: string) {
    return workspaceSchoolCandidates(name, workspace.schools);
  }
  const centres = [...new Set(parsed.rows.map((r) => r.centreCode))].map(
    (code) => {
      const rows = parsed.rows.filter((r) => r.centreCode === code);
      const matches = match(rows[0]!.centreName);
      const unmatched = rows.filter((r) => match(r.schoolName).length !== 1);
      return {
        code,
        name: rows[0]!.centreName,
        students: rows.every((r) => r.studentCount != null)
          ? rows.reduce((n, r) => n + r.studentCount!, 0)
          : null,
        udise: matches.length === 1 ? matches[0]!.udise : "",
        page: rows[0]!.page,
        linkedSchools: rows.map((r) => ({
          ...r,
          udise:
            match(r.schoolName).length === 1
              ? match(r.schoolName)[0]!.udise
              : "",
        })),
        needsReview:
          matches.length !== 1 ||
          unmatched.length > 0 ||
          rows.some((r) => r.studentCount == null),
        suggestions:
          matches.length === 1 ? [] : suggestions(rows[0]!.centreName),
      };
    },
  );
  const officialPoints: {
    id: string;
    name: string;
    kind: "CUSTODIAN" | "COLLECTION";
    udise: string;
    centreCodes: string[];
  }[] = [];
  const officialRoutes: {
    id: string;
    pointName: string;
    pointId: string;
    centreCodes: string[];
  }[] = [];
  if (officersPath) {
    const officerBook = new ExcelJS.Workbook();
    await officerBook.xlsx.readFile(officersPath);
    for (const [sheetName, kind] of [
      ["ANNEXURE - 1", "CUSTODIAN"],
      ["ANNEXURE - 2", "COLLECTION"],
    ] as const) {
      const sheet = officerBook.getWorksheet(sheetName);
      if (!sheet) continue;
      let centreCol = 0,
        pointCol = 0;
      sheet.eachRow((row) => {
        row.eachCell((cell, col) => {
          const v = importCell(cell.value).toUpperCase();
          if (/CENTRE (NO|NUMBER)/.test(v)) centreCol = col;
          if (
            v.includes("NAME OF THE CUSTODIAN POINT") ||
            v.includes("NAME OF THE COLLECTION POINT") ||
            v.includes("NAME OF THE SCRIPT RECEIVING")
          )
            pointCol = col;
        });
      });
      if (centreCol && pointCol)
        sheet.eachRow((row) => {
          const code = importCell(row.getCell(centreCol).value);
          const name = importCell(row.getCell(pointCol).value);
          if (!/^\d{6}$/.test(code) || !name) return;
          let point = officialPoints.find(
            (p) => p.kind === kind && p.name === name,
          );
          if (!point) {
            const m = match(name);
            point = {
              id: `${kind === "CUSTODIAN" ? "C" : "L"}${officialPoints.filter((p) => p.kind === kind).length + 1}`,
              name,
              kind,
              udise: m.length === 1 ? m[0]!.udise : "",
              centreCodes: [],
            };
            officialPoints.push(point);
          }
          point.centreCodes.push(code);
        });
    }
    const routes = officerBook.getWorksheet("ROUTE MAP");
    let current:
      | {
          id: string;
          pointName: string;
          pointId: string;
          centreCodes: string[];
        }
      | undefined;
    routes?.eachRow((row) => {
      const label = importCell(row.getCell(1).value);
      const m = label.match(/^ROUTE\s*[-:]?\s*(\d+)$/i);
      if (m) {
        current = { id: m[1]!, pointName: "", pointId: "", centreCodes: [] };
        officialRoutes.push(current);
      }
      if (current) {
        const code = importCell(row.getCell(3).value);
        if (/^\d{6}$/.test(code)) {
          current.centreCodes.push(code);
          const name = importCell(row.getCell(2).value);
          if (name) {
            current.pointName = name;
            current.pointId =
              officialPoints.find(
                (p) =>
                  p.kind === "CUSTODIAN" && nameKey(p.name) === nameKey(name),
              )?.id ?? "";
          }
          const receiving = importCell(row.getCell(5).value);
          if (receiving) {
            let point = officialPoints.find(
              (p) =>
                p.kind === "COLLECTION" &&
                nameKey(p.name) === nameKey(receiving),
            );
            if (!point) {
              const m = match(receiving);
              point = {
                id: `L${officialPoints.filter((p) => p.kind === "COLLECTION").length + 1}`,
                name: receiving,
                kind: "COLLECTION",
                udise: m.length === 1 ? m[0]!.udise : "",
                centreCodes: [],
              };
              officialPoints.push(point);
            }
            if (!point.centreCodes.includes(code)) point.centreCodes.push(code);
          }
        }
      }
    });
  }
  workspace.centres = centres
    .filter((c) => !c.needsReview && c.students != null && c.students > 0)
    .map((c) => ({
      standard: "10",
      code: c.code,
      udise: c.udise,
      students: c.students!,
      clubbedUdise: [
        ...new Set(
          c.linkedSchools
            .filter((s) => s.udise !== c.udise)
            .map((s) => s.udise),
        ),
      ],
    }));
  const readyCodes = new Set(workspace.centres.map((c) => c.code));
  workspace.points = officialPoints
    .filter((p) => p.udise && p.centreCodes.some((c) => readyCodes.has(c)))
    .map((p) => ({
      ...p,
      standard: "10",
      centreCodes: p.centreCodes.filter((c) => readyCodes.has(c)),
    }));
  workspace.routes = officialRoutes
    .filter(
      (r) =>
        r.pointId &&
        r.centreCodes.length &&
        r.centreCodes.every((c) => readyCodes.has(c)),
    )
    .map((r) => ({
      id: r.id,
      standard: "10",
      pointId: r.pointId,
      centreCodes: r.centreCodes,
    }));
  workspace.settings.confirmed = true;
  // Client-authorised five-day practice timetable; these dates are not a public-exam notification.
  workspace.timetable = ["TAM", "ENG", "MAT", "SCI", "SOC"].map(
    (subject, i) => ({
      standard: "10",
      date: `2026-10-${19 + i}`,
      session: "MORNING",
      subject,
      centreCode: "",
    }),
  );
  const runs = ["10", "12"].flatMap((standard) =>
    ["THEORY", "PRACTICAL"].map((module) =>
      allocateWorkspace(
        workspace,
        standard as "10" | "12",
        module as "THEORY" | "PRACTICAL",
        "official-source-review",
      ),
    ),
  );
  for (const run of runs)
    if (!run.errors.length)
      run.errors.push(...validateWorkspaceRun(workspace, run));
  const gapEvidence = runs[0]!.shortages.map((gap) => {
    const route =
      gap.role === "ROUTE"
        ? workspace.routes.find((r) => r.id === gap.target)
        : undefined;
    const point = route
      ? workspace.points.find((p) => p.id === route.pointId)
      : undefined;
    const targets = route
      ? [
          point!.udise,
          ...route.centreCodes.map(
            (code) => workspace.centres.find((c) => c.code === code)!.udise,
          ),
        ]
      : [workspace.centres.find((c) => c.code === gap.target)!.udise];
    const posts =
      gap.role === "ROUTE"
        ? ["BT"]
        : gap.role === "JUNIOR_ASSISTANT"
          ? ["JA"]
          : ["OA", "RC"];
    const schools = new Map(workspace.schools.map((s) => [s.udise, s]));
    const candidates = workspace.staff
      .filter(
        (t) =>
          posts.includes(t.post) && t.postDate && t.postDate <= "2026-10-19",
      )
      .map((t) => {
        const source = schools.get(t.udise)!;
        return {
          staffId: t.staffId,
          schoolName: source.name,
          km: Math.max(
            ...targets.map((id) => {
              const dest = schools.get(id)!;
              return haversineKm(
                source.latitude!,
                source.longitude!,
                dest.latitude!,
                dest.longitude!,
              );
            }),
          ),
        };
      })
      .sort((a, b) => a.km - b.km);
    return {
      target: gap.target,
      role: gap.role,
      nearestBestCaseKm: candidates[0]?.km ?? null,
      nearestSchool: candidates[0]?.schoolName ?? "",
      within10Km: candidates.filter((c) => c.km <= 10).length,
    };
  });
  const dateIssues = workspace.staff
    .filter((s) => !s.postDate)
    .map((s) => ({
      staffId: s.staffId,
      name: s.name,
      udise: s.udise,
      post: s.post,
      source: s.raw["Date of present post"] ?? "",
      action:
        "Enter the correct present-post appointment date from the official staff record.",
    }));
  const report = {
    sources: {
      schoolPath,
      staffPath,
      checklist: "13A ERODE.pdf",
      officersPath,
    },
    workspace,
    warnings,
    dateIssues,
    checklist: { ...parsed, centres },
    officialPoints,
    officialRoutes,
    gapEvidence,
    runs,
    summary: {
      schools: workspace.schools.length,
      staff: workspace.staff.length,
      teaching: workspace.staff.filter((s) => s.category === "TEACHING").length,
      nonTeaching: workspace.staff.filter((s) => s.category === "NON_TEACHING")
        .length,
      deo: workspace.staff.filter((s) => s.post === "DEO").length,
      centres: centres.length,
      students: centres.reduce((n, c) => n + (c.students ?? 0), 0),
      readyCentres: workspace.centres.length,
      reviewCentres: centres.filter((c) => c.needsReview).length,
      missingPostDates: dateIssues.length,
    },
  };
  writeFileSync(output, JSON.stringify(report));
  console.log(
    JSON.stringify(
      {
        summary: report.summary,
        parseErrors: parsed.errors,
        blockedRuns: runs.map((r) => ({
          standard: r.standard,
          module: r.module,
          errors: r.errors,
        })),
      },
      null,
      2,
    ),
  );
}
if (process.argv[1]?.endsWith("workspace-source-audit.ts")) void main();
