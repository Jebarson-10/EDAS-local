/** Run only against a disposable test DB. Never clears existing data. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const base = process.env.APP_URL ?? "http://127.0.0.1:43123";
const get = async (query = "") => {
  const response = await fetch(`${base}/api/workspaces${query}`, {
    headers: {
      "x-dev-role": "ADMIN",
      "x-dev-email": "workspace-test@example.local",
    },
  });
  assert(response.ok, await response.clone().text());
  return response.json();
};
assert.equal(
  (await get()).cycles.length,
  0,
  "Use a fresh test database. Nothing will be deleted.",
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
try {
  await page.goto(base);
  await page
    .getByRole("button", { name: "Create empty cycle", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "New empty cycle created" })
    .waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download input template" }).click();
  const download = await downloadPromise;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(await download.path());
  assert.equal(book.worksheets.length, 9);
  const add = (name, values) => book.getWorksheet(name).addRow(values);
  for (const [id, name] of [
    ["s", "Source"],
    ["c", "Centre"],
    ["p", "Point"],
  ])
    add("Schools", [
      id,
      `Synthetic ${name}`,
      "Block A",
      "District A",
      "Higher Secondary",
      "Government",
      11.3,
      77.7,
    ]);
  const staff = (id, post, udise = "s") =>
    add("Staff", [
      udise,
      id,
      `Synthetic ${id}`,
      ["JA", "OA"].includes(post) ? "Non Teaching" : "Teaching",
      post,
      "Physics",
      "Physics",
      "",
      "",
      "",
      "",
      "",
      "12",
      "2000-01-01",
      "2001-01-01",
    ]);
  staff("deo", "DEO");
  staff("hm1", "HM_HSS");
  staff("hm2", "HM_HSS");
  staff("ja", "JA");
  staff("oa", "OA");
  for (let n = 0; n < 40; n++) staff(`pg${n}`, "PG");
  staff("internal", "PG", "c");
  add("Centres", [12, "100", "c", 200, ""]);
  add("Timetable", [12, "2027-03-01", "MORNING", "Mathematics", ""]);
  add("Points", [12, "P1", "CUSTODIAN", "Synthetic point", "p", "100"]);
  add("Routes", [12, "R1", "P1", "100"]);
  add("Practical", [
    12,
    "PR1",
    "c",
    "Physics",
    60,
    "Group A",
    "c",
    "",
    1,
    "2027-02-20;2027-02-21",
  ]);
  const uploadData = {
    name: "synthetic-input.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await book.xlsx.writeBuffer()),
  };
  for (const name of [
    "Upload School Master",
    "Upload Teacher Master",
    "Upload combined workbook",
  ]) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name, exact: true }).click();
    await (await chooser).setFiles(uploadData);
    await page
      .getByRole("status")
      .filter({ hasText: "Saved successfully" })
      .waitFor();
    if (name === "Upload School Master") {
      const saved = await get(`?id=${(await get()).cycles[0].id}`);
      assert.equal(saved.workspace.schools.length, 3);
      assert.equal(saved.workspace.staff.length, 0);
    }
  }
  await page
    .getByRole("status")
    .filter({ hasText: "Saved successfully" })
    .waitFor();
  const cycle = (await get()).cycles[0];
  let data = await get(`?id=${cycle.id}`);
  assert.equal(data.workspace.schools.length, 3);
  assert.equal(data.workspace.staff.length, 46);
  assert.equal(data.workspace.timetable.length, 1);
  assert.equal(data.workspace.routes.length, 1);
  assert.equal(data.workspace.settings.retainHistory, false);
  const navigation = page.getByRole("navigation", { name: "Sections" });
  await navigation
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  await page.getByTestId("workspace-dashboard").waitFor();
  await navigation
    .getByRole("button", { name: "Timetable", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Upload timetable in bulk", exact: true })
    .waitFor();
  await navigation
    .getByRole("button", { name: "School map", exact: true })
    .click();
  await page.locator(".leaflet-container").waitFor();
  assert.equal(await page.locator(".leaflet-overlay-pane path").count(), 3);
  await page.getByLabel("Map school", { exact: true }).selectOption("s");
  await page.setViewportSize({ width: 420, height: 900 });
  assert(
    (await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )) <= 2,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page
    .getByRole("status")
    .filter({ hasText: "Saved cycle loaded" })
    .waitFor();
  await page
    .getByRole("button", { name: "Rule settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm these rule settings", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Rule settings confirmed" })
    .waitFor();
  await page
    .getByRole("button", { name: "Theory duties", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate duties", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Duty list saved" })
    .waitFor();
  data = await get(`?id=${cycle.id}`);
  assert.deepEqual(data.runs[0].errors, []);
  assert.deepEqual(data.runs[0].shortages, []);
  assert.equal(
    data.runs[0].assignments.filter((a) => a.role === "INVIGILATOR").length,
    12,
  );
  await page
    .getByRole("button", { name: "Confirm duty list", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Duty list confirmed" })
    .waitFor();
  const reportPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download duty list", exact: true })
    .click();
  const report = await reportPromise;
  const output = new ExcelJS.Workbook();
  await output.xlsx.readFile(await report.path());
  assert(output.worksheets[0].rowCount > 10);
  await page
    .getByRole("button", { name: "Practical duties", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate duties", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Duty list saved" })
    .waitFor();
  data = await get(`?id=${cycle.id}`);
  assert.deepEqual(data.runs[0].errors, []);
  assert.deepEqual(data.runs[0].shortages, []);
  assert.deepEqual(
    data.runs[0].assignments
      .filter((a) => a.role === "EXTERNAL")
      .map((a) => a.students),
    [30, 30],
  );
  await page
    .getByRole("button", { name: "+ New empty cycle", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "New empty cycle created" })
    .waitFor();
  const newId = await page
    .getByLabel("Exam cycle", { exact: true })
    .inputValue();
  assert.notEqual(newId, cycle.id);
  const empty = await get(`?id=${newId}`);
  for (const key of [
    "staff",
    "schools",
    "centres",
    "imports",
    "history",
    "timetable",
  ])
    assert.deepEqual(empty.workspace[key], []);
  assert.deepEqual(empty.runs, []);
  assert.equal((await get(`?id=${cycle.id}`)).runs.length, 2);
  await page.reload();
  await page
    .getByRole("status")
    .filter({ hasText: "Saved cycle loaded" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Exam cycle", { exact: true }).inputValue(),
    newId,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: template, all-sheet import, DB save, reload, theory, confirmation, XLSX report, practical batches and empty-cycle isolation.",
  );
} finally {
  await browser.close();
}
