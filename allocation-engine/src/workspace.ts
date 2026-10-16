import {
  WORKSPACE_RULE_VERSION,
  type ExamWorkspace,
  type WorkspaceRun,
  type WorkspaceAssignment,
  type WorkspaceStandard,
  type WorkspaceRole,
  type WorkspaceSchool,
  type WorkspaceStaff,
  type WorkspaceShortage,
} from "@exam-duty/shared";

interface Slot {
  key: string;
  targetId: string;
  code: string;
  udise: string;
  role: WorkspaceRole;
  dates: {
    date: string;
    session: "MORNING" | "AFTERNOON";
    subjects: string[];
  }[];
  posts: string[];
  fallback?: string[];
  ownSchoolExcluded?: string[];
  districtOnly?: boolean;
  routeUdise?: string[];
}
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const radians = (d: number) => (d * Math.PI) / 180;
function distance(a: WorkspaceSchool, b: WorkspaceSchool) {
  if (
    a.latitude == null ||
    a.longitude == null ||
    b.latitude == null ||
    b.longitude == null
  )
    return Infinity;
  const p =
    Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return (
    6371 *
    2 *
    Math.atan2(Math.sqrt(Math.min(1, p)), Math.sqrt(Math.max(0, 1 - p)))
  );
}
function eligibleSubject(teacher: WorkspaceStaff, subject: string) {
  return (
    teacher.appointedSubject === subject ||
    teacher.handlingSubjects.includes(subject)
  );
}
function examinerSubject(
  teacher: WorkspaceStaff,
  subject: string,
  standard: WorkspaceStandard,
) {
  if (standard === "10")
    return (
      teacher.post === "BT" &&
      teacher.standards.includes("10") &&
      teacher.handlingSubjects.includes("SCI")
    );
  if (subject === "EMPLOYABILITY")
    return (
      ["PG", "COMPUTER_INSTRUCTOR"].includes(teacher.post) &&
      ["CS", "CA"].some((s) => eligibleSubject(teacher, s))
    );
  return teacher.post === "PG" && eligibleSubject(teacher, subject);
}
export function workspaceInputErrors(
  w: ExamWorkspace,
  standard: WorkspaceStandard,
  module: "THEORY" | "PRACTICAL",
) {
  const errors: string[] = [];
  if (!w.settings.confirmed)
    errors.push("Review and confirm the new rule settings before allotment.");
  if (!w.schools.length) errors.push("Import School Master.");
  if (!w.staff.length) errors.push("Import Teacher Master.");
  const schoolIds = new Set(w.schools.map((s) => s.udise));
  for (const teacher of w.staff)
    if (!schoolIds.has(teacher.udise))
      errors.push(
        `Staff ${teacher.staffId}: school ${teacher.udise} is missing.`,
      );
  if (module === "THEORY") {
    const centres = w.centres.filter((c) => c.standard === standard);
    const codes = new Set(centres.map((c) => c.code));
    if (!centres.length)
      errors.push(`Add ${standard}th standard centres and student strengths.`);
    if (!w.timetable.some((t) => t.standard === standard))
      errors.push(`Add the ${standard}th standard timetable.`);
    for (const c of centres) {
      if (!schoolIds.has(c.udise))
        errors.push(`Centre ${c.code}: school UDISE ${c.udise} is missing.`);
      for (const u of c.clubbedUdise)
        if (!schoolIds.has(u))
          errors.push(`Centre ${c.code}: clubbed school ${u} is missing.`);
    }
    for (const t of w.timetable.filter((t) => t.standard === standard))
      if (t.centreCode && !codes.has(t.centreCode))
        errors.push(`Timetable: centre ${t.centreCode} is missing.`);
    const points = w.points.filter((p) => p.standard === standard);
    if (!points.some((p) => p.kind === "CUSTODIAN"))
      errors.push(
        "Add custodian points (four by default; adjust the count to your needs).",
      );
    if (standard === "12" && !w.settings.custodianPost12)
      errors.push("Choose the confirmed DEO post for the 12th custodian.");
    for (const p of points) {
      if (!schoolIds.has(p.udise))
        errors.push(`Point ${p.name}: select its school location.`);
      if (p.centreCodes.some((c) => !codes.has(c)))
        errors.push(`Point ${p.name}: one or more centres are missing.`);
    }
    for (const c of centres) {
      const pointsForCentre = points.filter(
        (p) => p.kind === "CUSTODIAN" && p.centreCodes.includes(c.code),
      );
      if (pointsForCentre.length !== 1)
        errors.push(`Centre ${c.code}: link exactly one custodian point.`);
    }
    for (const route of w.routes.filter((r) => r.standard === standard)) {
      const point = points.find(
        (p) => p.id === route.pointId && p.kind === "CUSTODIAN",
      );
      if (
        !point ||
        route.centreCodes.some((c) => !point.centreCodes.includes(c))
      )
        errors.push(
          `Route ${route.id}: choose centres belonging to its custodian point.`,
        );
    }
  } else {
    if (standard === "10" && w.settings.practical10SameRules !== true)
      errors.push("Confirm 10th practical batch and scheduling settings.");
    const demands = w.practical.filter((p) => p.standard === standard);
    if (!demands.length)
      errors.push("Import practical student groups and available dates.");
    for (const p of demands) {
      const school = w.schools.find((s) => s.udise === p.udise);
      const centre = w.schools.find((s) => s.udise === p.centreUdise);
      if (!school || !centre) {
        errors.push(`Practical ${p.id}: school / receiving centre is missing.`);
        continue;
      }
      if (p.students < 15 && p.udise === p.centreUdise)
        errors.push(
          `Practical ${p.id}: fewer than 15 students; select a nearby clubbed receiving centre.`,
        );
      if (
        p.udise !== p.centreUdise &&
        (!p.allowedCentreUdise.includes(p.centreUdise) ||
          school.educationalDistrict !== centre.educationalDistrict)
      )
        errors.push(
          `Practical ${p.id}: receiving school must be an input clubbed choice in the same educational district.`,
        );
      if (centre.management === "UNKNOWN")
        errors.push(
          `School ${centre.name}: choose Government, aided or private management.`,
        );
      if (
        demands.some(
          (d) =>
            d.udise === p.udise &&
            d.cohort === p.cohort &&
            d.students !== p.students,
        )
      )
        errors.push(
          `Practical group ${p.cohort}: subjects for the same students must have the same group count. Split different subject combinations into separate student groups.`,
        );
      if (
        demands.some(
          (d) =>
            d.centreUdise === p.centreUdise &&
            d.subject === p.subject &&
            d.halls !== p.halls,
        )
      )
        errors.push(
          `Practical ${p.id}: use one consistent hall count for this receiving school and subject.`,
        );
    }
  }
  return Array.from(new Set(errors));
}

