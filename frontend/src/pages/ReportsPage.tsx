import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  type CentreDutyOrderAssignment,
  type PracticalExaminerSchedule,
  latestRunForModuleInCycle,
} from "@exam-duty/shared";
import { isTheoryRun, useApp } from "../state/AppContext";
import { Bento, Tile, TileHeader } from "../components/ui";
import type { HallResult, PracticalResult } from "@exam-duty/allocation-engine";
import { recordExportApi } from "../lib/api";

function downloadBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function theoryDutyAssignments(
  assignments: Array<{
    centreId: string;
    teacherId: string;
    roleCode: string;
    examDate: string;
    sessionCode: string;
  }>,
): CentreDutyOrderAssignment[] {
  const result: CentreDutyOrderAssignment[] = [];
  for (const assignment of assignments) {
    if (
      assignment.roleCode === "CHIEF_EXAMINATION" ||
      assignment.roleCode === "DEPARTMENT_OFFICER" ||
      assignment.roleCode === "OFFICE_STAFF"
    ) {
      result.push({ ...assignment, roleCode: assignment.roleCode });
    }
  }
  return result;
}

function hallDutyAssignments(
  assignments: Array<{
    centreId: string;
    teacherId: string;
    roleCode: "HALL_INVIGILATOR" | "HALL_STANDBY";
    examDate: string;
    sessionCode: string;
    slotIndex: number;
  }>,
): CentreDutyOrderAssignment[] {
  return assignments.map((assignment) => ({ ...assignment }));
}

async function noteDownload(
  role: Parameters<typeof recordExportApi>[0],
  exportType: string,
  examCycleId: string,
  runId?: string,
  meta?: Record<string, unknown>,
) {
  const saved = await recordExportApi(role, { exportType, examCycleId, runId, meta });
  return saved?.ok
    ? { ok: true as const, text: "Download noted in Activity." }
    : {
        ok: false as const,
        text: "The file downloaded, but Activity could not be updated.",
      };
}

