// Read-only analysis of an explicitly supplied file. Outputs stay outside the repo.
import { createWorker, PSM } from 'tesseract.js';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const lang = require('@tesseract.js-data/eng');
const folder = process.argv[2];
const worker = await createWorker('eng', 1, { langPath: lang.langPath, cacheMethod: 'none' });
await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
for (let i = 1; i <= Number(process.argv[3] ?? 1); i++) {
  const { data } = await worker.recognize(`${folder}/checklist-${String(i).padStart(2, '0')}.png`);
  await writeFile(`${folder}/checklist-${String(i).padStart(2, '0')}.txt`, data.text);
  console.log(`Page ${i}: ${data.text.length} characters`);
}
await worker.terminate();
