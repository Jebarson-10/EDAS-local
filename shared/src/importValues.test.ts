import {describe,expect,it} from 'vitest';
import ExcelJS from 'exceljs';
import {readFileSync} from 'node:fs';
import {normalizeImportValue} from './importValues.js';
import {guessImportColumns,mapImportColumns,planColumnImport} from './columnImport.js';
import {previewTeacherImport} from './importPreview.js';

describe('flexible Excel values and template',()=>{
 it('accepts text counts, grouped counts, and numeric identifiers without dropping zeros',()=>{
  expect(normalizeImportValue('capacity','1,200')).toBe(1200);
  expect(normalizeImportValue('capacity','1,20,000')).toBe(120000);
  expect(normalizeImportValue('schoolCode',123)).toBe('123');
  expect(normalizeImportValue('schoolCode','00123')).toBe('00123');
  expect(normalizeImportValue('homeLatitude',' 11.34 ')).toBe(11.34);
 });
 it('accepts local dates and validates real days without guessing month-first',()=>{
  expect(normalizeImportValue('joiningDate','15/06/2010')).toBe('2010-06-15');
  expect(normalizeImportValue('joiningDate','03-04-2010')).toBe('2010-04-03');
  expect(normalizeImportValue('joiningDate',new Date('2010-06-15T00:00:00Z'))).toBe('2010-06-15');
  expect(()=>normalizeImportValue('joiningDate','31/02/2010')).toThrow('day/month/year');
 });
 it('accepts boolean spellings and leaves absent values absent',()=>{
  for(const value of [1,'1',true,'Yes','Y','ஆம்'])expect(normalizeImportValue('isActive',value)).toBe(true);
  for(const value of [0,'0',false,'No','N','இல்லை'])expect(normalizeImportValue('isActive',value)).toBe(false);
  expect(normalizeImportValue('seniorityRank',null)).toBeNull();
  expect(()=>normalizeImportValue('capacity','12,5')).toThrow('enter a value');
 });
 it('normalises old teacher uploads as well and explains genuine invalid values simply',()=>{
  const row={employeeCode:123,name:'Test teacher',schoolCode:12,designation:'PG',seniorityRank:'2',homeLatitude:'11.34',homeLongitude:77,joiningDate:'15/06/2010',isActive:1};
  const parsed=previewTeacherImport([row],[]);
  expect(parsed.invalidRows).toBe(0);
  expect(parsed.rows[0]?.payload).toMatchObject({employeeCode:'123',schoolCode:'12',seniorityRank:2,joiningDate:'2010-06-15'});
  const bad=previewTeacherImport([{...row,homeLatitude:200}],[]);
  expect(bad.rows[0]?.message).toContain('between -90 and 90');
  expect(bad.rows[0]?.message).not.toMatch(/Expected|received|string/);
 });
 it('ships blank unlocked entry sheets whose exact headers all map',async()=>{
  const wb=new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(new URL('../../frontend/public/templates/EDAS-import-template.xlsx',import.meta.url)) as unknown as ArrayBuffer);
  expect(wb.worksheets.map(s=>s.name)).toEqual(['Teachers','Schools','Blocks','How to fill']);
  for(const name of ['Teachers','Schools','Blocks']){
   const s=wb.getWorksheet(name)!;
   const headers=(s.getRow(1).values as unknown[]).slice(1);
   expect(guessImportColumns(headers)).not.toContain('');
   s.eachRow((row,n)=>{if(n>1)expect(row.actualCellCount).toBe(0);});
   expect(s.getCell('A2').dataValidation).toBeUndefined();
  }
  const s=wb.getWorksheet('Schools')!;
  const mapping=guessImportColumns((s.getRow(1).values as unknown[]).slice(1));
  const rows=mapImportColumns([['Test school',123,'Test block',1,'11.34','77.72','1,200']],mapping);
  expect(rows.errors).toEqual([]);
  const planned=planColumnImport(rows.rows,{blocks:[],schools:[]});
  expect(planned.errors).toEqual([]);
  expect(planned.records[1]).toMatchObject({schoolCode:'123',capacity:1200});
 });
});