/** New rules are deliberately isolated from legacy rule versions and defaults. */
export function allocateWorkspace(
  w: ExamWorkspace,
  standard: WorkspaceStandard,
  module: "THEORY" | "PRACTICAL",
  seed: string,
  otherAssignments: WorkspaceAssignment[] = [],
): Omit<WorkspaceRun, "id" | "createdAt" | "published"> {
  const assignments: WorkspaceAssignment[] = [];
  const shortages: WorkspaceShortage[] = [];
  const errors = workspaceInputErrors(w, standard, module);
  const result = {
    standard,
    module,
    ruleVersion: WORKSPACE_RULE_VERSION,
    seed,
    inputRevision: w.revision,
    assignments,
    shortages,
    errors,
  };
  if (errors.length) return result;
  const schoolById = new Map(w.schools.map((s) => [s.udise, s]));
  const history = new Map<string, typeof w.history>();
  for (const h of w.history) {
    const rows = history.get(h.staffId) ?? [];
    rows.push(h);
    history.set(h.staffId, rows);
  }
  const occupied = new Set(
    otherAssignments.map((a) => `${a.staffId}|${a.date}|${a.session}`),
  );
  const distanceCache = new Map<string, number>();
  function km(a: string, b: string) {
    const key = `${a}|${b}`;
    if (!distanceCache.has(key))
      distanceCache.set(
        key,
        schoolById.has(a) && schoolById.has(b)
          ? distance(schoolById.get(a)!, schoolById.get(b)!)
          : Infinity,
      );
    return distanceCache.get(key)!;
  }
  const isHm = (t: WorkspaceStaff) =>
    ["HM", "HM_HSS", "HM_HS", "PRINCIPAL"].includes(t.post);
  const hmEligible = (t: WorkspaceStaff) => {
    const level = schoolById.get(t.udise)?.level;
    return standard === "12"
      ? t.post === "HM_HSS" ||
          (["HM", "PRINCIPAL"].includes(t.post) && level === "HIGHER_SECONDARY")
      : t.post === "HM_HS" ||
          (["HM", "PRINCIPAL"].includes(t.post) && level === "HIGH");
  };
  const seniority = (a: WorkspaceStaff, b: WorkspaceStaff) =>
    (a.postDate ?? "9999").localeCompare(b.postDate ?? "9999") ||
    a.staffId.localeCompare(b.staffId, "en", { numeric: true });
  const teachers = [...w.staff].sort(seniority);
  const vocationalFirstFour = new Set(
    teachers
      .filter((t) => t.post === "VOCATIONAL" && t.postDate)
      .slice(0, 4)
      .map((t) => t.staffId),
  );
  function commonReasons(
    t: WorkspaceStaff,
    udise: string,
    dates: Slot["dates"],
    role: WorkspaceRole,
    districtOnly = false,
    excluded: string[] = [],
    route: string[] = [],
  ) {
    const reasons: string[] = [];
    const school = schoolById.get(t.udise),
      target = schoolById.get(udise);
    if (!t.postDate || dates.some((d) => t.postDate! > d.date))
      reasons.push("Missing or invalid present-post date");
    if (!school || !target) reasons.push("School missing");
    const targets = [udise, ...route];
    if (targets.some((u) => !Number.isFinite(km(t.udise, u))))
      reasons.push("Coordinates missing");
    else if (targets.some((u) => km(t.udise, u) > w.settings.radiusKm + 1e-9))
      reasons.push("Beyond 10 km");
    if (
      districtOnly &&
      school?.educationalDistrict !== target?.educationalDistrict
    )
      reasons.push("Different educational district");
    if (isHm(t) && excluded.includes(t.udise))
      reasons.push("Own or clubbed school HM");
    if (dates.some((d) => occupied.has(`${t.staffId}|${d.date}|${d.session}`)))
      reasons.push("Already on duty");
    if (
      role !== "INTERNAL" &&
      (history.get(t.staffId) ?? []).some(
        (h) =>
          targets.includes(h.centreUdise) &&
          dates.some((d) => {
            const cutoff = new Date(`${d.date}T00:00:00Z`);
            cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
            return (
              h.date >= cutoff.toISOString().slice(0, 10) && h.date < d.date
            );
          }),
      )
    )
      reasons.push("Same centre in previous two years");
    return reasons;
  }
  function reserve(a: WorkspaceAssignment) {
    assignments.push(a);
    occupied.add(`${a.staffId}|${a.date}|${a.session}`);
  }
  function pick(slot: Slot) {
    const tallies: Record<string, number> = {};
    const excluded = (reasons: string[]) => {
      for (const reason of new Set(reasons))
        tallies[reason] = (tallies[reason] ?? 0) + 1;
    };
    let selected: WorkspaceStaff | undefined;
    let fallback = false;
    for (const [bandIndex, posts] of [
      slot.posts,
      slot.fallback ?? [],
    ].entries()) {
      if (!posts.length) continue;
      const candidates: WorkspaceStaff[] = [];
      for (const t of teachers) {
        if (!posts.includes(t.post)) {
          if (!bandIndex) excluded(["Different staff post"]);
          continue;
        }
        const r = commonReasons(
          t,
          slot.udise,
          slot.dates,
          slot.role,
          slot.districtOnly,
          slot.ownSchoolExcluded,
          slot.routeUdise,
        );
        if (isHm(t) && !hmEligible(t)) r.push("Wrong HM school level");
        if (
          ["JUNIOR_ASSISTANT", "OFFICE_ASSISTANT"].includes(slot.role)
            ? t.category !== "NON_TEACHING"
            : t.category !== "TEACHING"
        )
          r.push("Different staff category");
        if (
          slot.role === "SQUAD" &&
          t.post === "VOCATIONAL" &&
          !vocationalFirstFour.has(t.staffId)
        )
          r.push("Outside first four vocational seniority");
        if (
          ["INVIGILATOR", "BACKUP"].includes(slot.role) &&
          slot.dates.some((d) =>
            d.subjects.some(
              (s) =>
                !(w.settings.languageException && ["TAM", "ENG"].includes(s)) &&
                eligibleSubject(t, s),
            ),
          )
        )
          r.push("Exam subject teacher");
        if (r.length) excluded(r);
        else candidates.push(t);
      }
      const reusedOffice = (teacher: WorkspaceStaff) =>
        ["JUNIOR_ASSISTANT", "OFFICE_ASSISTANT"].includes(slot.role) &&
        otherAssignments.some(
          (a) =>
            a.standard !== standard &&
            a.centreUdise === slot.udise &&
            a.role === slot.role &&
            a.staffId === teacher.staffId,
        );
      candidates.sort(
        (a, b) =>
          posts.indexOf(a.post) - posts.indexOf(b.post) ||
          Number(reusedOffice(b)) - Number(reusedOffice(a)) ||
          seniority(a, b),
      );
      selected = candidates[0];
      fallback = bandIndex > 0;
      if (selected) break;
    }
    if (!selected) {
      shortages.push({
        key: slot.key,
        role: slot.role,
        target: slot.code,
        date: slot.dates.map((d) => d.date).join(", "),
        missing: 1,
        reasons: tallies,
      });
      return;
    }
    for (const d of slot.dates)
      reserve({
        key: `${slot.key}|${d.date}|${d.session}`,
        standard,
        date: d.date,
        session: d.session,
        targetId: slot.targetId,
        centreCode: slot.code,
        centreUdise: slot.udise,
        role: slot.role,
        staffId: selected.staffId,
        subject: d.subjects.join(" / "),
        fallback,
      });
  }
  if (module === "THEORY") {
    const centres = w.centres
      .filter((c) => c.standard === standard)
      .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
    const timetable = w.timetable.filter((t) => t.standard === standard);
    function datesFor(codes?: string[]) {
      const sessions = new Map<string, Slot["dates"][number]>();
      for (const t of timetable) {
        if (codes && t.centreCode && !codes.includes(t.centreCode)) continue;
        const k = `${t.date}|${t.session}`;
        const d = sessions.get(k) ?? {
          date: t.date,
          session: t.session,
          subjects: [],
        };
        if (!d.subjects.includes(t.subject)) d.subjects.push(t.subject);
        sessions.set(k, d);
      }
      return [...sessions.values()].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.session === b.session ? 0 : a.session === "MORNING" ? -1 : 1),
      );
    }
    const hm = ["HM_HSS", "HM_HS", "HM", "PRINCIPAL"];
    const assistant = standard === "12" ? ["PG"] : ["BT"];
    const centreSlots = centres.map((c) => ({ c, dates: datesFor([c.code]) }));
    for (const { c, dates } of centreSlots)
      if (!dates.length)
        errors.push(`Centre ${c.code} has no timetable sessions.`);
    if (errors.length) return result;
    // Priority is explicit and stable. The run stores the seed and exact input.
    for (const kind of ["CUSTODIAN", "COLLECTION"] as const)
      for (const point of w.points
        .filter((p) => p.standard === standard && p.kind === kind)
        .sort((a, b) => a.id.localeCompare(b.id))) {
        const dates = datesFor(
          point.centreCodes.length ? point.centreCodes : undefined,
        );
        const common = {
          targetId: point.id,
          code: point.name,
          udise: point.udise,
          dates,
          ownSchoolExcluded: [point.udise],
        };
        pick({
          ...common,
          key: `${point.id}|MAIN`,
          role: kind === "CUSTODIAN" ? "CUSTODIAN" : "LIAISON",
          posts:
            kind === "CUSTODIAN" && standard === "12"
              ? [w.settings.custodianPost12]
              : hm,
        });
        pick({
          ...common,
          key: `${point.id}|SECONDARY`,
          role:
            kind === "CUSTODIAN" ? "SECONDARY_CUSTODIAN" : "SECONDARY_LIAISON",
          posts: kind === "CUSTODIAN" && standard === "12" ? hm : assistant,
        });
      }
    for (const { c, dates } of centreSlots) {
      pick({
        key: `${c.code}|CHIEF`,
        targetId: c.code,
        code: c.code,
        udise: c.udise,
        role: "CHIEF",
        dates,
        posts: hm,
        fallback: assistant,
        ownSchoolExcluded: [c.udise, ...c.clubbedUdise],
      });
      for (let n = 0; n < (c.students > 500 ? 2 : 1); n++)
        pick({
          key: `${c.code}|DEPARTMENT|${n}`,
          targetId: c.code,
          code: c.code,
          udise: c.udise,
          role: "DEPARTMENT",
          dates,
          posts: assistant,
        });
    }
    for (const route of w.routes
      .filter((r) => r.standard === standard)
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const point = w.points.find(
        (p) => p.standard === standard && p.id === route.pointId,
      )!;
      pick({
        key: `ROUTE|${route.id}`,
        targetId: route.id,
        code: route.id,
        udise: point.udise,
        role: "ROUTE",
        dates: datesFor(route.centreCodes),
        posts: assistant,
        routeUdise: centres
          .filter((c) => route.centreCodes.includes(c.code))
          .map((c) => c.udise),
      });
    }
    for (const { c, dates } of centreSlots)
      for (let n = 0; n < Math.ceil(Math.ceil(c.students / 20) / 8); n++)
        pick({
          key: `${c.code}|SQUAD|${n}`,
          targetId: c.code,
          code: c.code,
          udise: c.udise,
          role: "SQUAD",
          dates,
          posts:
            standard === "12" ? ["PD1", "PD2", "VOCATIONAL", "PG"] : ["BT"],
          districtOnly: true,
        });
    for (const { c, dates } of centreSlots) {
      for (const [role, posts, fallback] of [
        ["JUNIOR_ASSISTANT", ["JA"], []],
        ["OFFICE_ASSISTANT", ["OA"], ["RC"]],
      ] as const)
        pick({
          key: `${c.code}|${role}`,
          targetId: c.code,
          code: c.code,
          udise: c.udise,
          role,
          dates,
          posts: [...posts],
          fallback: [...fallback],
        });
      for (const d of dates) {
        const start = assignments.length;
        const halls = Math.ceil(c.students / 20) + 2;
        for (let n = 0; n < halls + 3; n++)
          pick({
            key: `${c.code}|HALL|${d.date}|${d.session}|${n}`,
            targetId: c.code,
            code: c.code,
            udise: c.udise,
            role: n < halls ? "INVIGILATOR" : "BACKUP",
            dates: [d],
            posts: assistant,
          });
        const pool = assignments
          .slice(start)
          .sort(
            (a, b) =>
              hash(`${seed}|${a.date}|${a.session}|${a.staffId}`) -
                hash(`${seed}|${b.date}|${b.session}|${b.staffId}`) ||
              a.staffId.localeCompare(b.staffId),
          );
        // Shuffle only eligible selected staff; all assignments retain unique keys.
        const staffIds = pool.map((a) => a.staffId);
        assignments.slice(start).forEach((a, i) => {
          a.staffId = staffIds[i]!;
        });
      }
    }
    return result;
  }

  const demand = w.practical
    .filter((p) => p.standard === standard)
    .sort((a, b) => a.id.localeCompare(b.id));
  const studentDays = new Set<string>();
  const roomUse = new Map<string, number>();
  const externalSubjects = new Map<string, string>();
  const sessionGroups = new Map<string, string>();
  const parallelGroup = (subject: string) =>
    ["PHY", "CHE"].includes(subject)
      ? "PHYSICS_CHEMISTRY"
      : ["BIO", "BOT", "ZOO", "CS", "CA"].includes(subject)
        ? "BIOLOGY_COMPUTING"
        : `SEPARATE_${subject}`;
  // Reserve every school's own eligible internal staff on all of its possible
  // practical dates before selecting any external. No later school loses its internal.
  const internalReserved = new Set<string>();
  for (const p of demand)
    for (const t of teachers.filter(
      (t) => t.udise === p.udise && examinerSubject(t, p.subject, standard),
    ))
      for (const day of p.dates) internalReserved.add(`${t.staffId}|${day}`);
  for (const p of demand) {
    const batches = Math.ceil(p.students / 30);
    const size = Math.floor(p.students / batches),
      remainder = p.students % batches;
    const target = schoolById.get(p.centreUdise)!;
    for (let batch = 0; batch < batches; batch++) {
      const cohort = `${p.udise}|${p.cohort}|${batch}`;
      const tallies: Record<string, number> = {};
      const reject = (r: string) => {
        tallies[r] = (tallies[r] ?? 0) + 1;
      };
      let placed = false;
      for (const day of [...p.dates].sort()) {
        if (studentDays.has(`${cohort}|${day}`)) {
          reject("Student group already has a practical today");
          continue;
        }
        for (const session of ["MORNING", "AFTERNOON"] as const) {
          const centreSession = `${p.centreUdise}|${day}|${session}`;
          const group = parallelGroup(p.subject);
          if (
            sessionGroups.has(centreSession) &&
            sessionGroups.get(centreSession) !== group
          ) {
            reject("Different parallel subject group in this session");
            continue;
          }
          const roomKey = `${p.centreUdise}|${p.subject}|${day}|${session}`;
          if ((roomUse.get(roomKey) ?? 0) >= p.halls) {
            reject("All subject halls occupied");
            continue;
          }
          const dates = [{ date: day, session, subjects: [p.subject] }];
          function eligible(t: WorkspaceStaff, internal: boolean) {
            if (
              t.category !== "TEACHING" ||
              !examinerSubject(t, p.subject, standard)
            ) {
              reject(
                "Different post or subject / non-handling Science teacher",
              );
              return false;
            }
            if (
              internal
                ? t.udise !== p.udise
                : t.udise === p.centreUdise || t.udise === p.udise
            )
              return false;
            const reasons = commonReasons(
              t,
              p.centreUdise,
              dates,
              internal ? "INTERNAL" : "EXTERNAL",
            );
            if (!internal) {
              if (internalReserved.has(`${t.staffId}|${day}`))
                reasons.push("Needed as internal at own school");
              if (
                target.management === "PRIVATE" &&
                !["GOVERNMENT", "AIDED"].includes(
                  schoolById.get(t.udise)?.management ?? "",
                )
              )
                reasons.push(
                  "Private centre needs Government / aided external",
                );
              const previousSubject = externalSubjects.get(
                `${t.staffId}|${day}`,
              );
              if (previousSubject && previousSubject !== p.subject)
                reasons.push("External already assigned another subject today");
            }
            reasons.forEach(reject);
            return reasons.length === 0;
          }
          const internal = teachers.find((t) => eligible(t, true));
          const external = teachers.find((t) => eligible(t, false));
          if (!internal || !external) continue;
          for (const [teacher, role] of [
            [internal, "INTERNAL"],
            [external, "EXTERNAL"],
          ] as const)
            reserve({
              key: `${p.id}|${batch}|${role}`,
              standard,
              date: day,
              session,
              targetId: p.id,
              centreCode:
                w.centres.find(
                  (c) => c.udise === p.centreUdise && c.standard === standard,
                )?.code ?? "",
              centreUdise: p.centreUdise,
              role,
              staffId: teacher.staffId,
              subject: p.subject,
              batch: batch + 1,
              students: size + (batch < remainder ? 1 : 0),
              cohort: p.cohort,
              demandId: p.id,
            });
          roomUse.set(roomKey, (roomUse.get(roomKey) ?? 0) + 1);
          sessionGroups.set(centreSession, group);
          externalSubjects.set(`${external.staffId}|${day}`, p.subject);
          studentDays.add(`${cohort}|${day}`);
          placed = true;
          break;
        }
        if (placed) break;
      }
      if (!placed)
        shortages.push({
          key: `${p.id}|${batch}`,
          role: "PRACTICAL_PAIR",
          target: target.name,
          date: p.dates.join(", "),
          missing: 1,
          reasons: tallies,
        });
    }
  }
  return result;
}
