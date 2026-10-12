import type { Centre, School, Teacher } from "./types.js";

/** Staff use their current school's saved block; centre blocks must also be saved. */
export function blockReadiness(input: {
  teachers: Teacher[];
  schools: School[];
  centres: Centre[];
}) {
  const schoolById = new Map(input.schools.map(school => [school.schoolId, school]));
  return {
    centreIdsMissingBlock: input.centres.filter(c => c.active && !c.blockId?.trim()).map(c => c.centreId).sort(),
    teacherIdsMissingSchoolBlock: input.teachers.filter(t => t.isActive && !schoolById.get(t.schoolId)?.blockId?.trim()).map(t => t.teacherId).sort(),
  };
}
