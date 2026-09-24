/** Current single-user import UI. Run against a disposable, empty CI database. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const base = process.env.APP_URL ?? 'http://127.0.0.1:43123';
const api = process.env.API_URL ?? 'http://127.0.0.1:43124';
// Never reset an operator's database to make a test pass.
const headers = { 'x-dev-role': 'ADMIN', 'x-dev-email': 'ui-test@example.local' };
async function get(path) {
  const response = await fetch(`${api}${path}`, { headers });
  assert(response.ok, `${path}: ${response.status}`);
  return response.json();
}
assert.equal((await get('/api/teachers')).teachers.length, 0, 'Use an empty test database; no data will be erased.');
assert.equal((await get('/api/schools')).schools.length, 0, 'Use an empty test database; no data will be erased.');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.setDefaultTimeout(20_000);
try {
  await page.goto(base);
  await page.getByTestId('hydrate-status').getByText('saved data ready').waitFor();
  await page.getByTestId('nav-imports').click();
  await page.getByRole('heading', { name: '1. Staff and schools (OVER ALL)' }).waitFor();
  await page.getByRole('heading', { name: '2. Centres and student numbers' }).waitFor();
  await page.getByRole('heading', { name: '3. Practical subject counts' }).waitFor();

  const templateDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download official staff template' }).click();
  const template = await templateDownload;
  assert.match(template.suggestedFilename(), /\.xlsx$/i);
  const templateBook = new ExcelJS.Workbook();
  await templateBook.xlsx.readFile(await template.path());
  assert(templateBook.worksheets.length >= 3, 'Staff template must contain the official staff categories.');

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('PG');
  sheet.addRow(['PG TEACHERS LIST']);
  sheet.addRow(['S.NO', 'SCHOOL CODE', 'NAME OF THE SCHOOL', 'TEACHERS NAME', 'DESIGNATION', 'SUBJECT', 'BLOCK']);
  sheet.addRow([1, 991001, 'Synthetic UI School', 'Synthetic UI Teacher', 'P.G. ASSISTANT', 'PHYSICS', 'Synthetic UI Block']);
  await page.getByTestId('upload-xlsx').setInputFiles({
    name: 'OVER ALL.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await book.xlsx.writeBuffer()),
  });
  await page.getByText(/Read 1 staff rows/).waitFor();
  await page.getByTestId('apply-import').click();
  await page.getByText(/Saved 1 new staff/).waitFor();
  let teachers = (await get('/api/teachers')).teachers;
  const schools = (await get('/api/schools')).schools;
  assert.equal(teachers.length, 1);
  assert.equal(schools.length, 1);
  assert.equal(teachers[0].name, 'Synthetic UI Teacher');
  assert.equal(teachers[0].designation, 'PG');
  assert.equal(schools[0].school_code, '', 'A school reference must not make a school an examination centre.');
  assert.equal((await get('/api/centres')).centres.length, 0);

  await page.reload();
  await page.getByTestId('hydrate-status').getByText('saved data ready').waitFor();
  teachers = (await get('/api/teachers')).teachers;
  assert.equal(teachers.length, 1, 'Teacher must survive a full reload.');
  // Re-import must match the existing school and staff, not duplicate them.
  await page.getByTestId('upload-xlsx').setInputFiles({ name: 'OVER ALL.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await book.xlsx.writeBuffer()) });
  await page.getByText(/Read 1 staff rows/).waitFor();
  await page.getByTestId('apply-import').click();
  await page.getByText(/Saved 0 new staff/).waitFor();
  assert.equal((await get('/api/teachers')).teachers.length, 1);
  assert.equal((await get('/api/schools')).schools.length, 1);

  await page.getByRole('button', { name: 'Add school subject' }).click();
  await page.getByLabel('Practical school 1').selectOption(schools[0].school_id);
  await page.getByLabel('Practical subject 1').fill('PHYSICS');
  await page.getByLabel('Practical students 1').fill('51');
  await page.getByRole('button', { name: 'Save practical counts' }).click();
  await page.getByText(/Saved 1 school subjects/).waitFor();
  await page.reload();
  await page.getByLabel('Practical students 1').waitFor();
  assert.equal(await page.getByLabel('Practical students 1').inputValue(), '51');
  const practicalTemplateDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download practical template' }).click();
  const practicalTemplate = await practicalTemplateDownload;
  const practicalBook = new ExcelJS.Workbook();
  await practicalBook.xlsx.readFile(await practicalTemplate.path());
  assert.equal(practicalBook.worksheets[0].getCell('A2').text, 'Synthetic UI School');

  await page.getByTestId('nav-reports').click();
  await page.getByRole('heading', { name: 'School-wise Duty-In and Duty-Out' }).waitFor();
  assert(await page.getByRole('button', { name: 'Duty-In (Word)', exact: true }).isDisabled());
  assert(await page.getByRole('button', { name: 'Duty-Out (Word)', exact: true }).isDisabled());
  await page.getByTestId('nav-settings').click();
  const diagnosisDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download app check file' }).click();
  const diagnosis = await diagnosisDownload;
  assert.match(diagnosis.suggestedFilename(), /\.json$/);
  await page.getByTestId('nav-backups').click();
  await page.getByTestId('archive-server').click();
  await page.getByText('Server archive created', { exact: false }).waitFor();
  assert.equal((await get('/api/teachers')).teachers.length, 1, 'Backup must not change master data.');
  assert.deepEqual(errors, []);
  console.log('CURRENT_UI_SMOKE_OK: official template, import, school creation, reload, repeat import, practical counts, report controls, diagnosis and backup');
} finally {
  await browser.close();
}
