import {useState} from "react";
import {pendingStaffHealthReviews} from "@exam-duty/shared";
import {useApp} from "../state/AppContext";
import {upsertExemptionApi} from "../lib/api";
import {Panel} from "./ui";

export function StaffReturnReview(){
  const {dataset,exemptions,setExemptions,role,logAudit}=useApp();
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  if(!dataset)return null;
  const pending=pendingStaffHealthReviews(dataset.teachers,exemptions);
  if(!pending.length)return null;
  async function review(teacherId:string,note:string,isExempted:boolean){
    setBusy(true);
    try{
      const reason=`Staff return reviewed: ${note}`;
      const effectiveFrom="1900-01-01";
      const result=await upsertExemptionApi(role,{teacherId,reason,effectiveFrom,isExempted});
      if(!result?.ok)throw new Error(result?.error??"The review could not be saved.");
      setExemptions([...exemptions,{id:result.id,teacherId,reason,effectiveFrom,isExempted}]);
      logAudit("UPDATE",`Reviewed staff return for ${teacherId}`,reason);
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  return <Panel title="Health and leave details to review"><p className="text-sm mb-3">{pending.length} staff have health or leave remarks in OVER ALL. Confirm whether they can receive duty. Allotment waits until these are reviewed.</p><div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead><tr><th>Staff member</th><th>School</th><th>Remark from school</th><th>Decision</th></tr></thead><tbody>{pending.map(t=>{const note=t.officialDetails!["Health, leave or remarks"]!;return <tr key={t.teacherId} className="border-t"><td className="p-2">{t.name}</td><td className="p-2">{dataset.schools.find(s=>s.schoolId===t.schoolId)?.schoolName}</td><td className="p-2">{note}</td><td className="p-2"><button disabled={busy} className="border rounded p-2 mr-2" onClick={()=>void review(t.teacherId,note,true)}>Exclude from duty</button><button disabled={busy} className="border rounded p-2" onClick={()=>void review(t.teacherId,note,false)}>Available for duty</button></td></tr>;})}</tbody></table></div>{message&&<p>{message}</p>}</Panel>;
}
