import { useMemo, useState } from "react";
import {
  parseCentreChecklist,
  prepareWorkspaceChecklist,
  reviewedWorkspaceCentres,
  type ExamWorkspace,
  type WorkspaceChecklistRow,
} from "@exam-duty/shared";

export function WorkspaceChecklistImport({
  workspace,
  onSave,
  disabled,
}: {
  workspace: ExamWorkspace;
  onSave: (next: ExamWorkspace) => Promise<void>;
  disabled: boolean;
}) {
  const [rows, setRows] = useState<WorkspaceChecklistRow[]>([]);
  const [hosts, setHosts] = useState<Record<string, string>>({});
  const [standard, setStandard] = useState<"10" | "12" | null>(null);
  const [year, setYear] = useState("");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(0);
  const [checked, setChecked] = useState(false);
  const groups = useMemo(
    () => [...new Set(rows.map((r) => r.centreCode))],
    [rows],
  );
  const missing =
    rows.filter((r) => !r.udise || r.studentCount == null).length +
    groups.filter((c) => !hosts[c]).length;
  function prepare(p: ReturnType<typeof parseCentreChecklist>) {
    const next = prepareWorkspaceChecklist(p.rows, workspace.schools);
    setRows(next.rows);
    setHosts(next.hosts);
    setStandard(p.standard);
    setYear(p.academicYear ?? "");
    setErrors(p.errors);
    setPage(0);
    setChecked(false);
  }
  async function upload(file: File) {
    setBusy(true);
    setMessage("Reading centre PDF...");
    try {
      const { readCentrePdf } = await import("../lib/readCentrePdf");
      const parsed = await readCentrePdf(file, setMessage);
      setText(parsed.pages.join("\n\f\n"));
      prepare(parsed);
      setMessage(
        `Read ${parsed.rows.length} linked-school rows. Check the scan and choose any unmatched schools before saving.`,
      );
    } catch (e) {
      setErrors([String(e)]);
    } finally {
      setBusy(false);
    }
  }
  const picker = (
    value: string,
    change: (value: string) => void,
    label: string,
  ) => (
    <select
      className="w-full rounded border bg-white p-2 text-sm"
      aria-label={label}
      value={value}
      onChange={(e) => {
        change(e.target.value);
        setChecked(false);
      }}
    >
      <option value="">Choose full school name</option>
      {workspace.schools.map((s) => (
        <option key={s.udise} value={s.udise}>
          {s.name} ({s.udise})
        </option>
      ))}
    </select>
  );
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="mb-2 text-lg font-semibold text-[#183B4C]">
        Centre strengths from 13A PDF
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        Upload School Master first. The PDF lists each linked school's students;
        the app adds them to obtain the centre strength. PDF school codes and
        UDISE codes are different. Choose a matching school when the names
        differ.
      </p>
      <label className="inline-block cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm">
        Upload centre-strength PDF
        <input
          aria-label="Import 13A PDF"
          type="file"
          accept=".pdf"
          disabled={busy || disabled || !workspace.schools.length}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
      {errors.length > 0 && (
        <div role="alert" className="my-3 text-sm text-red-800">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <p className="my-3 text-sm">
            {standard ?? "Unknown"}th standard, {year || "year not found"}.{" "}
            {groups.length} centres,{" "}
            {rows
              .reduce((n, r) => n + (r.studentCount ?? 0), 0)
              .toLocaleString("en-IN")}{" "}
            students read. {missing} school/count selections still need
            attention.
          </p>
          <div className="space-y-4">
            {groups.slice(page * 3, page * 3 + 3).map((code) => (
              <div key={code} className="rounded-lg border p-3">
                <b className="text-sm">
                  Centre {code}:{" "}
                  {rows.find((r) => r.centreCode === code)!.centreName}
                </b>
                <label className="my-2 block text-sm">
                  Centre school
                  {picker(
                    hosts[code] ?? "",
                    (value) => setHosts((p) => ({ ...p, [code]: value })),
                    `Host school ${code}`,
                  )}
                </label>
                <div className="space-y-3">
                  {rows
                    .map((r, index) => ({ r, index }))
                    .filter(({ r }) => r.centreCode === code)
                    .map(({ r, index }) => (
                      <div
                        key={index}
                        className="grid gap-2 md:grid-cols-[minmax(0,1fr)_110px]"
                      >
                        <div>
                          <p className="text-xs text-slate-600">
                            PDF: {r.sourceSchoolCode} · {r.schoolName}
                          </p>
                          {picker(
                            r.udise,
                            (value) =>
                              setRows((p) =>
                                p.map((v, i) =>
                                  i === index ? { ...v, udise: value } : v,
                                ),
                              ),
                            `Linked school ${code} ${index}`,
                          )}
                        </div>
                        <label className="text-xs">
                          Students
                          <input
                            aria-label={`Students ${code} ${index}`}
                            className="w-full rounded border p-2 text-sm"
                            type="number"
                            min="0"
                            value={r.studentCount ?? ""}
                            onChange={(e) => {
                              setRows((p) =>
                                p.map((v, i) =>
                                  i === index
                                    ? {
                                        ...v,
                                        studentCount:
                                          e.target.value === ""
                                            ? null
                                            : Number(e.target.value),
                                      }
                                    : v,
                                ),
                              );
                              setChecked(false);
                            }}
                          />
                        </label>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <div className="my-3 flex items-center gap-3">
            <button
              className="rounded border p-2 text-sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous centres
            </button>
            <span className="text-sm">
              Page {page + 1} of {Math.ceil(groups.length / 3)}
            </span>
            <button
              className="rounded border p-2 text-sm"
              disabled={(page + 1) * 3 >= groups.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next centres
            </button>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">
              Review or correct text read from the PDF
            </summary>
            <textarea
              aria-label="Centre PDF text"
              className="my-2 h-52 w-full rounded border p-2 text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className="rounded border p-2 text-sm"
              onClick={() => prepare(parseCentreChecklist(text.split("\f")))}
            >
              Read corrected text
            </button>
          </details>
          <label className="my-3 block text-sm">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />{" "}
            I checked the centre names, school links, student counts and
            examination year against the PDF.
          </label>
          <button
            className="rounded-lg bg-[#183B4C] px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={
              disabled ||
              busy ||
              !checked ||
              !!missing ||
              !!errors.length ||
              !standard
            }
            onClick={async () => {
              try {
                const centres = reviewedWorkspaceCentres(
                  rows,
                  hosts,
                  standard!,
                  workspace.schools,
                );
                setBusy(true);
                await onSave({
                  ...workspace,
                  centres: [
                    ...workspace.centres.filter(
                      (c) =>
                        c.standard !== standard ||
                        !centres.some((n) => n.code === c.code),
                    ),
                    ...centres,
                  ],
                });
                setRows([]);
                setMessage(
                  `${centres.length} centres and their student strengths saved for ${standard}th standard.`,
                );
              } catch (e) {
                setErrors([String(e)]);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save reviewed centres
          </button>
        </>
      )}
    </section>
  );
}
