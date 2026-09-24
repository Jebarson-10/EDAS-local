import type { Teacher, TeacherExemption } from "./types.js";

/** Remarks are source evidence, not permission to assign a medically exempt teacher. */
export function pendingStaffHealthReviews(teachers:Teacher[],exemptions:TeacherExemption[]) {
  return teachers.filter(t=>{
    if(!t.isActive)return false;
    const note=t.officialDetails?.["Health, leave or remarks"]?.trim();
    if(!note||/^(?:no|nil|none|na|n\/a|not applicable|normal|healthy|[-.0]+)$/i.test(note))return false;
    return !exemptions.some(e=>e.teacherId===t.teacherId && (e.isExempted || e.reason===`Staff return reviewed: ${note}`));
  });
}