export function ReportsPage() {
  const { runs, examCycle, role, logAudit, dataset } = useApp();
  const selectedTheory = latestRunForModuleInCycle(runs, "THEORY", examCycle.examCycleId);
  const theory = selectedTheory && isTheoryRun(selectedTheory) ? selectedTheory : undefined;
  const practical = latestRunForModuleInCycle(runs, "PRACTICAL", examCycle.examCycleId);
  const hall = latestRunForModuleInCycle(runs, "HALL", examCycle.examCycleId);
  const practicalResult = practical?.result as PracticalResult | null | undefined;
  const hallResult = hall?.result as HallResult | null | undefined;
  const [busyKind, setBusyKind] = useState<"theory" | "officers" | "practical" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const busyRef = useRef(false);
  const busy = busyKind !== null;

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

  function centreDutyInput() {
    if (!dataset || !theory?.result) return undefined;
    return {
      title: examCycle.name,
      centres: dataset.centres,
      schools: dataset.schools,
      teachers: dataset.teachers,
      theoryAssignments: theoryDutyAssignments(theory.result.assignments),
      hallAssignments: hallDutyAssignments(hallResult?.assignments ?? []),
    };
  }

  async function exportCentreDutyOrder() {
    const input = centreDutyInput();
    if (!input || !hallResult?.assignments.length || !startBusy("theory")) return;
    try {
      const { buildCentreWiseTheoryDutyWorkbook } = await import("@exam-duty/shared");
      downloadBuffer(
        await buildCentreWiseTheoryDutyWorkbook(input),
        `Theory-duty-order-${examCycle.academicYear}.xlsx`,
      );
      logAudit("EXPORT", `Centre-wise theory duty order for ${theory?.runId ?? "run"}`);
      setMessage(
        await noteDownload(role, "centre-theory-duty-order-xlsx", examCycle.examCycleId, theory?.runId, {
          hallRunId: hall?.runId,
        }),
      );
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Could not prepare the theory duty order.",
      });
    } finally {
      stopBusy();
    }
  }

  async function exportOfficerReference() {
    const input = centreDutyInput();
    if (!input || !startBusy("officers")) return;
    try {
      const { buildChiefAndDepartmentWorkbook } = await import("@exam-duty/shared");
      downloadBuffer(
        await buildChiefAndDepartmentWorkbook(input),
        `Chief-and-departmental-officers-${examCycle.academicYear}.xlsx`,
      );
      logAudit("EXPORT", `Chief and departmental officer reference for ${theory?.runId ?? "run"}`);
      setMessage(
        await noteDownload(role, "chief-department-reference-xlsx", examCycle.examCycleId, theory?.runId),
      );
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Could not prepare the officer reference list.",
      });
    } finally {
      stopBusy();
    }
  }

  async function exportPracticalExaminers() {
    if (!dataset || !practicalResult?.schedules.length || !startBusy("practical")) return;
    try {
      const { buildPracticalExaminerWorkbook } = await import("@exam-duty/shared");
      const schedules: PracticalExaminerSchedule[] = practicalResult.schedules.map((schedule) => ({
        batchKey: schedule.batchKey,
        schoolId: schedule.schoolId,
        subjectId: schedule.subjectId,
        examDate: schedule.examDate,
        sessionCode: schedule.sessionCode,
        internalExaminerId: schedule.internalExaminerId,
        externalExaminerId: schedule.externalExaminerId,
      }));
      downloadBuffer(
        await buildPracticalExaminerWorkbook({
          title: examCycle.name,
          schools: dataset.schools,
          teachers: dataset.teachers,
          schedules,
        }),
        `Practical-examiner-list-${examCycle.academicYear}.xlsx`,
      );
      logAudit("EXPORT", `Practical examiner list for ${practical?.runId ?? "run"}`);
      setMessage(
        await noteDownload(role, "practical-examiner-list-xlsx", examCycle.examCycleId, practical?.runId),
      );
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Could not prepare the practical examiner list.",
      });
    } finally {
      stopBusy();
    }
  }

  const theoryReady = Boolean(theory?.result);
  const hallReady = Boolean(hallResult?.assignments.length);
  const practicalReady = Boolean(practicalResult?.schedules.length);

  return (
    <Bento>
      <Tile span={4}>
        <TileHeader
          title="Theory duty order"
          hint="One sheet for each centre. It shows the chief examiner, departmental officer, non-teaching office helpers and all hall invigilators together."
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!theoryReady || !hallReady || busy}
            onClick={() => void exportCentreDutyOrder()}
            className="rounded bg-[var(--color-brand)] px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            {busyKind === "theory" ? "Preparing…" : "Download centre-wise theory duty order"}
          </button>
          <button
            type="button"
            disabled={!theoryReady || busy}
            onClick={() => void exportOfficerReference()}
            className="rounded border border-[var(--color-line)] bg-white px-3 py-2 text-sm disabled:opacity-40"
          >
            {busyKind === "officers" ? "Preparing…" : "Chief and departmental officers only"}
          </button>
        </div>
        {!theoryReady ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Generate the theory duty first.</p>
        ) : !hallReady ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
            Generate hall invigilation too, then download the complete centre duty order.
          </p>
        ) : (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
            A second departmental officer is shown automatically for centres with more than 500 students. Standby teachers appear in the hall list.
          </p>
        )}
        <Link to="/theory" className="mt-3 inline-block text-sm text-[var(--color-brand)] underline">
          Open theory duty
        </Link>
        <span className="px-2 text-[var(--color-ink-muted)]">·</span>
        <Link to="/hall" className="text-sm text-[var(--color-brand)] underline">
          Open hall invigilation
        </Link>
      </Tile>

      <Tile span={2}>
        <TileHeader
          title="Practical examiner list"
          hint="One line for each school and subject, with the number of batches and the internal and external examiners."
        />
        <button
          type="button"
          disabled={!practicalReady || busy}
          onClick={() => void exportPracticalExaminers()}
          className="mt-3 rounded bg-[var(--color-brand)] px-3 py-2 text-sm text-white disabled:opacity-40"
        >
          {busyKind === "practical" ? "Preparing…" : "Download practical examiner list"}
        </button>
        {!practicalReady ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Generate the practical duty first.</p>
        ) : null}
        <Link to="/practical" className="mt-3 block text-sm text-[var(--color-brand)] underline">
          Open practical duty
        </Link>
      </Tile>

      {message ? (
        <Tile span={6}>
          <p className={`text-sm ${message.ok ? "text-[var(--color-ok)]" : "text-[var(--color-err)]"}`}>
            {message.text}
          </p>
        </Tile>
      ) : null}
    </Bento>
  );
}
