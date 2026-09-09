import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { latestRunForModuleInCycle } from "@exam-duty/shared";
import { useApp, isTheoryRun } from "../state/AppContext";
import { Badge, Bento, EmptyState, Tile, TileHeader } from "../components/ui";
import type { HallResult, PracticalResult } from "@exam-duty/allocation-engine";
import { recordExportApi } from "../lib/api";

function downloadBuffer(buf: ArrayBuffer, filename: string) {
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function noteExport(
  role: Parameters<typeof recordExportApi>[0],
  exportType: string,
  examCycleId: string,
  runId?: string,
  meta?: Record<string, unknown>,
) {
  const rec = await recordExportApi(role, {
    exportType,
    examCycleId,
    runId,
    meta,
  });
  if (rec?.ok && rec.exportId) {
    return {
      ok: true as const,
      text: `Receipt recorded (${exportType})`,
    };
  }
  return {
    ok: false as const,
    text: `Downloaded ${exportType} — receipt was not stored${
      rec?.error ? ` (${rec.error})` : ""
    }. Audit will not list this download.`,
  };
}

export function ReportsPage() {
  const { runs, examCycle, role, logAudit, dataset } = useApp();
  const latestPicked = latestRunForModuleInCycle(
    runs,
    "THEORY",
    examCycle.examCycleId,
  );
  const latest =
    latestPicked && isTheoryRun(latestPicked) ? latestPicked : undefined;
  const practical = latestRunForModuleInCycle(
    runs,
    "PRACTICAL",
    examCycle.examCycleId,
  );
  const hall = latestRunForModuleInCycle(
    runs,
    "HALL",
    examCycle.examCycleId,
  );
  const practicalResult = practical?.result as
    PracticalResult | null | undefined;
  const hallResult = hall?.result as HallResult | null | undefined;
  const canExport = role !== "VIEWER";
  const [busyKind, setBusyKind] = useState<
    | null
    | "teacher"
    | "exception"
    | "complete"
    | "pdf"
    | "practical"
    | "dutyIn"
    | "dutyOut"
    | "hall"
  >(null);
  const busyRef = useRef(false);
  const busy = busyKind !== null;
  const [receipt, setReceipt] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  function startBusy(kind: NonNullable<typeof busyKind>) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusyKind(kind);
    return true;
  }
  function stopBusy() {
    busyRef.current = false;
    setBusyKind(null);
  }

  const metaBase = {
    title: "Erode Examination Duty Allotment",
    examCycle: examCycle.name,
    generatedAt: new Date().toISOString(),
    ruleVersion: examCycle.ruleVersionLabel,
    allocationRun: latest?.runId ?? "none",
    officer: role,
    dataVersion: dataset?.meta.slice ?? "demo",
  };

  async function exportTeacherWise() {
    if (!latest?.result || !dataset) return;
    if (!startBusy("teacher")) return;
    try {
      const { buildTeacherWiseWorkbook } = await import("@exam-duty/shared");
      const schoolById = new Map(dataset.schools.map((s) => [s.schoolId, s]));
      const teacherById = new Map(dataset.teachers.map((t) => [t.teacherId, t]));
      const rows = latest.result.assignments.map((a) => {
        const t = teacherById.get(a.teacherId);
        return {
          Teacher: t?.name ?? a.teacherId,
          EmployeeCode: a.employeeCode,
          School: t
            ? (schoolById.get(t.schoolId)?.schoolName ?? t.schoolId)
            : "",
          DutyType: "THEORY",
          Centre: a.centreId,
          Date: a.examDate,
          Session: a.sessionCode,
          Role: a.roleCode,
          Subject: "",
        };
      });
      const buf = await buildTeacherWiseWorkbook(
        { ...metaBase, title: "Teacher-wise duty list" },
        rows,
      );
      downloadBuffer(buf, `teacher-wise-${latest.runId}.xlsx`);
      logAudit("EXPORT", `teacher-wise.xlsx for run ${latest.runId}`);
      setReceipt(
        await noteExport(
          role,
          "teacher-wise-xlsx",
          examCycle.examCycleId,
          latest.runId,
        ),
      );
    } finally {
      stopBusy();
    }
  }

  async function exportException() {
    if (!latest?.result) return;
    if (!startBusy("exception")) return;
    try {
      const { buildExceptionWorkbook } = await import("@exam-duty/shared");
      const rows = [
        ...latest.result.shortages.map((s) => ({
          Kind: "SHORTAGE",
          Key: s.requirementKey,
          Message: s.message,
          Severity: "ERROR",
        })),
        ...latest.result.assignments
          .filter((a) => a.usedFallbackBand)
          .map((a) => ({
            Kind: "FALLBACK",
            Key: a.requirementKey,
            Message: `${a.employeeCode} used fallback band`,
            Severity: "WARN",
          })),
      ];
      const buf = await buildExceptionWorkbook(
        { ...metaBase, title: "Exception report" },
        rows,
      );
      downloadBuffer(buf, `exception-${latest.runId}.xlsx`);
      logAudit("EXPORT", `exception-report.xlsx for run ${latest.runId}`);
      setReceipt(
        await noteExport(
          role,
          "exception-xlsx",
          examCycle.examCycleId,
          latest.runId,
        ),
      );
    } finally {
      stopBusy();
    }
  }

  async function exportComplete() {
    if (!latest?.result || !dataset) return;
    if (!startBusy("complete")) return;
    try {
      const { buildCompleteAllotmentWorkbook } =
        await import("@exam-duty/shared");
    const schoolById = new Map(dataset.schools.map((s) => [s.schoolId, s]));
    const teacherById = new Map(dataset.teachers.map((t) => [t.teacherId, t]));
    const teacherRows = latest.result.assignments.map((a) => {
      const t = teacherById.get(a.teacherId);
      return {
        Teacher: t?.name ?? a.teacherId,
        EmployeeCode: a.employeeCode,
        School: t ? (schoolById.get(t.schoolId)?.schoolName ?? t.schoolId) : "",
        DutyType: "THEORY",
        Centre: a.centreId,
        Date: a.examDate,
        Session: a.sessionCode,
        Role: a.roleCode,
        Subject: "",
      };
    });
    const bySchool = new Map<string, typeof latest.result.assignments>();
    for (const a of latest.result.assignments) {
      const schoolId = teacherById.get(a.teacherId)?.schoolId ?? "unknown";
      const list = bySchool.get(schoolId) ?? [];
      list.push(a);
      bySchool.set(schoolId, list);
    }
    const schoolRows = [...bySchool.entries()].map(
      ([schoolId, assignments]) => {
        const school = schoolById.get(schoolId);
        return {
          School: school?.schoolName ?? schoolId,
          Centre: [...new Set(assignments.map((a) => a.centreId))].join(", "),
          Teachers: String(new Set(assignments.map((a) => a.teacherId)).size),
          Date: [...new Set(assignments.map((a) => a.examDate))].join(", "),
          Session: [...new Set(assignments.map((a) => a.sessionCode))].join(
            ", ",
          ),
          Duty: "THEORY",
        };
      },
    );
    const byCentre = new Map<string, typeof latest.result.assignments>();
    for (const a of latest.result.assignments) {
      const list = byCentre.get(a.centreId) ?? [];
      list.push(a);
      byCentre.set(a.centreId, list);
    }
    const centreRows = [...byCentre.entries()].map(
      ([centreId, assignments]) => ({
        Centre: centreId,
        Teachers: String(new Set(assignments.map((a) => a.teacherId)).size),
        Roles: [...new Set(assignments.map((a) => a.roleCode))].join(", "),
        Dates: [...new Set(assignments.map((a) => a.examDate))].join(", "),
        Sessions: [...new Set(assignments.map((a) => a.sessionCode))].join(
          ", ",
        ),
        Standby: String(
          assignments.filter((a) => a.roleCode.includes("STANDBY")).length,
        ),
      }),
    );
    const buf = await buildCompleteAllotmentWorkbook(
      { ...metaBase, title: "Complete allotment" },
      teacherRows,
      schoolRows,
      centreRows,
    );
    downloadBuffer(buf, `complete-allotment-${latest.runId}.xlsx`);
    logAudit("EXPORT", `complete-allotment.xlsx for run ${latest.runId}`);
    setReceipt(
      await noteExport(
        role,
        "complete-allotment-xlsx",
        examCycle.examCycleId,
        latest.runId,
      ),
    );
    } finally {
      stopBusy();
    }
  }

  async function exportPdf() {
    if (!latest?.result || !dataset) return;
    if (!startBusy("pdf")) return;
    try {
      const { buildTeacherDutyPdf } = await import("../lib/pdfReports");
      const teacherById = new Map(dataset.teachers.map((t) => [t.teacherId, t]));
      const blob = await buildTeacherDutyPdf(
        {
          title: "Teacher-wise duty list (printable)",
          examCycle: examCycle.name,
          ruleVersion: examCycle.ruleVersionLabel,
          runId: latest.runId,
          officer: role,
          generatedAt: new Date().toISOString(),
        },
        latest.result.assignments.map((a) => ({
          employeeCode: a.employeeCode,
          name: teacherById.get(a.teacherId)?.name ?? a.teacherId,
          centre: a.centreId,
          date: a.examDate,
          session: a.sessionCode,
          role: a.roleCode,
        })),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `teacher-duty-${latest.runId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      logAudit("EXPORT", `teacher-duty.pdf for run ${latest.runId}`);
      setReceipt(
        await noteExport(
          role,
          "teacher-duty-pdf",
          examCycle.examCycleId,
          latest.runId,
        ),
      );
    } finally {
      stopBusy();
    }
  }

  async function exportPracticalCsv() {
    if (!practicalResult) return;
    if (!startBusy("practical")) return;
    try {
      const rows = [
        [
          "batchKey",
          "schoolId",
          "subjectId",
          "examDate",
          "session",
          "internal",
          "external",
          "roleSwitch",
        ],
        ...practicalResult.schedules.map((s) => [
          s.batchKey,
          s.schoolId,
          s.subjectId,
          s.examDate,
          s.sessionCode,
          s.internalExaminerId,
          s.externalExaminerId,
          s.roleSwitchApplied ? "yes" : "no",
        ]),
      ];
      downloadCsv(`practical-${practical?.runId ?? "run"}.csv`, rows);
      logAudit("EXPORT", `practical CSV for ${practical?.runId}`);
      setReceipt(
        await noteExport(
          role,
          "practical-csv",
          examCycle.examCycleId,
          practical?.runId,
        ),
      );
    } finally {
      stopBusy();
    }
  }

  async function exportHallCsv() {
    if (!hallResult) return;
    if (!startBusy("hall")) return;
    try {
      const rows = [
        [
          "centreId",
          "role",
          "slot",
          "teacherId",
          "employeeCode",
          "examDate",
          "session",
          "score",
        ],
        ...hallResult.assignments.map((a) => [
          a.centreId,
          a.roleCode,
          String(a.slotIndex),
          a.teacherId,
          a.employeeCode,
          a.examDate,
          a.sessionCode,
          String(a.score),
        ]),
      ];
      downloadCsv(`hall-${hall?.runId ?? "run"}.csv`, rows);
      logAudit("EXPORT", `hall CSV for ${hall?.runId}`);
      setReceipt(
        await noteExport(role, "hall-csv", examCycle.examCycleId, hall?.runId),
      );
    } finally {
      stopBusy();
    }
  }

  function downloadText(filename: string, text: string) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportDutyIn() {
    if (!practicalResult?.schedules.length || !dataset) return;
    if (!startBusy("dutyIn")) return;
    try {
      const { groupDutyInLetters, buildDutyInLetterText } =
        await import("@exam-duty/shared");
      const schoolById = new Map(
        dataset.schools.map((s) => [
          s.schoolId,
          {
            schoolCode: s.schoolCode,
            schoolName: s.schoolName,
            place: s.schoolName,
          },
        ]),
      );
      const teacherById = new Map(
        dataset.teachers.map((t) => [
          t.teacherId,
          { name: t.name, schoolId: t.schoolId },
        ]),
      );
      const letters = groupDutyInLetters({
        academicYearLabel: `HIGHER SECONDARY PRACTICAL EXAMINATION - ${examCycle.academicYear}`,
        districtLabel: "ERODE DISTRICT (synthetic layout)",
        signatoryTitle: "CHIEF EDUCATIONAL OFFICER",
        signatoryPlace: "ERODE",
        schedules: practicalResult.schedules,
        schoolById,
        teacherById,
      });
      const text = letters.map(buildDutyInLetterText).join("\n\n");
      downloadText(`duty-in-${practical?.runId ?? "run"}.txt`, text);
      logAudit(
        "EXPORT",
        `Duty-In letters (${letters.length}) for ${practical?.runId}`,
      );
      setReceipt(
        await noteExport(
          role,
          "duty-in-letters",
          examCycle.examCycleId,
          practical?.runId,
          {
            letterCount: letters.length,
          },
        ),
      );
    } finally {
      stopBusy();
    }
  }

  async function exportDutyOut() {
    if (!practicalResult?.schedules.length || !dataset) return;
    if (!startBusy("dutyOut")) return;
    try {
      const { groupDutyOutLetters, buildDutyOutLetterText } =
        await import("@exam-duty/shared");
      const schoolById = new Map(
        dataset.schools.map((s) => [
          s.schoolId,
          {
            schoolCode: s.schoolCode,
            schoolName: s.schoolName,
            place: s.schoolName,
          },
        ]),
      );
      const teacherById = new Map(
        dataset.teachers.map((t) => [
          t.teacherId,
          { name: t.name, schoolId: t.schoolId },
        ]),
      );
      const letters = groupDutyOutLetters({
        academicYearLabel: `HIGHER SECONDARY SECOND YEAR PRACTICAL EXAMINATION - ${examCycle.academicYear}`,
        districtLabel: "ERODE DISTRICT (synthetic layout)",
        signatoryTitle: "CHIEF EDUCATIONAL OFFICER",
        signatoryPlace: "ERODE",
        schedules: practicalResult.schedules,
        schoolById,
        teacherById,
      });
      const text = letters.map(buildDutyOutLetterText).join("\n\n");
      downloadText(`duty-out-${practical?.runId ?? "run"}.txt`, text);
      logAudit(
        "EXPORT",
        `Duty-Out letters (${letters.length}) for ${practical?.runId}`,
      );
      setReceipt(
        await noteExport(
          role,
          "duty-out-letters",
          examCycle.examCycleId,
          practical?.runId,
          {
            letterCount: letters.length,
          },
        ),
      );
    } finally {
      stopBusy();
    }
  }

  const readiness = [
    { label: "Theory", ready: Boolean(latest?.result), to: "/theory" },
    {
      label: "Practical",
      ready: Boolean(practicalResult?.schedules.length),
      to: "/practical",
    },
    {
      label: "Hall",
      ready: Boolean(hallResult?.assignments.length),
      to: "/hall",
    },
  ];

  return (
    <Bento>
      <Tile span={2}>
        <TileHeader
          title="Export readiness"
          hint="Downloads stay on this machine. A receipt (type, cycle, run) is stored when the API accepts it — the file is not archived."
        />
        <ul className="space-y-2 text-sm">
          {readiness.map((r) => (
            <li
              key={r.label}
              className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] px-3 py-2"
            >
              <span>{r.label}</span>
              <Badge tone={r.ready ? "ok" : "neutral"}>
                {r.ready ? "ready" : "no run"}
              </Badge>
            </li>
          ))}
        </ul>
        {role === "VIEWER" ? (
          <p className="mt-3 text-xs text-[var(--color-warn)]">
            VIEWER cannot download or record exports. Use DATA_OPERATOR, OFFICER
            or ADMIN.
          </p>
        ) : null}
        {receipt ? (
          <p
            data-testid="export-receipt"
            className={`mt-3 text-sm ${
              receipt.ok
                ? "text-[var(--color-ok)]"
                : "text-[var(--color-err)]"
            }`}
          >
            {receipt.text}
          </p>
        ) : null}
      </Tile>

      <Tile span={4}>
          <TileHeader
            title="Theory duty lists"
          hint="Workbooks carry cycle, timestamp, rule version, run id and officer. Home coordinates are never exported (letterhead is OQ-016)."
        />
        {!latest?.result && (
          <EmptyState
            title="No theory run to export"
            body="Generate a theory allocation first. The download stays on this machine; Audit lists a receipt (type, cycle, run) only when the API accepts it."
            action={
              <Link
                to="/theory"
                className="rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-xs text-white"
              >
                Open theory generator
              </Link>
            }
          />
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canExport || !latest?.result || busy}
            onClick={() => void exportTeacherWise()}
            className="rounded bg-[var(--color-brand)] text-white px-3 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "teacher" ? "Preparing…" : "Teacher-wise list (Excel)"}
          </button>
          <button
            type="button"
            disabled={!canExport || !latest?.result || busy}
            onClick={() => void exportException()}
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "exception" ? "Preparing…" : "Shortages and exceptions (Excel)"}
          </button>
          <button
            type="button"
            disabled={!canExport || !latest?.result || busy}
            onClick={() => void exportComplete()}
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "complete" ? "Preparing…" : "Centre and school list (Excel)"}
          </button>
          <button
            type="button"
            disabled={!canExport || !latest?.result || busy}
            onClick={() => void exportPdf()}
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "pdf" ? "Preparing…" : "Teacher duty list (PDF)"}
          </button>
        </div>
      </Tile>

      <Tile span={6}>
        <TileHeader
          title="Practical / hall exports"
          hint="CSV exports plus Duty-In / Duty-Out letters matching client sample layouts (English interim — OQ-016). Question-paper labels are OQ-019."
        />
        {!practicalResult?.schedules.length &&
        !hallResult?.assignments.length ? (
          <EmptyState
            title="No practical or hall run yet"
            body="Generate practical schedules or hall invigilation to enable these downloads."
            action={
              <div className="flex justify-center gap-2">
                <Link
                  to="/practical"
                  className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs"
                >
                  Practical
                </Link>
                <Link
                  to="/hall"
                  className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs"
                >
                  Hall
                </Link>
              </div>
            }
          />
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canExport || !practicalResult?.schedules.length || busy}
            onClick={() => void exportPracticalCsv()}
            data-testid="export-practical-csv"
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "practical" ? "Exporting…" : "practical-schedules.csv"}
          </button>
          <button
            type="button"
            disabled={!canExport || !practicalResult?.schedules.length || busy}
            onClick={() => void exportDutyIn()}
            data-testid="export-duty-in"
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "dutyIn" ? "Exporting…" : "Duty-In.txt"}
          </button>
          <button
            type="button"
            disabled={!canExport || !practicalResult?.schedules.length || busy}
            onClick={() => void exportDutyOut()}
            data-testid="export-duty-out"
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "dutyOut" ? "Exporting…" : "Duty-Out.txt"}
          </button>
          <button
            type="button"
            disabled={!canExport || !hallResult?.assignments.length || busy}
            onClick={() => void exportHallCsv()}
            data-testid="export-hall-csv"
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "hall" ? "Exporting…" : "hall-assignments.csv"}
          </button>
        </div>
      </Tile>
    </Bento>
  );
}
