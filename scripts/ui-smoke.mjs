/**
 * Headless smoke test for primary UI interactions.
 * Usage (with npm run dev already listening on 43123):
 *   npm run smoke:ui
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, "../frontend/package.json"));
const { chromium } = require("playwright");

const base = process.env.APP_URL ?? "http://127.0.0.1:43123";
const api = process.env.API_URL ?? "http://127.0.0.1:43124";

/** Ensure synthetic cycle is mutable — prior smoke runs may have left it PUBLISHED. */
async function ensureOpenCycle() {
  const res = await fetch(`${api}/api/exam-cycles/ec_2027_hsc/status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dev-role": "ADMIN",
      "x-dev-email": "admin@example.local",
    },
    body: JSON.stringify({
      status: "OPEN",
      force: true,
      reason: "UI smoke reset to OPEN",
    }),
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    console.warn("cycle reset skipped", body);
  }
}

await ensureOpenCycle();

async function delayPost(page, glob, ms = 400) {
  await page.route(glob, async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((r) => setTimeout(r, ms));
    }
    await route.continue();
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto(base, { waitUntil: "networkidle" });
await page.getByTestId("dashboard-hydrate").waitFor();
await page.getByTestId("hydrate-status").getByText("hydrate ok").waitFor({
  timeout: 15_000,
});

await page.getByTestId("nav-imports").click();
await page.getByTestId("load-sample-diff").click();
await page.getByText("New teachers").waitFor();
await delayPost(page, "**/api/imports/apply");
const applyImport = page.getByTestId("apply-import");
await applyImport.click();
await applyImport.getByText("Applying…").waitFor();
await page.getByText("Applied import (no archive)").waitFor();
await applyImport.getByText("Apply import (preserve history)").waitFor();
await page.unroute("**/api/imports/apply");

const ExcelJS = require("exceljs");
const uploadWb = new ExcelJS.Workbook();
const uploadSheet = uploadWb.addWorksheet("Teachers");
uploadSheet.addRow(["Employee Code", "Name", "School Code", "Designation"]);
uploadSheet.addRow(["SYN-SMOKE-1", "Smoke Teacher", "S1", "PG"]);
const uploadBuf = Buffer.from(await uploadWb.xlsx.writeBuffer());
await page.route("**/api/imports", async (route) => {
  const url = route.request().url();
  if (route.request().method() === "POST" && !url.includes("/apply")) {
    await new Promise((r) => setTimeout(r, 400));
  }
  await route.continue();
});
await page.getByTestId("upload-xlsx").setInputFiles({
  name: "smoke-teachers.xlsx",
  mimeType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: uploadBuf,
});
await applyImport.getByText("Uploading…").waitFor();
await page.getByText("Archived upload").waitFor({ timeout: 15_000 });
await applyImport.getByText("Apply import (preserve history)").waitFor();
await page.unroute("**/api/imports");
await applyImport.click();
await applyImport.getByText("Applying…").waitFor();
const appliedArchived = page.getByText(
  /Applied import [0-9a-f]{8}-[0-9a-f-]{27}/i,
);
await appliedArchived.waitFor();
const appliedImportId = (await appliedArchived.innerText()).match(
  /Applied import ([0-9a-f-]{36})/i,
)?.[1];
if (!appliedImportId) {
  throw new Error("xlsx apply did not report an archived import id");
}
await applyImport.getByText("Apply import (preserve history)").waitFor();

await page.getByTestId("nav-master").click();
await page.getByTestId("master-api-note").waitFor();
await page.getByText(/API mirror|API offline/).waitFor();
await page.getByTestId("master-tab-blocks").click();
await page.getByTestId("master-blocks-table").waitFor();
await page.getByTestId("master-tab-subjects").click();
await page.getByTestId("master-subjects-table").waitFor();

await page.getByTestId("master-tab-exemptions").click();
await page.route("**/api/exemptions", async (route) => {
  if (route.request().method() === "POST") {
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "exemption persist unavailable",
      }),
    });
    return;
  }
  await route.continue();
});
await page.getByTestId("exemption-teacher-id").fill("tch_smoke_fail");
await page.getByTestId("exemption-reason").fill("smoke reject");
const exemptionSave = page.getByTestId("exemption-save");
await exemptionSave.click();
await exemptionSave.getByText("Saving…").waitFor();
const exemptionErr = page.getByTestId("exemption-error");
await exemptionErr.waitFor();
await exemptionErr.getByText("exemption persist unavailable").waitFor();
await exemptionSave.getByText("Save exemption").waitFor();
const exemptionErrColor = await exemptionErr.evaluate(
  (el) => getComputedStyle(el).color,
);
if (exemptionErrColor !== "rgb(147, 35, 31)") {
  throw new Error(
    `exemption error used success chrome: ${exemptionErrColor}`,
  );
}
if ((await page.getByTestId("exemption-ok").count()) > 0) {
  throw new Error("exemption success chrome shown after API reject");
}
if ((await page.locator("td", { hasText: "tch_smoke_fail" }).count()) > 0) {
  throw new Error("failed exemption applied to session table");
}
await page.unroute("**/api/exemptions");
await page.getByTestId("exemption-teacher-id").fill("tch_not_a_teacher");
await page.getByTestId("exemption-reason").fill("smoke unknown teacher");
await page.getByTestId("exemption-save").click();
await page.getByTestId("exemption-error").getByText(/Teacher .* not found/).waitFor();
const liveExemptionErrColor = await page
  .getByTestId("exemption-error")
  .evaluate((el) => getComputedStyle(el).color);
if (liveExemptionErrColor !== "rgb(147, 35, 31)") {
  throw new Error(
    `live exemption reject used success chrome: ${liveExemptionErrColor}`,
  );
}
if ((await page.locator("td", { hasText: "tch_not_a_teacher" }).count()) > 0) {
  throw new Error("unknown-teacher exemption applied to session table");
}

await page.getByTestId("nav-dashboard").click();
const pipelineTheory = page.getByTestId("pipeline-theory-run");
await pipelineTheory.waitFor();
const hydratedTheoryId = (await pipelineTheory.innerText()).trim();

await page.getByTestId("nav-theory").click();
const generateTheory = page.getByTestId("generate-theory");
await generateTheory.getByText("Generate theory allocation").waitFor();
await generateTheory.click();
await generateTheory.getByText("Generating…").waitFor();
await generateTheory
  .getByText("Generate theory allocation")
  .waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Why?" }).first().click();
await page.getByText("Decision trace").waitFor();
const whySelected = page.getByTestId("why-selected");
await whySelected.waitFor();
const generatedWhy = (await whySelected.innerText()).trim();
const generatedTeacher = generatedWhy.match(/^Selected (\S+) because/)?.[1];
if (!generatedTeacher) {
  throw new Error(`why-selected missed generated teacher: ${generatedWhy}`);
}
const assignedTexts = await page
  .locator("table tbody tr td:nth-child(2)")
  .allInnerTexts();
const assignedIds = assignedTexts
  .map((t) => t.match(/\(([^)]+)\)/)?.[1])
  .filter(Boolean);
const teachersRes = await fetch(`${api}/api/teachers`, {
  headers: {
    "x-dev-role": "OFFICER",
    "x-dev-email": "officer@example.local",
  },
});
const teachersBody = await teachersRes.json();
const replacement = (teachersBody.teachers ?? []).find(
  (t) => t.is_active !== 0 && !assignedIds.includes(t.teacher_id),
);
if (!replacement) {
  throw new Error("no unassigned teacher for override smoke");
}
const reqSelect = page.getByTestId("override-requirement");
const reqValue = await reqSelect.locator("option").nth(1).getAttribute("value");
if (!reqValue) throw new Error("no override requirement");
await reqSelect.selectOption(reqValue);
await page.getByTestId("override-teacher").fill(replacement.teacher_id);
await page.getByTestId("override-reason").fill("smoke override");
await delayPost(page, "**/api/manual-overrides");
const applyOverride = page.getByTestId("apply-override");
await applyOverride.click();
await applyOverride.getByText("Applying…").waitFor();
await page.getByText(/Override applied/).waitFor();
await applyOverride.getByText("Apply override + revalidate").waitFor();
await page.unroute("**/api/manual-overrides");
const afterWhy = (await page.getByTestId("why-selected").innerText()).trim();
if (!afterWhy.includes(replacement.teacher_id)) {
  throw new Error(`Why after override missed replacement: ${afterWhy}`);
}
if (
  afterWhy.includes(`Selected ${generatedTeacher} because`) &&
  generatedTeacher !== replacement.teacher_id
) {
  throw new Error(
    `Why after override still showed generated ${generatedTeacher}: ${afterWhy}`,
  );
}
if (!/manual override/i.test(afterWhy)) {
  throw new Error(`Why after override missed manual override: ${afterWhy}`);
}
const whyBlockText = (
  await page.getByTestId("why-selected").locator("xpath=..").innerText()
).trim();
for (const code of [
  "INFO-SELECTED",
  "INFO-DISTANCE",
  "INFO-FAIRNESS",
  "INFO-HM-FALLBACK",
]) {
  if (whyBlockText.includes(code)) {
    throw new Error(
      `Why after override still showed ${code}: ${whyBlockText}`,
    );
  }
}

await page.getByTestId("nav-validation").click();
const reasonsTable = page.getByTestId("persisted-reasons-table");
await reasonsTable.waitFor({ timeout: 15_000 });
const reasonsText = (await reasonsTable.innerText()).trim();
if (!reasonsText.includes("MANUAL_OVERRIDE")) {
  throw new Error(`persisted reasons missed MANUAL_OVERRIDE: ${reasonsText}`);
}
const reasonRows = reasonsTable.locator("tbody tr");
const reasonRowCount = await reasonRows.count();
const generateInfoOnOverride = [
  "INFO-SELECTED",
  "INFO-DISTANCE",
  "INFO-FAIRNESS",
  "INFO-HM-FALLBACK",
  "RULE-THEORY-DISTANCE",
  "RULE-CONFLICT-SESSION",
  "UNVERIFIED_HISTORY_USED",
];
for (let i = 0; i < reasonRowCount; i++) {
  const rowText = (await reasonRows.nth(i).innerText()).trim();
  if (!rowText.includes(replacement.teacher_id)) continue;
  for (const code of generateInfoOnOverride) {
    if (rowText.includes(code)) {
      throw new Error(
        `${code} still attributed to override teacher: ${rowText}`,
      );
    }
  }
}

await page.getByTestId("nav-dashboard").click();
await pipelineTheory.waitFor();
const firstTheoryId = (await pipelineTheory.innerText()).trim();
if (!firstTheoryId || firstTheoryId === "no run yet") {
  throw new Error("dashboard pipeline missed the first theory run");
}
if (firstTheoryId === hydratedTheoryId) {
  throw new Error(
    `dashboard pipeline still showed hydrated ${hydratedTheoryId} after generate`,
  );
}
await page.getByTestId("nav-theory").click();
await generateTheory.click();
await generateTheory.getByText("Generating…").waitFor();
await generateTheory
  .getByText("Generate theory allocation")
  .waitFor({ timeout: 60_000 });
await page.getByTestId("nav-dashboard").click();
const secondTheoryId = (
  await page.getByTestId("pipeline-theory-run").innerText()
).trim();
if (secondTheoryId === firstTheoryId) {
  throw new Error(
    `dashboard pipeline still showed ${firstTheoryId} after a second theory generate`,
  );
}

await page.getByTestId("nav-practical").click();
await page
  .getByTestId("pair-memory-rows")
  .or(page.getByTestId("pair-memory-empty"))
  .waitFor({ timeout: 15_000 });
const generatePractical = page.getByTestId("generate-practical");
await generatePractical.getByText("Generate practical schedule").waitFor();
await generatePractical.click();
await generatePractical.getByText("Generating…").waitFor();
await generatePractical
  .getByText("Generate practical schedule")
  .waitFor({ timeout: 30_000 });
await page.getByTestId("pair-switch-badge").waitFor({ timeout: 30_000 });
await page
  .getByTestId("pair-memory-rows")
  .or(page.getByTestId("pair-memory-empty"))
  .waitFor();

await page.getByTestId("nav-cycles").click();
// Window must be set while the cycle is still mutable, i.e. before publish.
await page.getByTestId("exam-window-start").fill("2027-04-05");
await page.getByTestId("exam-window-end").fill("2027-04-09");
await delayPost(page, "**/api/exam-cycles/*/window");
const saveWindow = page.getByTestId("save-exam-window");
await saveWindow.click();
await saveWindow.getByText("Saving…").waitFor();
await page.getByText("Examination window saved").waitFor({ timeout: 15_000 });
await saveWindow.getByText("Save window").waitFor();
await page.unroute("**/api/exam-cycles/*/window");

await delayPost(page, "**/api/allocation-runs/*/publish");
const publishRun = page.getByTestId("publish-run");
await publishRun.click();
await publishRun.getByText("Publishing…").waitFor();
await page.getByText("PUBLISHED").first().waitFor();
await publishRun.getByText("Publish theory (+ practical/hall if generated)").waitFor({
  timeout: 30_000,
});
await page.unroute("**/api/allocation-runs/*/publish");

await page.getByTestId("nav-validation").click();
await page
  .getByTestId("conflicts-none")
  .or(page.getByTestId("conflicts-table"))
  .waitFor();

await page.getByTestId("nav-reports").click();
await page.getByText("practical-schedules.csv").waitFor();
await page.getByText("Duty-In.txt").waitFor();
await page.getByText("Duty-Out.txt").waitFor();
await page.getByText("hall-assignments.csv").waitFor();
await delayPost(page, "**/api/exports");
const exportDutyIn = page.getByTestId("export-duty-in");
const dutyInDownload = page.waitForEvent("download");
await exportDutyIn.click();
await exportDutyIn.getByText("Exporting…").waitFor();
await dutyInDownload;
await exportDutyIn.getByText("Duty-In.txt").waitFor();
await page.getByTestId("export-receipt").getByText("Receipt recorded").waitFor();
await page.unroute("**/api/exports");

await page.getByTestId("nav-audit").click();
await page.getByText("GENERATE_ALLOCATION").first().waitFor();
await page
  .getByRole("cell", { name: "PUBLISH", exact: true })
  .first()
  .waitFor();
await page.getByTestId("imports-list").waitFor();
const rowToggle = page.getByTestId(`import-rows-${appliedImportId}`);
await rowToggle.click();
const importRowsCaptionLoc = page.getByTestId("import-rows-count");
await importRowsCaptionLoc.scrollIntoViewIfNeeded();
await importRowsCaptionLoc.waitFor();
const importRowsCaption = (await importRowsCaptionLoc.innerText()).trim();
if (!/file rows · \d+ outcomes/.test(importRowsCaption)) {
  throw new Error(`audit drill-down caption: ${importRowsCaption}`);
}

await page.getByTestId("role-ADMIN").click();
await page.getByTestId("nav-settings").click();
await page.getByTestId("api-health").waitFor();
await page.getByTestId("rule-parameters-json").waitFor();
await page.getByText("maximum_distance_km").waitFor();
const label = `smoke-${Date.now().toString(36)}`;
await page.getByTestId("rule-version-label").fill(label);
await page.getByTestId("rule-version-description").fill("UI smoke clone");
await delayPost(page, "**/api/rule-versions");
const createRule = page.getByTestId("create-rule-version");
await createRule.click();
await createRule.getByText("Creating…").waitFor();
const createdRule = page.getByText(/Created rv_/);
await createdRule.waitFor({ timeout: 15_000 });
await createRule.getByText("Clone new rule version (ADMIN)").waitFor();
await page.unroute("**/api/rule-versions");
const createdText = (await createdRule.innerText()).trim();
const createdId = createdText.match(/Created (rv_\S+)/)?.[1];
if (!createdId) {
  throw new Error(`could not parse created rule version from: ${createdText}`);
}
await delayPost(page, "**/api/rule-versions/activate");
const activateRule = page.getByTestId(`activate-rule-${createdId}`);
await activateRule.waitFor({ timeout: 15_000 });
await activateRule.click();
await activateRule.getByText("Activating…").waitFor();
await page.getByText(`Activated ${createdId}`).waitFor({ timeout: 15_000 });
await page.unroute("**/api/rule-versions/activate");

await page.getByTestId("nav-backups").click();
await delayPost(page, "**/api/backups");
const archiveServer = page.getByTestId("archive-server");
await archiveServer.click();
await archiveServer.getByText("Archiving…").waitFor();
await page.getByText("Server archive created").waitFor({ timeout: 15_000 });
await archiveServer.getByText("Archive from server").waitFor();
await page.unroute("**/api/backups");

await page.getByTestId("nav-cycles").click();
await page.getByPlaceholder("Amendment reason").fill("smoke amendment");
const createAmendment = page.getByTestId("create-amendment");
await delayPost(page, "**/api/exam-cycles");
await createAmendment.click();
await createAmendment.getByText("Creating…").waitFor();
await page.getByText("Created amendment").waitFor({ timeout: 15_000 });
await createAmendment.getByText("Create amendment cycle").waitFor();
await page.unroute("**/api/exam-cycles");

if (pageErrors.length) {
  console.error("PAGE_ERRORS", pageErrors);
  process.exit(1);
}
console.log("UI smoke OK", base);
await browser.close();
