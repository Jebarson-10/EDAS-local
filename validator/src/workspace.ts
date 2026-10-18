import {
  type ExamWorkspace,
  type WorkspaceAssignment,
  type WorkspaceRun,
} from "@exam-duty/shared";

/** Independent checks: this module does not import or call the allocator. */
export function validateWorkspaceRun(
  w: ExamWorkspace,
  run: Pick<WorkspaceRun, "assignments" | "standard" | "module" | "shortages">,
  other: WorkspaceAssignment[] = [],
): string[] {
  const issues = new Set<string>();
  const staff = new Map(w.staff.map((t) => [t.staffId, t]));
  const schools = new Map(w.schools.map((s) => [s.udise, s]));
  const taken = new Set(
    other.map((a) => `${a.staffId}|${a.date}|${a.session}`),
  );
  const keys = new Set<string>();
  const teachingRoles = new Set([
    "CUSTODIAN",
    "SECONDARY_CUSTODIAN",
    "LIAISON",
    "SECONDARY_LIAISON",
    "ROUTE",
    "CHIEF",
    "DEPARTMENT",
    "SQUAD",
    "INVIGILATOR",
    "BACKUP",
    "INTERNAL",
    "EXTERNAL",
  ]);
  const hm = ["HM", "HM_HS", "HM_HSS", "PRINCIPAL"];
  const assistant = run.standard === "12" ? "PG" : "BT";
  const vocationals = w.staff
    .filter((t) => t.post === "VOCATIONAL" && t.postDate)
    .sort(
      (a, b) =>
        a.postDate!.localeCompare(b.postDate!) ||
        a.staffId.localeCompare(b.staffId, "en", { numeric: true }),
    )
    .slice(0, 4)
    .map((t) => t.staffId);
  const chiefs = new Map<string, string>();
  const studentDays = new Map<string, string>();
  const externalDay = new Map<string, string>();
  const rooms = new Map<string, number>();
  const seenBatches = new Set<string>();
  const repeatHistory = new Map<string, typeof w.history>();
  for (const h of w.history) {
    const rows = repeatHistory.get(h.staffId) ?? [];
    rows.push(h);
    repeatHistory.set(h.staffId, rows);
  }
  for (const a of run.assignments) {
    const fail = (message: string) => issues.add(`${a.key}: ${message}`);
    if (a.manual && (!a.manual.parentRunId || a.manual.reason.trim().length < 3 || !Number.isFinite(Date.parse(a.manual.approvedAt)) || a.manual.policyVersion !== "ERODE-MANUAL-2026-10-18"))
      fail("Manual assignment needs a saved reason, original list and approval date.");
    if (keys.has(a.key)) fail("Repeated assignment key.");
    keys.add(a.key);
    if (a.standard !== run.standard)
      fail("Assignment belongs to another standard.");
    const t = staff.get(a.staffId),
      target = schools.get(a.centreUdise);
    if (!t || !target) {
      fail("Staff or duty school is missing.");
      continue;
    }
    const school = schools.get(t.udise);
    if (!school) {
      fail("Staff school is missing.");
      continue;
    }
    if (!t.postDate || t.postDate > a.date)
      fail("Present-post appointment date is missing or after the exam.");
    const simultaneous = `${a.staffId}|${a.date}|${a.session}`;
    if (taken.has(simultaneous)) fail("Staff has simultaneous duties.");
    taken.add(simultaneous);
    if (
      teachingRoles.has(a.role)
        ? t.category !== "TEACHING"
        : t.category !== "NON_TEACHING"
    )
      fail("Wrong staff category.");
    const centres = w.centres.filter((c) => c.standard === run.standard);
    const c = centres.find((c) => c.code === a.centreCode);
    const targets = [target];
    if (a.role === "ROUTE") {
      const route = w.routes.find(
        (r) => r.id === a.targetId && r.standard === run.standard,
      );
      if (!route) fail("Route is missing.");
      for (const code of route?.centreCodes ?? []) {
        const destination = schools.get(
          centres.find((c) => c.code === code)?.udise ?? "",
        );
        if (destination) targets.push(destination);
        else fail("Route centre is missing.");
      }
    }
    for (const destination of targets) {
      if (
        [
          school.latitude,
          school.longitude,
          destination.latitude,
          destination.longitude,
        ].some((v) => v == null)
      )
        fail("Coordinates are missing.");
      else {
        const r = Math.PI / 180;
        const dLat = (destination.latitude! - school.latitude!) * r;
        const dLon = (destination.longitude! - school.longitude!) * r;
        const x =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(school.latitude! * r) *
            Math.cos(destination.latitude! * r) *
            Math.sin(dLon / 2) ** 2;
        const km = 12742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, x))));
        if (km > 10 + 1e-9 && !a.manual?.distanceException)
          fail("Duty is outside the 10 km school radius.");
      }
      if (a.role !== "INTERNAL") {
        const cutoff = new Date(`${a.date}T00:00:00Z`);
        cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
        if (
          (repeatHistory.get(t.staffId) ?? []).some(
            (h) =>
              h.centreUdise === destination.udise &&
              h.date < a.date &&
              h.date >= cutoff.toISOString().slice(0, 10),
          )
        )
          fail("Previous-two-year centre restriction.");
      }
    }
    const isHm = hm.includes(t.post);
    const rightHm =
      run.standard === "12"
        ? t.post === "HM_HSS" ||
          (["HM", "PRINCIPAL"].includes(t.post) &&
            school.level === "HIGHER_SECONDARY")
        : t.post === "HM_HS" ||
          (["HM", "PRINCIPAL"].includes(t.post) && school.level === "HIGH");
    if (isHm && !rightHm)
      fail("HM school level is not eligible for this standard.");
    if (isHm && c && [c.udise, ...c.clubbedUdise].includes(t.udise))
      fail("HM is assigned to own / clubbed centre.");
    if (
      [
        "DEPARTMENT",
        "ROUTE",
        "INVIGILATOR",
        "BACKUP",
        "SECONDARY_LIAISON",
      ].includes(a.role) &&
      t.post !== assistant
    )
      fail("Wrong assistant post for this standard.");
    if (a.role === "CHIEF") {
      if (!rightHm && t.post !== assistant)
        fail("Chief requires the standard's HM or senior assistant fallback.");
      const prior = chiefs.get(a.centreCode);
      if (prior && prior !== a.staffId)
        fail("Chief changed during the timetable.");
      chiefs.set(a.centreCode, a.staffId);
    }
    if (
      a.role === "CUSTODIAN" &&
      !(run.standard === "12" ? t.post === w.settings.custodianPost12 : rightHm)
    )
      fail("Wrong custodian post.");
    if (
      a.role === "SECONDARY_CUSTODIAN" &&
      !(run.standard === "12" ? rightHm : t.post === "BT")
    )
      fail("Wrong secondary custodian post.");
    if (a.role === "LIAISON" && !rightHm)
      fail("Liaison requires the standard's HM.");
    if (a.role === "JUNIOR_ASSISTANT" && t.post !== "JA")
      fail("Junior Assistant slot requires a Junior Assistant.");
    if (a.role === "OFFICE_ASSISTANT" && !["OA", "RC"].includes(t.post))
      fail("Office Assistant slot requires OA or Record Clerk.");
    if (a.role === "SQUAD") {
      if (
        !(run.standard === "10"
          ? t.post === "BT"
          : ["PD1", "PD2", "PG"].includes(t.post) ||
            (t.post === "VOCATIONAL" && vocationals.includes(t.staffId)))
      )
        fail("Wrong squad post / vocational seniority.");
      if (school.educationalDistrict !== target.educationalDistrict)
        fail("Squad is outside its educational district.");
    }
    const matchingSessions = w.timetable.filter(
      (e) =>
        e.standard === run.standard &&
        e.date === a.date &&
        e.session === a.session &&
        (!e.centreCode || e.centreCode === a.centreCode),
    );
    if (["INVIGILATOR", "BACKUP"].includes(a.role)) {
      if (!matchingSessions.length)
        fail("Hall duty has no matching timetable session.");
      for (const exam of matchingSessions)
        if (
          !(
            w.settings.languageException &&
            ["TAM", "ENG"].includes(exam.subject)
          ) &&
          (t.appointedSubject === exam.subject ||
            t.handlingSubjects.includes(exam.subject))
        )
          fail("Teacher handles the examined subject.");
    }
    if (a.role === "INTERNAL" || a.role === "EXTERNAL") {
      const p = w.practical.find(
        (p) => p.id === a.demandId && p.standard === run.standard,
      );
      if (!p) {
        fail("Practical input is missing.");
        continue;
      }
      if (run.standard === "10" && p.subject !== "SCI")
        fail("SSLC practical input must use the combined Science paper.");
      if (
        a.centreUdise !== p.centreUdise ||
        !p.dates.includes(a.date) ||
        a.subject !== p.subject
      )
        fail("Practical date, school or paper differs from input.");
      if (!a.batch || !a.students || a.students > 30)
        fail("Practical batch size / number is invalid.");
      const subjectOk =
        t.appointedSubject === p.subject ||
        t.handlingSubjects.includes(p.subject);
      if (
        run.standard === "10"
          ? t.post !== "BT" ||
            !t.standards.includes("10") ||
            !t.handlingSubjects.includes("SCI")
          : p.subject === "EMPLOYABILITY"
            ? !["PG", "COMPUTER_INSTRUCTOR"].includes(t.post) ||
              ![t.appointedSubject, ...t.handlingSubjects].some((s) =>
                ["CS", "CA"].includes(s),
              )
            : t.post !== "PG" || !subjectOk
      )
        fail("Examiner does not have the required post / teaching subject.");
      if (a.role === "INTERNAL" && t.udise !== p.udise)
        fail("Internal is not from the student's school.");
      if (a.role === "EXTERNAL") {
        if ([p.udise, p.centreUdise].includes(t.udise))
          fail("External is from the same school / centre.");
        if (
          target.management === "PRIVATE" &&
          !["GOVERNMENT", "AIDED"].includes(school.management)
        )
          fail(
            "Private centre external must come from Government / aided school.",
          );
        if (
          w.practical.some(
            (d) =>
              d.standard === run.standard &&
              d.udise === t.udise &&
              d.dates.includes(a.date) &&
              (t.appointedSubject === d.subject ||
                t.handlingSubjects.includes(d.subject)),
          )
        )
          fail("External is required as internal at own school.");
        const dayKey = `${a.staffId}|${a.date}`;
        if (externalDay.has(dayKey) && externalDay.get(dayKey) !== a.subject)
          fail("External has different subjects on the same day.");
        externalDay.set(dayKey, a.subject);
      }
      const batchKey = `${p.id}|${a.batch}`;
      if (!seenBatches.has(batchKey)) {
        seenBatches.add(batchKey);
        const dayKey = `${p.udise}|${p.cohort}|${a.batch}|${a.date}`;
        if (studentDays.has(dayKey) && studentDays.get(dayKey) !== p.id)
          fail("Student group has two practicals in one day.");
        studentDays.set(dayKey, p.id);
        const roomKey = `${p.centreUdise}|${p.subject}|${a.date}|${a.session}`;
        rooms.set(roomKey, (rooms.get(roomKey) ?? 0) + 1);
        if (rooms.get(roomKey)! > p.halls)
          fail("More batches than available subject halls.");
      }
    }
  }
  if (run.module === "THEORY")
    for (const c of w.centres.filter((c) => c.standard === run.standard)) {
      const sessions = new Map(
        w.timetable
          .filter(
            (t) =>
              t.standard === run.standard &&
              (!t.centreCode || t.centreCode === c.code),
          )
          .map((t) => [`${t.date}|${t.session}`, t]),
      );
      for (const t of sessions.values())
        for (const [role, count] of Object.entries({
          CHIEF: 1,
          DEPARTMENT: c.students > 500 ? 2 : 1,
          JUNIOR_ASSISTANT: 1,
          OFFICE_ASSISTANT: 1,
          SQUAD: Math.ceil(Math.ceil(c.students / 20) / 8),
          INVIGILATOR: Math.ceil(c.students / 20) + 2,
          BACKUP: 3,
        })) {
          const actual = run.assignments.filter(
            (a) =>
              a.centreCode === c.code &&
              a.date === t.date &&
              a.session === t.session &&
              a.role === role,
          ).length;
          const gaps = run.shortages
            .filter(
              (s) =>
                s.target === c.code &&
                s.role === role &&
                s.date.includes(t.date),
            )
            .reduce((sum, s) => sum + s.missing, 0);
          if (actual > count || actual + gaps < count)
            issues.add(
              `${c.code} ${t.date}: ${role} expected ${count}; found ${actual}, reported shortage ${gaps}.`,
            );
        }
    }
  if (run.module === "PRACTICAL")
    for (const p of w.practical.filter((p) => p.standard === run.standard)) {
      const external = run.assignments.filter(
        (a) => a.demandId === p.id && a.role === "EXTERNAL",
      );
      for (const a of external)
        if (
          run.assignments.filter(
            (i) =>
              i.demandId === p.id &&
              i.batch === a.batch &&
              i.date === a.date &&
              i.session === a.session &&
              i.role === "INTERNAL",
          ).length !== 1
        )
          issues.add(`${p.id} batch ${a.batch}: missing / repeated internal.`);
      if (
        !run.shortages.some((s) => s.key.startsWith(`${p.id}|`)) &&
        external.reduce((sum, a) => sum + (a.students ?? 0), 0) !== p.students
      )
        issues.add(
          `${p.id}: allocated batch students do not equal the input student count.`,
        );
    }
  return [...issues];
}
