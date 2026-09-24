import { readFileSync } from 'node:fs';
import { parseCentreChecklist, parseTeachersWorkbook, schoolReferenceKey } from '../shared/src/index';
// Optional local acceptance check; never writes private rows into the repository.
async function main() {
const [workbook, textDirectory] = process.argv.slice(2);
if (!workbook || !textDirectory) throw new Error('Supply workbook and local OCR-text directory.');
const bytes=readFileSync(workbook);
const staff=await parseTeachersWorkbook(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const centres=parseCentreChecklist(Array.from({length:16},(_,i)=>readFileSync(`${textDirectory}/checklist-${String(i+1).padStart(2,'0')}.txt`,'utf8')));
const refs=new Set(staff.rows.map(r=>schoolReferenceKey(String(r.sourceSchoolCode??''))));
console.log(JSON.stringify({staffRows:staff.rows.length,schools:refs.size,staffWarnings:staff.notes,standard:centres.standard,year:centres.academicYear,centres:new Set(centres.rows.map(r=>r.centreCode)).size,schoolRows:centres.rows.length,unreadableCounts:centres.rows.filter(r=>r.studentCount==null).length,matchedReferences:centres.rows.filter(r=>refs.has(schoolReferenceKey(r.sourceSchoolCode))).length,parserErrors:centres.errors.length},null,2));
}
void main();
