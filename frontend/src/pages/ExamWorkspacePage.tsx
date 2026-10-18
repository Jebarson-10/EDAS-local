import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { WorkspaceDashboard } from "../components/WorkspaceDashboard";
import { WorkspaceChecklistImport } from "../components/WorkspaceChecklistImport";
import { WorkspaceManualAssignment } from "../components/WorkspaceManualAssignment";
import { workspaceInputErrors } from "@exam-duty/allocation-engine";
const WorkspaceMap = lazy(() => import("../components/WorkspaceMap"));
import {
  emptyExamWorkspace,
  workspaceSchema,
  workspacePost,
  workspaceSubject,
  WORKSPACE_PRACTICAL_SUBJECTS,
  type ExamWorkspace,
  type WorkspaceRun,
  type WorkspaceStandard,
  type WorkspaceAssignment,
  type WorkspaceImportKind,
} from "@exam-duty/shared";
import {
  downloadFile,
  downloadWorkspaceReport,
  downloadWorkspaceTemplate,
  downloadPracticalSubjects,
  workspaceRoleLabel,
  inputGuide,
  workspaceInputSections,
} from "../lib/workspaceFiles";

const API = import.meta.env.VITE_API_BASE ?? "";
async function request(query = "", body?: unknown) {
  const response = await fetch(`${API}/api/workspaces${query}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(import.meta.env.DEV
        ? { "x-dev-role": "ADMIN", "x-dev-email": "admin@example.local" }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok || data.error)
    throw new Error(data.error ?? "Could not save data. Please retry.");
  return data;
}
type CycleSummary = { id: string; name: string; revision: number };
type Tab =
  | "dashboard"
  | "timetable"
  | "locations"
  | "inputs"
  | "schools"
  | "staff"
  | "exam"
  | "theory"
  | "practical"
  | "rules"
  | "backup";
type Collection =
  | "schools"
  | "staff"
  | "centres"
  | "timetable"
  | "points"
  | "routes"
  | "practical"
  | "history";
type Field = {
  key: string;
  label: string;
  type?: "number" | "date" | "list" | "dates";
  options?: { value: string; label: string }[];
  hint?: string;
  suggestions?: readonly string[];
};
const pretty = (s: string) =>
  s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
const choiceLabels: Record<string, string> = {
  HM_HSS: "Higher secondary Headmaster (12th)",
  HM_HS: "High school Headmaster (10th)",
  HM: "Headmaster",
  PRINCIPAL: "Principal",
  PG: "PG Assistant",
  BT: "BT Assistant",
  PD1: "Physical Director Grade 1",
  PD2: "Physical Director Grade 2",
  VOCATIONAL: "Vocational teacher",
  COMPUTER_INSTRUCTOR: "Computer Instructor",
  DEO: "District Educational Officer",
  JA: "Junior Assistant",
  OA: "Office Assistant",
  RC: "Record Clerk",
  SGT: "Secondary Grade Teacher",
  HIGH: "High school (up to 10th)",
  HIGHER_SECONDARY: "Higher secondary (up to 12th)",
  TEACHING: "Teaching staff",
  NON_TEACHING: "Non-teaching staff",
  GOVERNMENT: "Government",
  AIDED: "Government aided",
  PRIVATE: "Private",
  UNKNOWN: "Needs checking",
  OTHER: "Other",
  CUSTODIAN: "Custodian point",
  COLLECTION: "Collection point",
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
};
const options = (values: string[]) =>
  values.map((value) => ({
    value,
    label: choiceLabels[value] ?? pretty(value),
  }));
const button =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";
const primary = `${button} !border-transparent !bg-[#183B4C] !text-white hover:!bg-[#26556b]`;
const control =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#183B4C]">{title}</h2>
      {children}
    </section>
  );
}

export function ExamWorkspacePage() {
  const [cycles, setCycles] = useState<CycleSummary[]>([]);
  const [workspace, setWorkspace] = useState<ExamWorkspace | null>(null);
  const [runs, setRuns] = useState<WorkspaceRun[]>([]);
  const [standard, setStandard] = useState<WorkspaceStandard>(() =>
    localStorage.getItem("edas-workspace-standard") === "10" ? "10" : "12",
  );
  const [tab, setTab] = useState<Tab>("dashboard");
  const [uploadKind, setUploadKind] = useState<
    WorkspaceImportKind | undefined
  >();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [collection, setCollection] = useState<Collection>("centres");
  const [editing, setEditing] = useState<{
    collection: Collection;
    index: number;
    values: Record<string, unknown>;
  } | null>(null);
  const [selectedRun, setSelectedRun] = useState("");
  const [savedInput, setSavedInput] = useState<{
    runId: string;
    workspace: ExamWorkspace;
  } | null>(null);
  const [help, setHelp] = useState(
    "Import School Master first, then Teacher Master. Add exam-specific inputs using the downloadable template.",
  );
  const currentRef = useRef<ExamWorkspace | null>(null);
  const activeWorker = useRef<Worker | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  function put(next: ExamWorkspace) {
    currentRef.current = next;
    setWorkspace(next);
  }
  async function refreshList() {
    const data = await request();
    setCycles(data.cycles);
    return data.cycles as CycleSummary[];
  }
  async function load(id: string) {
    const data = await request(`?id=${encodeURIComponent(id)}`);
    const saved=workspaceSchema.parse(data.workspace);
    put(saved);
    if(!localStorage.getItem('edas-workspace-standard')&&saved.centres.some(c=>c.standard==='10')&&!saved.centres.some(c=>c.standard==='12'))setStandard('10');
    setRuns(data.runs);
    setSelectedRun("");
    setWarnings([]);
    setPage(0);
    setSearch("");
    localStorage.setItem("edas-current-workspace", id);
    setMessage("Saved cycle loaded.");
  }
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete this action.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await refreshList();
        if (cancelled) return;
        const last = localStorage.getItem("edas-current-workspace");
        if (list.length)
          await load(list.find((c) => c.id === last)?.id ?? list[0]!.id);
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Unable to load saved cycles.",
          );
      }
    })();
    return () => {
      cancelled = true;
      activeWorker.current?.terminate();
    };
  }, []);
  async function save(next: ExamWorkspace, note = "Changes saved.") {
    const parsed = workspaceSchema.parse(next);
    const result = await request("", { action: "save", workspace: parsed });
    put({ ...parsed, revision: result.revision });
    await refreshList();
    setMessage(note);
  }
  async function createCycle() {
    const next = emptyExamWorkspace(
      crypto.randomUUID(),
      `Exam cycle ${new Date().toLocaleDateString("en-IN")}`,
    );
    await save(
      next,
      "New empty cycle created. Import your school and staff data to begin.",
    );
    setRuns([]);
    setWarnings([]);
    setSelectedRun("");
    setTab("inputs");
    setEditing(null);
    localStorage.setItem("edas-current-workspace", next.id);
  }
  function work(input: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("../workers/workspace.worker.ts", import.meta.url),
        { type: "module" },
      );
      activeWorker.current = worker;
      worker.onmessage = (e) => {
        worker.terminate();
        activeWorker.current = null;
        if (e.data.ok) resolve(e.data);
        else reject(new Error(e.data.error));
      };
      worker.onerror = (e) => {
        worker.terminate();
        activeWorker.current = null;
        reject(new Error(e.message || "Allotment could not finish."));
      };
      worker.postMessage(input);
    });
  }
  function chooseUpload(kind?: WorkspaceImportKind) {
    setUploadKind(kind);
    fileInput.current?.click();
  }
  async function importFile(file: File) {
    if (!workspace) throw new Error("Create an exam cycle first.");
    setMessage("Reading workbook and checking rows...");
    const result = await work({
      kind: "import",
      workspace,
      file: await file.arrayBuffer(),
      expectedKind: uploadKind,
    });
    setWarnings(result.warnings ?? []);
    if (result.errors.length)
      throw new Error(
        result.errors.slice(0, 30).join("\n") +
          (result.errors.length > 30
            ? `\n${result.errors.length - 30} more rows need attention.`
            : ""),
      );
    const next: ExamWorkspace = result.workspace;
    next.imports.push({
      name: file.name,
      at: new Date().toISOString(),
      rows: result.count,
    });
    await save(next, `${result.notes.join("; ")}. Saved successfully.`);
  }
  async function generate(module: "THEORY" | "PRACTICAL") {
    if (!workspace) return;
    const latest = new Map<string, WorkspaceRun>();
    for (const run of runs) {
      const key = `${run.standard}|${run.module}`;
      if (!latest.has(key)) latest.set(key, run);
    }
    const other: WorkspaceAssignment[] = [...latest.values()]
      .filter((r) => r.standard !== standard || r.module !== module)
      .flatMap((r) => r.assignments);
    setMessage(`Generating ${standard}th ${module.toLowerCase()} duties...`);
    const seed = crypto.randomUUID();
    const reference = workspace.settings.retainHistory
      ? await request(`?id=${encodeURIComponent(workspace.id)}&history=1`)
      : { history: [] };
    const response = await work({
      kind: "generate",
      workspace: {
        ...workspace,
        history: [...workspace.history, ...reference.history],
      },
      standard,
      module,
      seed,
      other,
    });
    const run: WorkspaceRun = {
      ...response.result,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      published: false,
    };
    if (run.errors.length && !run.assignments.length)
      throw new Error(run.errors.join("\n"));
    await request("", { action: "run", workspaceId: workspace.id, run });
    setRuns((previous) => [run, ...previous]);
    setSelectedRun(run.id);
    setMessage(
      `Duty list saved. ${run.shortages.reduce((n, s) => n + s.missing, 0)} unfilled posts / batches.`,
    );
  }
  const activeModule = tab === "practical" ? "PRACTICAL" : "THEORY";
  const inputIssues = useMemo(
    () =>
      workspace ? workspaceInputErrors(workspace, standard, activeModule) : [],
    [workspace, standard, activeModule],
  );
  const moduleRuns = runs.filter(
    (r) => r.standard === standard && r.module === activeModule,
  );
  const run = moduleRuns.find((r) => r.id === selectedRun) ?? moduleRuns[0];
  const runId = run?.id;
  const workspaceId = workspace?.id;
  useEffect(() => {
    if (!workspaceId || !runId) return;
    let cancelled = false;
    void request(
      `?id=${encodeURIComponent(workspaceId)}&runId=${encodeURIComponent(runId)}`,
    )
      .then((data) => {
        if (!cancelled)
          setSavedInput({
            runId,
            workspace: workspaceSchema.parse(data.workspace),
          });
      })
      .catch((e) => {
        if (!cancelled)
          setError(`Could not load the saved report inputs: ${String(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, runId]);
  const reportInput =
    savedInput?.runId === runId ? savedInput?.workspace : null;
  const reportNames = useMemo(
    () => ({
      staff: new Map(reportInput?.staff.map((t) => [t.staffId, t.name]) ?? []),
      schools: new Map(
        reportInput?.schools.map((s) => [s.udise, s.name]) ?? [],
      ),
    }),
    [reportInput],
  );
  const fields = (kind: Collection): Field[] => {
    const schools =
      workspace?.schools.map((s) => ({
        value: s.udise,
        label: `${s.name} (${s.udise})`,
      })) ?? [];
    const common = [
      {
        key: "udise",
        label: "School",
        options: schools,
        hint: "Choose the school from School Master. UDISE is the school identifier.",
      },
    ];
    switch (kind) {
      case "schools":
        return [
          { key: "udise", label: "UDISE code" },
          { key: "name", label: "School name" },
          { key: "block", label: "Block" },
          { key: "educationalDistrict", label: "Educational district" },
          {
            key: "level",
            label: "School level",
            options: options(["HIGH", "HIGHER_SECONDARY", "OTHER"]),
          },
          {
            key: "management",
            label: "Management",
            options: options(["GOVERNMENT", "AIDED", "PRIVATE", "UNKNOWN"]),
          },
          {
            key: "latitude",
            label: "Latitude",
            type: "number",
            hint: "North-south school position. Import the value from School Master.",
          },
          {
            key: "longitude",
            label: "Longitude",
            type: "number",
            hint: "East-west school position. Used with latitude to check the 10 km radius.",
          },
        ];
      case "staff":
        return [
          {
            key: "staffId",
            label: "Staff ID",
            hint: "Use the Staff ID supplied in Teacher Master so previous duties match correctly.",
          },
          ...common,
          { key: "name", label: "Staff name" },
          {
            key: "post",
            label: "Duty post",
            options: options([
              "HM_HSS",
              "HM_HS",
              "HM",
              "PRINCIPAL",
              "PG",
              "BT",
              "PD1",
              "PD2",
              "VOCATIONAL",
              "COMPUTER_INSTRUCTOR",
              "DEO",
              "JA",
              "OA",
              "RC",
              "SGT",
              "OTHER",
            ]),
          },
          { key: "originalPost", label: "Original designation" },
          {
            key: "category",
            label: "Staff group",
            options: options(["TEACHING", "NON_TEACHING"]),
          },
          { key: "appointedSubject", label: "Appointed subject" },
          {
            key: "handlingSubjects",
            label: "Subjects currently handled",
            type: "list",
            hint: "Separate subjects with semicolons. Science handling and Class 10 are required for 10th practical duty.",
          },
          {
            key: "standards",
            label: "Standards currently taught",
            type: "list",
            hint: "Enter 10;12 when both are handled. Do not mark 10 for a teacher handling only lower classes.",
          },
          { key: "serviceDate", label: "First service date", type: "date" },
          {
            key: "postDate",
            label: "Appointment to present post",
            type: "date",
            hint: "Earlier appointments receive seniority preference. This is Date of present post from Teacher Master.",
          },
        ];
      case "centres":
        return [
          ...common,
          { key: "code", label: "Centre code" },
          { key: "students", label: "Centre student strength", type: "number" },
          {
            key: "clubbedUdise",
            label: "Clubbed school UDISE codes",
            type: "list",
            options: schools,
            hint: "Select every school linked to this centre. Their HMs cannot be allotted here.",
          },
        ];
      case "timetable":
        return [
          { key: "date", label: "Exam date", type: "date" },
          {
            key: "session",
            label: "Session",
            options: options(["MORNING", "AFTERNOON"]),
          },
          { key: "subject", label: "Exam subject" },
          {
            key: "centreCode",
            label: "Centre",
            options: [
              { value: "", label: "All centres" },
              ...(workspace?.centres
                .filter((c) => c.standard === standard)
                .map((c) => ({
                  value: c.code,
                  label: `${c.code} - ${workspace.schools.find((s) => s.udise === c.udise)?.name ?? c.udise}`,
                })) ?? []),
            ],
          },
        ];
      case "points":
        return [
          { key: "id", label: "Point ID" },
          {
            key: "kind",
            label: "Point type",
            options: options(["CUSTODIAN", "COLLECTION"]),
          },
          { key: "name", label: "Point name" },
          ...common,
          {
            key: "centreCodes",
            label: "Centres served",
            type: "list",
            options: workspace?.centres
              .filter((c) => c.standard === standard)
              .map((c) => ({ value: c.code, label: c.code })),
            hint: "Each centre belongs to exactly one custodian point. Add as many collection points as required.",
          },
        ];
      case "routes": {
        const pointId = String(editing?.values.pointId ?? "");
        const point = workspace?.points.find(
          (p) => p.standard === standard && p.id === pointId,
        );
        return [
          { key: "id", label: "Route ID" },
          {
            key: "pointId",
            label: "Custodian point",
            options: workspace?.points
              .filter((p) => p.standard === standard && p.kind === "CUSTODIAN")
              .map((p) => ({ value: p.id, label: p.name })),
          },
          {
            key: "centreCodes",
            label: "Centres to visit",
            type: "list",
            options:
              point?.centreCodes.map((c) => ({ value: c, label: c })) ?? [],
            hint: "Only centres belonging to the selected custodian point appear.",
          },
        ];
      }
      case "practical": {
        const allowed = (editing?.values.allowedCentreUdise as string[]) ?? [];
        return [
          { key: "id", label: "Practical group reference" },
          ...common,
          { key: "subject", label: "Practical subject", suggestions: WORKSPACE_PRACTICAL_SUBJECTS[standard],
            hint: standard === "10" ? "Science is the single SSLC practical paper. Choose a BT Assistant who handles Class 10 Science."
              : "Choose the actual subject offered by the school. The examiner must have the eligible post and matching subject in Teacher Master. You can also type a new authorised subject." },
          { key: "students", label: "Students in this group", type: "number" },
          {
            key: "cohort",
            label: "Student group",
            hint: "Use the same group name for all subjects taken by the same students.",
          },
          {
            key: "allowedCentreUdise",
            label: "Allowed clubbed schools",
            type: "list",
            options: schools,
          },
          {
            key: "centreUdise",
            label: "Receiving school",
            options: schools.filter(
              (s) =>
                s.value === editing?.values.udise || allowed.includes(s.value),
            ),
            hint: "Small groups below 15 must use an allowed nearby receiving school in the same educational district.",
          },
          { key: "halls", label: "Available subject halls", type: "number" },
          {
            key: "dates",
            label: "Available dates",
            type: "dates",
            hint: "Use YYYY-MM-DD dates separated by semicolons. Both morning and afternoon may be used.",
          },
        ];
      }
      case "history":
        return [
          { key: "staffId", label: "Staff ID" },
          {
            key: "centreUdise",
            label: "Previous duty school",
            options: schools,
          },
          { key: "date", label: "Duty date", type: "date" },
          { key: "role", label: "Duty" },
        ];
    }
  };
  const activeCollection: Collection =
    tab === "schools"
      ? "schools"
      : tab === "staff"
        ? "staff"
        : tab === "timetable"
          ? "timetable"
          : collection;
  const entries = workspace
    ? (workspace[activeCollection] as unknown as Record<string, unknown>[])
        .map((value, index) => ({ value, index }))
        .filter(({ value }) => !value.standard || value.standard === standard)
        .filter(
          ({ value }) =>
            !search ||
            Object.values(value)
              .filter((v) => typeof v !== "object")
              .join(" ")
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
    : [];
  function edit(kind: Collection, index = -1) {
    const original =
      index >= 0
        ? (workspace![kind] as unknown as Record<string, unknown>[])[index]!
        : {
            standard,
            raw: {},
            category: "TEACHING",
            level: "HIGHER_SECONDARY",
            management: "UNKNOWN",
            latitude: null,
            longitude: null,
            serviceDate: null,
            postDate: null,
            appointedSubject: "",
            handlingSubjects: [],
            standards: [],
            clubbedUdise: [],
            centreCode: "",
            centreCodes: [],
            allowedCentreUdise: [],
            dates: [],
            session: "MORNING",
            kind: "CUSTODIAN",
          };
    setEditing({ collection: kind, index, values: structuredClone(original) });
  }
  async function saveEdit() {
    if (!workspace || !editing) return;
    const next = structuredClone(workspace);
    const values = { ...editing.values };
    if (editing.collection === "staff") {
      values.post = workspacePost(String(values.post ?? ""));
      values.appointedSubject = workspaceSubject(
        String(values.appointedSubject ?? ""),
      );
      values.handlingSubjects = (values.handlingSubjects as string[]).map(
        workspaceSubject,
      );
    }
    if ("subject" in values)
      values.subject = workspaceSubject(String(values.subject));
    const records = next[editing.collection] as unknown as Record<
      string,
      unknown
    >[];
    if (editing.index < 0) records.push(values);
    else records[editing.index] = values;
    await save(next);
    setEditing(null);
  }
  async function exportRun(chiefs = false) {
    if (!workspace || !run) return;
    const input =
      run.inputRevision === workspace.revision
        ? workspace
        : (
            await request(
              `?id=${encodeURIComponent(workspace.id)}&runId=${encodeURIComponent(run.id)}`,
            )
          ).workspace;
    await downloadWorkspaceReport(input, run, chiefs);
  }
  return (
    <div className="min-h-screen bg-[#f2f5f7] text-slate-800">
      <header className="sticky top-0 z-20 bg-[#183B4C] px-5 py-4 text-white shadow">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">
              Erode Exam Duty · ஈரோடு தேர்வுப் பணி
            </h1>
            <p className="text-xs text-slate-200">
              Schools and staff shared within each exam cycle
            </p>
          </div>
          <div
            className="flex items-center gap-2"
            aria-label="Examination standard"
          >
            {(["10", "12"] as const).map((s) => (
              <button
                key={s}
                className={`rounded-lg px-4 py-2 text-sm ${standard === s ? "bg-white font-bold text-[#183B4C]" : "border border-white/40"}`}
                onClick={() => {
                  setStandard(s);
                  localStorage.setItem("edas-workspace-standard", s);
                  setSelectedRun("");
                  setPage(0);
                }}
              >
                {s}th standard
              </button>
            ))}
          </div>
          <button
            className={button + " text-slate-900"}
            disabled={busy}
            onClick={() => void action(createCycle)}
          >
            + New empty cycle
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="text-sm">
            Exam cycle{" "}
            <select
              aria-label="Exam cycle"
              className="ml-2 rounded border bg-white px-3 py-2"
              value={workspace?.id ?? ""}
              disabled={busy}
              onChange={(e) => void action(() => load(e.target.value))}
            >
              <option value="" disabled>
                Choose a cycle
              </option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {workspace && (
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                const name = prompt("Exam cycle name", workspace.name);
                if (name?.trim())
                  void action(() => save({ ...workspace, name: name.trim() }));
              }}
            >
              Rename
            </button>
          )}
          <span role="status" className="text-sm text-teal-800">
            {busy ? "Working... " : ""}
            {message}
          </span>
        </div>
        {error && (
          <div
            role="alert"
            className="mb-4 whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
            <button className="ml-4 underline" onClick={() => setError("")}>
              Close
            </button>
          </div>
        )}
        {!workspace ? (
          <Panel title="Start a new examination">
            <p className="mb-4">
              Create an empty cycle, then import your School Master and Teacher
              Master files. Each new cycle has its own schools, staff, centres,
              timetable and duty lists.
            </p>
            <button
              className={primary}
              disabled={busy}
              onClick={() => void action(createCycle)}
            >
              Create empty cycle
            </button>
          </Panel>
        ) : (
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx"
              className="hidden"
              aria-label="Import Excel workbook"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void action(() => importFile(file));
              }}
            />
            <nav aria-label="Sections" className="mb-5 flex flex-wrap gap-2">
              {(
                [
                  ["dashboard", "Dashboard"],
                  ["inputs", "Import data"],
                  ["schools", "Schools"],
                  ["staff", "Staff"],
                  ["exam", "Exam details"],
                  ["timetable", "Timetable"],
                  ["locations", "School map"],
                  ["theory", "Theory duties"],
                  ["practical", "Practical duties"],
                  ["rules", "Rule settings"],
                  ["backup", "Backups"],
                ] as [Tab, string][]
              ).map(([id, title]) => (
                <button
                  key={id}
                  className={tab === id ? primary : button}
                  onClick={() => {
                    setTab(id);
                    setPage(0);
                    setSearch("");
                    setEditing(null);
                  }}
                >
                  {title}
                </button>
              ))}
            </nav>
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-5">
                {tab === "dashboard" && (
                  <WorkspaceDashboard
                    workspace={workspace}
                    standard={standard}
                    runs={runs}
                    onNavigate={setTab}
                  />
                )}
                {tab === "locations" && (
                  <Panel title="Schools and centre locations">
                    <Suspense fallback={<p>Opening map...</p>}>
                      <WorkspaceMap workspace={workspace} standard={standard} />
                    </Suspense>
                  </Panel>
                )}
                {tab === "inputs" && (
                  <>
                    <Panel title="Import your data">
                      <p className="mb-4 text-sm">
                        Your School Master and Teacher Master formats are
                        supported directly. For centres, timetables, points,
                        routes, practical groups and past duties, use the input
                        template.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <button
                          className={primary}
                          disabled={busy}
                          onClick={() => chooseUpload()}
                        >
                          Upload combined workbook
                        </button>
                        <button
                          className={button}
                          onClick={() => void action(downloadWorkspaceTemplate)}
                          disabled={busy}
                        >
                          Download input template
                        </button>
                      </div>
                      <p className="mt-3 text-sm text-slate-600">
                        Choose the matching upload below for separate files. The
                        combined option reads every supported sheet in one
                        workbook.
                      </p>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        {workspaceInputSections.map((section) => (
                          <section
                            key={section.kind}
                            className="rounded-lg border border-slate-200 p-4"
                          >
                            <h3 className="font-semibold">{section.title}</h3>
                            <p className="my-2 text-sm text-slate-600">
                              {section.description}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                className={primary}
                                disabled={busy}
                                onClick={() => chooseUpload(section.kind)}
                              >
                                Upload{" "}
                                {section.kind === "Staff"
                                  ? "Teacher Master"
                                  : section.kind === "Schools"
                                    ? "School Master"
                                    : section.kind === "History"
                                      ? "previous duties"
                                      : section.kind.toLowerCase()}
                              </button>
                              <button
                                className={button}
                                disabled={busy}
                                onClick={() =>
                                  void action(() =>
                                    downloadWorkspaceTemplate(section.kind),
                                  )
                                }
                              >
                                Download {section.kind.toLowerCase()} template
                              </button>
                            </div>
                          </section>
                        ))}
                      </div>
                      <div className="mt-5 grid grid-cols-3 gap-3">
                        {[
                          ["Schools", workspace.schools.length],
                          ["Staff", workspace.staff.length],
                          [
                            "Centres",
                            workspace.centres.filter(
                              (c) => c.standard === standard,
                            ).length,
                          ],
                        ].map(([label, value]) => (
                          <div
                            className="rounded-lg bg-slate-50 p-3"
                            key={label}
                          >
                            <span className="block text-xs">{label}</span>
                            <strong className="text-xl">{value}</strong>
                          </div>
                        ))}
                      </div>
                      {warnings.length > 0 && (
                        <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm">
                          <b>Check these source values</b>
                          {warnings.map((w, i) => (
                            <p key={i} className="mt-2">
                              {w}
                            </p>
                          ))}
                        </div>
                      )}
                    </Panel>
                    <Panel title="What is still needed">
                      <div className="space-y-3 text-sm">
                        {inputGuide.slice(0, 14).map(([title, text]) => (
                          <p key={title}>
                            <b>{title}: </b>
                            {text}
                          </p>
                        ))}
                      </div>
                    </Panel>
                    <WorkspaceChecklistImport
                      key={workspace.id}
                      workspace={workspace}
                      disabled={busy}
                      onSave={(next) =>
                        save(next, "Reviewed centre strengths saved.")
                      }
                    />
                    <Panel title="Uploaded files">
                      {workspace.imports.length ? (
                        workspace.imports.map((f, i) => (
                          <p key={i} className="mb-2 text-sm">
                            {f.name} · {f.rows} rows ·{" "}
                            {new Date(f.at).toLocaleString("en-IN")}
                          </p>
                        ))
                      ) : (
                        <p>No files imported in this cycle.</p>
                      )}
                    </Panel>
                  </>
                )}
                {(["schools", "staff", "exam", "timetable"] as Tab[]).includes(
                  tab,
                ) && (
                  <Panel
                    title={
                      tab === "timetable"
                        ? `${standard}th standard timetable`
                        : tab === "exam"
                          ? `${standard}th standard exam details`
                          : tab === "schools"
                            ? "School master"
                            : "Staff master"
                    }
                  >
                    {tab === "exam" && (
                      <label className="mb-4 block text-sm">
                        Details to enter
                        <select
                          className={control + " mt-1"}
                          value={collection}
                          onChange={(e) => {
                            setCollection(e.target.value as Collection);
                            setPage(0);
                          }}
                        >
                          {(
                            [
                              "centres",
                              "timetable",
                              "points",
                              "routes",
                              "practical",
                              "history",
                            ] as Collection[]
                          ).map((c) => (
                            <option key={c} value={c}>
                              {pretty(c)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="mb-4 flex flex-wrap gap-2">
                      <input
                        aria-label="Search records"
                        className={control + " max-w-xs"}
                        placeholder="Search name or code"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(0);
                        }}
                      />
                      <button
                        className={primary}
                        disabled={busy}
                        onClick={() => edit(activeCollection)}
                      >
                        Add record
                      </button>
                      <button
                        className={button}
                        onClick={() =>
                          void action(() =>
                            downloadWorkspaceTemplate(
                              (
                                {
                                  schools: "Schools",
                                  staff: "Staff",
                                  centres: "Centres",
                                  timetable: "Timetable",
                                  points: "Points",
                                  routes: "Routes",
                                  practical: "Practical",
                                  history: "History",
                                } as const
                              )[activeCollection],
                            ),
                          )
                        }
                      >
                        Download template
                      </button>
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() =>
                          chooseUpload(
                            (
                              {
                                schools: "Schools",
                                staff: "Staff",
                                centres: "Centres",
                                timetable: "Timetable",
                                points: "Points",
                                routes: "Routes",
                                practical: "Practical",
                                history: "History",
                              } as const
                            )[activeCollection],
                          )
                        }
                      >
                        Upload{" "}
                        {tab === "schools"
                          ? "School Master"
                          : tab === "staff"
                            ? "Teacher Master"
                            : tab === "timetable"
                              ? "timetable"
                              : "these details"}{" "}
                        in bulk
                      </button>
                    </div>
                    <p className="mb-3 text-sm text-slate-600">
                      {
                        workspaceInputSections.find(
                          (s) =>
                            s.kind ===
                            (
                              {
                                schools: "Schools",
                                staff: "Staff",
                                centres: "Centres",
                                timetable: "Timetable",
                                points: "Points",
                                routes: "Routes",
                                practical: "Practical",
                                history: "History",
                              } as const
                            )[activeCollection],
                        )?.description
                      }{" "}
                      {entries.length} records. Select Edit to update a record.
                      Changes save when you select Save.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-100">
                          <tr>
                            {fields(activeCollection)
                              .slice(0, 5)
                              .map((f) => (
                                <th key={f.key} className="p-2">
                                  {f.label}
                                </th>
                              ))}
                            <th className="p-2">Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entries
                            .slice(page * 20, page * 20 + 20)
                            .map(({ value, index }) => (
                              <tr
                                key={index}
                                className="border-b border-slate-100"
                              >
                                {fields(activeCollection)
                                  .slice(0, 5)
                                  .map((f) => (
                                    <td
                                      key={f.key}
                                      className="max-w-[240px] break-words p-2"
                                    >
                                      {f.key === "udise"
                                        ? `${workspace.schools.find((s) => s.udise === value[f.key])?.name ?? ""} (${String(value[f.key])})`
                                        : Array.isArray(value[f.key])
                                          ? (value[f.key] as string[]).join(
                                              "; ",
                                            )
                                          : String(value[f.key] ?? "")}
                                    </td>
                                  ))}
                                <td className="p-2">
                                  <button
                                    className="text-teal-800 underline"
                                    disabled={busy}
                                    onClick={() =>
                                      edit(activeCollection, index)
                                    }
                                  >
                                    Edit
                                  </button>
                                  {!["schools", "staff", "history"].includes(
                                    activeCollection,
                                  ) && (
                                    <button
                                      className="ml-3 text-red-700 underline"
                                      disabled={busy}
                                      onClick={() => {
                                        if (
                                          confirm(
                                            "Remove this record from the current input? Saved duty lists remain available.",
                                          )
                                        )
                                          void action(async () => {
                                            const next =
                                              structuredClone(workspace);
                                            (
                                              next[
                                                activeCollection
                                              ] as unknown[]
                                            ).splice(index, 1);
                                            await save(
                                              next,
                                              "Record removed from current input.",
                                            );
                                          });
                                      }}
                                    >
                                      Remove
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                      <button
                        className={button}
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Previous
                      </button>
                      <span className="text-sm">
                        Page {page + 1} of{" "}
                        {Math.max(1, Math.ceil(entries.length / 20))}
                      </span>
                      <button
                        className={button}
                        disabled={(page + 1) * 20 >= entries.length}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </Panel>
                )}
                {(tab === "theory" || tab === "practical") && (
                  <>
                    <Panel title={`${standard}th standard ${tab} duties`}>
                      {inputIssues.length > 0 && (
                        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                          <b>Complete these inputs first</b>
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            {inputIssues.slice(0, 10).map((issue, i) => (
                              <li key={i}>{issue}</li>
                            ))}
                          </ul>
                          {inputIssues.length > 10 && (
                            <p className="mt-2">
                              {inputIssues.length - 10} more centre links need
                              attention in Exam details.
                            </p>
                          )}
                          <p className="mt-3">
                            Use Timetable for dates and subjects. Use Exam
                            details for centres, points, routes and practical
                            groups. Each page has an upload button for bulk
                            entry.
                          </p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={primary}
                          disabled={busy}
                          onClick={() =>
                            void action(() => generate(activeModule))
                          }
                          aria-describedby="generation-input-note"
                        >
                          Generate duties
                        </button>
                        <button
                          className={button}
                          disabled={!run || busy}
                          onClick={() => void action(() => exportRun())}
                        >
                          Download duty list
                        </button>
                        {tab === "theory" && (
                          <button
                            className={button}
                            disabled={!run || busy}
                            onClick={() => void action(() => exportRun(true))}
                          >
                            Chief and department only
                          </button>
                        )}
                        {tab === "practical" && <button className={button} disabled={busy} onClick={() => void action(downloadPracticalSubjects)}>Download practical subject list</button>}
                        <button
                          className={button}
                          disabled={
                            !run ||
                            run.published ||
                            busy ||
                            !!run.errors.length ||
                            !!run.shortages.length
                          }
                          onClick={() =>
                            void action(async () => {
                              await request("", {
                                action: "publish",
                                workspaceId: workspace.id,
                                runId: run!.id,
                              });
                              setRuns((prev) =>
                                prev.map((r) =>
                                  r.id === run!.id
                                    ? { ...r, published: true }
                                    : r,
                                ),
                              );
                              setMessage(
                                "Duty list confirmed and kept in history.",
                              );
                            })
                          }
                        >
                          Confirm duty list
                        </button>
                      </div>
                      <p
                        id="generation-input-note"
                        className="mt-3 text-sm text-slate-600"
                      >
                        Downloads are arranged centre-wise. A saved version is
                        kept every time duties are generated. Lists with
                        shortages are marked Draft.
                      </p>
                      {moduleRuns.length > 0 && (
                        <select
                          className={control + " mt-3"}
                          aria-label="Saved duty list"
                          value={run?.id ?? ""}
                          onChange={(e) => setSelectedRun(e.target.value)}
                        >
                          {moduleRuns.map((r) => (
                            <option key={r.id} value={r.id}>
                              {new Date(r.createdAt).toLocaleString("en-IN")}{" "}
                              {r.published ? "Confirmed" : "Draft"}
                            </option>
                          ))}
                        </select>
                      )}
                    </Panel>
                    {run && (
                      <WorkspaceManualAssignment run={run} busy={busy}
                        candidates={async (key) => (await request(`?id=${encodeURIComponent(workspace.id)}&runId=${encodeURIComponent(run.id)}&shortageKey=${encodeURIComponent(key)}`)).candidates}
                        assign={async (choice) => action(async () => {
                          const data = await request("", { action: "assign", workspaceId: workspace.id, runId: run.id, choice });
                          setRuns((previous) => [data.run, ...previous]);
                          setSelectedRun(data.run.id);
                          setMessage("Staff assigned. A new checked list was saved; the original is unchanged.");
                        })} />
                    )}
                    {run && (
                      <Panel
                        title={
                          run.published
                            ? "Confirmed duty list"
                            : "Duty list preview"
                        }
                      >
                        {run.errors.length > 0 && (
                          <div className="mb-3 whitespace-pre-wrap text-sm text-red-700">
                            {run.errors.join("\n")}
                          </div>
                        )}
                        <p className="mb-3 text-sm">
                          {run.assignments.length} duty entries ·{" "}
                          {run.shortages.reduce((n, s) => n + s.missing, 0)}{" "}
                          unfilled posts / batches
                        </p>
                        <div className="max-h-[620px] overflow-auto">
                          <table className="w-full text-left text-sm">
                            <thead className="sticky top-0 bg-slate-100">
                              <tr>
                                {[
                                  "Centre / point",
                                  "Duty",
                                  "Staff",
                                  "Date",
                                  "Session / subject",
                                ].map((h) => (
                                  <th key={h} className="p-2">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {run.assignments
                                .slice()
                                .sort((a, b) =>
                                  a.centreCode.localeCompare(
                                    b.centreCode,
                                    "en",
                                    { numeric: true },
                                  ),
                                )
                                .slice(0, 300)
                                .map((a) => (
                                  <tr
                                    key={a.key}
                                    className="border-b border-slate-100"
                                  >
                                    <td className="p-2">
                                      {a.centreCode ||
                                        reportNames.schools.get(
                                          a.centreUdise,
                                        ) ||
                                        a.centreUdise}
                                    </td>
                                    <td className="p-2">
                                      {workspaceRoleLabel(a.role)}
                                    </td>
                                    <td className="p-2">
                                      {reportNames.staff.get(a.staffId) ??
                                        a.staffId}
                                    </td>
                                    <td className="p-2">{a.date}</td>
                                    <td className="p-2">
                                      {a.session}
                                      <br />
                                      {a.subject}
                                      {a.batch ? ` · Batch ${a.batch}` : ""}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        {run.assignments.length > 300 && (
                          <p className="mt-2 text-sm">
                            Showing the first 300 entries. Download includes
                            every entry.
                          </p>
                        )}
                      </Panel>
                    )}
                  </>
                )}
                {tab === "rules" && (
                  <Panel title="New rule settings">
                    <p className="mb-4 text-sm">
                      Review these settings before the first allotment. Changes
                      are saved with the input for every generated duty list.
                    </p>
                    <div className="space-y-4 text-sm">
                      <p>
                        <b>Location:</b> school-to-duty distance within a 10 km
                        straight-line radius. Missing coordinates keep that
                        person out of the affected duty.
                      </p>
                      <p>
                        <b>Centre staffing:</b> one chief for the whole
                        timetable; one departmental officer, or two above 500
                        students; halls rounded up from students ÷ 20, plus 2
                        extra halls and exactly 3 backups.
                      </p>
                      <p>
                        <b>Seniority:</b> appointment to present post. Chief
                        fallback uses senior PG for 12th and senior BT for 10th.
                        The earlier date is selected first; Staff ID breaks
                        ties.
                      </p>
                      <p>
                        <b>Order:</b> custodians, liaison teams, chiefs,
                        departmental officers, route officers, squad and hall
                        duties. Non-teaching office posts are filled from their
                        own category.
                      </p>
                      <p>
                        <b>Squad:</b> one per eight ordinary halls, rounded up
                        per centre, in the same educational district. For 12th:
                        PD Grade 1, PD Grade 2, first four senior vocational
                        staff across the input district, then PG. For 10th: BT
                        only.
                      </p>
                      <p>
                        <b>Practical:</b> 30 students per batch, a single batch
                        per subject hall, internal from the student's school,
                        same-subject external. A teacher needed as internal is
                        reserved for the whole listed practical day. Private
                        centres require Government / aided externals.
                      </p>
                      <p>
                        <b>History:</b> exclude the previous two calendar years
                        before each duty date. Internal practical examiners stay
                        with their own school. No recent-duty fairness or annual
                        role-switch preference is carried over.
                      </p>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={workspace.settings.languageException}
                          disabled={busy}
                          onChange={(e) =>
                            void action(() =>
                              save({
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  languageException: e.target.checked,
                                  confirmed: false,
                                },
                              }),
                            )
                          }
                        />
                        Allow Tamil and English teachers for their own subject
                        exam
                      </label>
                      <label className="block">
                        12th custodian: District Educational Officer (DEO)
                        <select
                          className={control + " mt-1"}
                          value={workspace.settings.custodianPost12}
                          disabled={busy}
                          onChange={(e) =>
                            void action(() =>
                              save({
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  custodianPost12: e.target.value,
                                  confirmed: false,
                                },
                              }),
                            )
                          }
                        >
                          <option value="">
                            Choose the confirmed DEO post
                          </option>
                          {options(["DEO"]).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        10th practical batch and scheduling rules
                        <select
                          className={control + " mt-1"}
                          value={
                            workspace.settings.practical10SameRules === null
                              ? ""
                              : String(workspace.settings.practical10SameRules)
                          }
                          disabled={busy}
                          onChange={(e) =>
                            void action(() =>
                              save({
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  practical10SameRules:
                                    e.target.value === ""
                                      ? null
                                      : e.target.value === "true",
                                  confirmed: false,
                                },
                              }),
                            )
                          }
                        >
                          <option value="">Choose after confirming</option>
                          <option value="true">
                            Same practical framework; Science-handling BT
                            Assistants only
                          </option>
                          <option value="false">
                            Separate rules are needed - do not generate 10th
                            practicals
                          </option>
                        </select>
                      </label>
                      <label className="block">
                        Previous-cycle history
                        <select
                          className={control + " mt-1"}
                          value={
                            workspace.settings.retainHistory === null
                              ? ""
                              : String(workspace.settings.retainHistory)
                          }
                          disabled={busy}
                          onChange={(e) =>
                            void action(() =>
                              save({
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  retainHistory:
                                    e.target.value === ""
                                      ? null
                                      : e.target.value === "true",
                                  confirmed: false,
                                },
                              }),
                            )
                          }
                        >
                          <option value="">Choose history source</option>
                          <option value="true">
                            Consult other cycles (not used by the confirmed
                            rules)
                          </option>
                          <option value="false">
                            Do not consult previous cycles (confirmed)
                          </option>
                        </select>
                      </label>
                      <button
                        className={primary}
                        disabled={busy}
                        onClick={() =>
                          void action(() =>
                            save(
                              {
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  confirmed: true,
                                },
                              },
                              "Rule settings confirmed and saved.",
                            ),
                          )
                        }
                      >
                        {workspace.settings.confirmed
                          ? "Rules confirmed - save again"
                          : "Confirm these rule settings"}
                      </button>
                    </div>
                  </Panel>
                )}
                {tab === "backup" && (
                  <Panel title="Backup and recovery">
                    <p className="mb-4 text-sm">
                      Download this cycle's complete input and all saved duty
                      lists. Keep the file somewhere safe. It contains personal
                      staff data.
                    </p>
                    <button
                      className={primary}
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const backup = await request(
                            `?id=${encodeURIComponent(workspace.id)}&backup=1`,
                          );
                          downloadFile(
                            `Exam-cycle-${workspace.id}.json`,
                            JSON.stringify(backup, null, 2),
                            "application/json",
                          );
                        })
                      }
                    >
                      Download cycle backup
                    </button>
                    <p className="mb-3 mt-6 text-sm">
                      Restore into a new cycle. Existing cycles are preserved.
                    </p>
                    <input
                      type="file"
                      accept=".json"
                      aria-label="Restore cycle backup"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file)
                          void action(async () => {
                            const backup = JSON.parse(await file.text());
                            if (backup.format !== "EDAS_WORKSPACE_1")
                              throw new Error(
                                "Choose a new-format cycle backup.",
                              );
                            const restored = await request("", {
                              action: "restore",
                              backup,
                            });
                            await refreshList();
                            await load(restored.id);
                            setMessage(
                              "Backup and saved duty lists restored into a new cycle.",
                            );
                          });
                      }}
                    />
                    <p className="mt-6 text-sm">
                      <a href="/reports" className="text-teal-800 underline">
                        View previous-version records
                      </a>
                    </p>
                  </Panel>
                )}
              </div>
              <aside className="space-y-4 xl:sticky xl:top-28">
                <Panel title="Help for this page">
                  <p className="text-sm leading-6">{help}</p>
                  <p className="mt-3 text-sm leading-6">
                    A new cycle starts empty. Switch back using the cycle menu
                    to see an earlier cycle.
                  </p>
                </Panel>
                {run && (tab === "theory" || tab === "practical") && (
                  <Panel title="Shortage summary">
                    <p className="mb-3 text-sm">
                      {run.shortages.length
                        ? "These posts / batches remain unfilled:"
                        : "No shortages in this list."}
                    </p>
                    {Object.entries(
                      run.shortages.reduce(
                        (totals, s) => ({
                          ...totals,
                          [s.role]: (totals[s.role] ?? 0) + s.missing,
                        }),
                        {} as Record<string, number>,
                      ),
                    ).map(([role, n]) => (
                      <p key={role} className="mb-2 text-sm">
                        <b>{workspaceRoleLabel(role)}:</b> {n}
                      </p>
                    ))}
                    <h3 className="mb-2 mt-4 text-sm font-semibold">
                      Why candidates could not be selected
                    </h3>
                    {Object.entries(
                      run.shortages.reduce(
                        (totals, s) => {
                          for (const [reason, n] of Object.entries(s.reasons))
                            totals[reason] = (totals[reason] ?? 0) + n;
                          return totals;
                        },
                        {} as Record<string, number>,
                      ),
                    )
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 12)
                      .map(([reason, n]) => (
                        <p key={reason} className="mb-2 text-sm">
                          {reason}: {n}
                        </p>
                      ))}
                    <p className="mt-3 text-xs text-slate-500">
                      These are rejection counts. The same person can be counted
                      for multiple reasons or vacancies.
                    </p>
                  </Panel>
                )}
              </aside>
            </div>
            {editing && (
              <div
                className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
                role="dialog"
                aria-modal="true"
                aria-label="Edit record"
              >
                <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6">
                  <h2 className="mb-4 text-xl font-semibold">
                    {editing.index < 0 ? "Add" : "Edit"}{" "}
                    {pretty(editing.collection)}
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    {fields(editing.collection).map((f) => (
                      <label
                        key={f.key}
                        className="block text-sm"
                        onMouseEnter={() => setHelp(f.hint ?? f.label)}
                      >
                        {f.label}
                        {f.options ? (
                          <select
                            multiple={f.type === "list"}
                            className={control + " mt-1"}
                            value={
                              f.type === "list"
                                ? ((editing.values[f.key] as string[]) ?? [])
                                : String(editing.values[f.key] ?? "")
                            }
                            onFocus={() => setHelp(f.hint ?? f.label)}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                values: {
                                  ...editing.values,
                                  [f.key]:
                                    f.type === "list"
                                      ? [...e.target.selectedOptions].map(
                                          (o) => o.value,
                                        )
                                      : e.target.value,
                                },
                              })
                            }
                          >
                            {f.type !== "list" &&
                              !f.options.some((o) => o.value === "") && (
                                <option value="">Select</option>
                              )}
                            {!f.options.some(
                              (o) => o.value === editing.values[f.key],
                            ) &&
                              typeof editing.values[f.key] === "string" &&
                              editing.values[f.key] !== "" && (
                                <option value={String(editing.values[f.key])}>
                                  {String(editing.values[f.key])}
                                </option>
                              )}
                            {f.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className={control + " mt-1"}
                            list={f.suggestions ? `workspace-suggestions-${f.key}` : undefined}
                            type={
                              f.type === "date"
                                ? "date"
                                : f.type === "number"
                                  ? "number"
                                  : "text"
                            }
                            step={f.type === "number" ? "any" : undefined}
                            value={
                              Array.isArray(editing.values[f.key])
                                ? (editing.values[f.key] as string[]).join("; ")
                                : String(editing.values[f.key] ?? "")
                            }
                            onFocus={() => setHelp(f.hint ?? f.label)}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                values: {
                                  ...editing.values,
                                  [f.key]:
                                    f.type === "number"
                                      ? e.target.value === ""
                                        ? null
                                        : Number(e.target.value)
                                      : f.type === "list" || f.type === "dates"
                                        ? e.target.value
                                            .split(";")
                                            .map((v) => v.trim())
                                            .filter(Boolean)
                                        : f.type === "date"
                                          ? e.target.value || null
                                          : e.target.value,
                                },
                              })
                            }
                          />
                        )}
                        {f.suggestions && <datalist id={`workspace-suggestions-${f.key}`}>{f.suggestions.map((v) => <option key={v} value={v} />)}</datalist>}
                        {f.hint && (
                          <span className="mt-1 block text-xs leading-5 text-slate-500">
                            {f.hint}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                  <div className="mt-5 flex gap-2">
                    <button
                      className={primary}
                      disabled={busy}
                      onClick={() => void action(saveEdit)}
                    >
                      Save
                    </button>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
