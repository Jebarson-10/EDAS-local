import { useEffect, useState } from "react";
import { assertMutable, schoolNameKey, schoolReferenceKey } from "@exam-duty/shared";
import { useApp } from "../state/AppContext";
import { Panel } from "./ui";
import { practicalStudentsApi, type PracticalStudentRow } from "../lib/api";

export function PracticalStudentsImport() {
  const {dataset,role,examCycle}=useApp();
  const [rows,setRows]=useState<PracticalStudentRow[]>([]);
  const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  useEffect(()=>{let cancelled=false;void practicalStudentsApi(role,examCycle.examCycleId).then(r=>{if(!cancelled)setRows(r);}).catch(e=>{if(!cancelled)setMessage(String(e.message));});return()=>{cancelled=true;};},[role,examCycle.examCycleId]);
  if(!dataset)return null;
  async function template(){
    const ExcelJS=(await import("exceljs")).default;const book=new ExcelJS.Workbook();const sheet=book.addWorksheet("Practical students");
    sheet.addRow(["School name","School reference","Subject","Students"]);sheet.getRow(1).font={bold:true};
    for(const s of dataset!.schools)sheet.addRow([s.schoolName,s.sourceSchoolCode??"","",""]);
    sheet.columns.forEach(c=>{c.width=30;});
    const url=URL.createObjectURL(new Blob([await book.xlsx.writeBuffer()],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));const a=document.createElement("a");a.href=url;a.download="Practical-students.xlsx";a.click();URL.revokeObjectURL(url);
  }
  async function upload(file:File){
    setBusy(true);setMessage("");
    try{
      const ExcelJS=(await import("exceljs")).default;const book=new ExcelJS.Workbook();await book.xlsx.load(await file.arrayBuffer());const sheet=book.worksheets[0];if(!sheet)throw new Error("The workbook has no sheets.");
      const headers=(sheet.getRow(1).values as unknown[]).map(v=>String(v??"").trim().toLowerCase());
      const name=headers.indexOf("school name"),ref=headers.indexOf("school reference"),subject=headers.indexOf("subject"),count=headers.indexOf("students");
      if(subject<0||count<0||(name<0&&ref<0))throw new Error("Use the downloadable template: School name, School reference, Subject, Students.");
      const loaded:PracticalStudentRow[]=[];const errors:string[]=[];
      sheet.eachRow((row,index)=>{if(index===1)return;const get=(i:number)=>i>0?row.getCell(i).text.trim():"";
        if(!get(subject)&&!get(count))return;
        const schools=dataset!.schools.filter(s=>get(ref)?s.sourceSchoolCode&&schoolReferenceKey(s.sourceSchoolCode)===schoolReferenceKey(get(ref)):schoolNameKey(s.schoolName)===schoolNameKey(get(name)));
        const students=Number(get(count));
        if(schools.length!==1||!get(subject)||!get(count)||!Number.isInteger(students)||students<=0){errors.push(`Row ${index}: check school, subject and student count.`);return;}
        loaded.push({schoolId:schools[0]!.schoolId,subjectId:get(subject),studentCount:students});
      });
      if(errors.length)throw new Error(errors.join(" "));
      if(!loaded.length)throw new Error("Add a subject and student count below the headings.");
      setRows(loaded);setMessage(`Read ${loaded.length} school subjects. Check and save below.`);
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  const field="border rounded p-2 bg-white w-full";
  return <Panel title="3. Practical subject counts">
    <p className="text-sm mb-3">Enter the actual students taking each practical subject at each school. The 13A total does not identify subjects. Batches are split evenly with no more than 50 students by default.</p>
    <div className="flex gap-2 mb-3"><button className="border rounded p-2" onClick={()=>void template()}>Download practical template</button><label className="border rounded p-2 cursor-pointer">Upload practical Excel<input className="hidden" type="file" accept=".xlsx" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);e.target.value="";}} /></label></div>
    <div className="max-h-80 overflow-auto"><table className="w-full text-sm"><thead><tr><th>School</th><th>Subject</th><th>Students</th><th /></tr></thead><tbody>{rows.map((row,i)=><tr key={i}><td><select aria-label={`Practical school ${i+1}`} className={field} value={row.schoolId} onChange={e=>setRows(prev=>prev.map((r,j)=>j===i?{...r,schoolId:e.target.value}:r))}><option value="">Choose school</option>{dataset.schools.map(s=><option key={s.schoolId} value={s.schoolId}>{s.schoolName}</option>)}</select></td><td><input aria-label={`Practical subject ${i+1}`} className={field} value={row.subjectId} list="practical-subjects" onChange={e=>setRows(prev=>prev.map((r,j)=>j===i?{...r,subjectId:e.target.value}:r))} /></td><td><input aria-label={`Practical students ${i+1}`} type="number" min={1} step={1} className={field} value={row.studentCount||""} onChange={e=>setRows(prev=>prev.map((r,j)=>j===i?{...r,studentCount:Number(e.target.value)}:r))} /></td><td><button className="p-2" onClick={()=>setRows(prev=>prev.filter((_,j)=>j!==i))}>Remove</button></td></tr>)}</tbody></table></div>
    <datalist id="practical-subjects">{dataset.subjects?.filter(s=>s.isPractical).map(s=><option key={s.subjectId} value={s.code}>{s.name}</option>)}</datalist>
    <div className="flex gap-2 mt-3"><button className="border rounded p-2" onClick={()=>setRows(prev=>[...prev,{schoolId:"",subjectId:"",studentCount:0}])}>Add school subject</button><button className="border rounded p-2 disabled:opacity-40" disabled={busy||!assertMutable(examCycle.status,"save").ok} onClick={()=>{setBusy(true);void practicalStudentsApi(role,examCycle.examCycleId,rows).then(saved=>{setRows(saved);setMessage(`Saved ${saved.length} school subjects. They will be used for practical allotment.`);}).catch(e=>setMessage(e.message)).finally(()=>setBusy(false));}}>Save practical counts</button></div>
    {message&&<p className="mt-3" role="status">{message}</p>}
  </Panel>;
}
