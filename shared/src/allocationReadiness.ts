import type { Centre, School, Teacher } from "./types.js";

function hasCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean {
  return (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Reports the exact location information needed to enforce the 10 km rule.
 * A staff member may use either their home location or their current school's
 * location, while every receiving centre must have its own location.
 */
export function distanceReadiness(input: {
  teachers: Teacher[];
  schools: School[];
  centres: Centre[];
}): {
  centreIdsMissingCoordinates: string[];
  schoolIdsMissingCoordinates: string[];
  teacherIdsWithoutDistanceLocation: string[];
} {
  const schoolById = new Map(input.schools.map((school) => [school.schoolId, school]));
  const centreIdsMissingCoordinates = input.centres
    .filter(
      (centre) =>
        centre.active && !hasCoordinates(centre.latitude, centre.longitude),
    )
    .map((centre) => centre.centreId)
    .sort();
  const teacherIdsWithoutDistanceLocation = input.teachers
    .filter((teacher) => {
      if (!teacher.isActive) return false;
      if (hasCoordinates(teacher.homeLatitude, teacher.homeLongitude)) return false;
      const school = schoolById.get(teacher.schoolId);
      return !hasCoordinates(school?.latitude, school?.longitude);
    })
    .map((teacher) => teacher.teacherId)
    .sort();
  const schoolIdsMissingCoordinates = [
    ...new Set(
      teacherIdsWithoutDistanceLocation
        .map((teacherId) => input.teachers.find((teacher) => teacher.teacherId === teacherId)?.schoolId)
        .filter((schoolId): schoolId is string => Boolean(schoolId)),
    ),
  ].sort();

  return {
    centreIdsMissingCoordinates,
    schoolIdsMissingCoordinates,
    teacherIdsWithoutDistanceLocation,
  };
}
