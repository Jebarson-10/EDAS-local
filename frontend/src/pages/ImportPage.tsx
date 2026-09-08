import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../state/AppContext";
import { AppError } from "../lib/errors";
import { PageHeader } from "../components/PageHeader";
import { ErrorBanner, InfoBanner, SuccessBanner } from "../components/Banner";
import { ImportPreview, type ImportPayload } from "../components/ImportPreview";
import { PageHelp } from "../components/PageHelp";
import { EmptyState } from "../components/EmptyState";
import { SearchableSelect } from "../components/SearchableSelect";
import { ImportTemplateCard } from "../components/ImportTemplateCard";
import { useConfirm } from "../components/ConfirmDialog";
import { PageIntro } from "../components/PageIntro";
import { PageSection } from "../components/PageSection";
import { PageShell } from "../components/PageShell";
import { useToast } from "../components/Toast";

export function ImportPage() {
  const { state, dispatch } = useApp();
  const confirm = useConfirm();
  const { success } = useToast();
  const [payload, setPayload] = useState<ImportPayload | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [examCycleId, setExamCycleId] = useState("");
  const [importHistory, setImportHistory] = useState<Array<{ id: string; importedAt: string; fileName: string; recordsImported: number }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lastImportedAt, setLastImportedAt] = useState("");
  const [selectedImportId, setSelectedImportId] = useState("");
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackMessage, setRollbackMessage] = useState("");
  const [rollbackError, setRollbackError] = useState("");

  useEffect(() => {
    void refreshExamCycles();
    void loadImportHistory();
  }, []);

  async function refreshExamCycles() {
    setRefreshing(true);
    try {
      const examCycles = await api.listExamCycles();
      dispatch({ type: "set-exam-cycles", examCycles });
      if (!examCycleId && examCycles.length > 0) {
        setExamCycleId(examCycles[0].id);
      }
    } catch {
      // keep existing exam cycle list
    } finally {
      setRefreshing(false);
    }
  }

  async function loadImportHistory() {
    setHistoryLoading(true);
    try {
      const history = await api.listImportHistory();
      setImportHistory(history);
    } catch {
      setImportHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function onFile(file: File | undefined) {
    if (!file) {
      return;
    }
    setFileName(file.name);
    setError("");
    setSuccessMsg("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as ImportPayload;
        if (!parsed.students || !parsed.subjects || !parsed.rooms) {
          throw new Error("JSON must include students, subjects, and rooms arrays.");
        }
        setPayload(parsed);
      } catch {
        setPayload(null);
        setError("Invalid JSON file. Use a file exported from this app.");
      }
    };
    reader.readAsText(file);
  }

  async function applyImport() {
    if (!payload) {
      return;
    }
    if (!examCycleId) {
      setError("Create an exam cycle first, then select it before importing.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccessMsg("");
    try {
      const result = await api.importDataset({
        examCycleId,
        students: payload.students,
        subjects: payload.subjects,
        rooms: payload.rooms,
        theory: payload.theory,
        practical: payload.practical,
        fileName
      });
      const [students, subjects, rooms, examCycles] = await Promise.all([
        api.listStudents(),
        api.listSubjects(),
        api.listRooms(),
        api.listExamCycles()
      ]);
      dispatch({ type: "set-students", students });
      dispatch({ type: "set-subjects", subjects });
      dispatch({ type: "set-rooms", rooms });
      dispatch({ type: "set-exam-cycles", examCycles });
      setLastImportedAt(result.importedAt);
      setSuccessMsg(
        `Imported ${result.counts.students} students, ${result.counts.subjects} subjects, ${result.counts.rooms} rooms, ${result.counts.theory} theory records, ${result.counts.practical} practical records.`
      );
      success("Import applied.");
      await loadImportHistory();
    } catch (caught) {
      setError(caught instanceof AppError ? caught.message : "Could not import this file.");
    } finally {
      setBusy(false);
    }
  }

  const examCycleOptions = useMemo(
    () =>
      state.examCycles.map((cycle) => ({
        value: cycle.id,
        label: `${cycle.academicYear} / ${cycle.semester} / ${cycle.examName}`
      })),
    [state.examCycles]
  );

  const selectedExamCycle = state.examCycles.find((cycle) => cycle.id === examCycleId);
  const canApply = Boolean(payload) && Boolean(examCycleId) && !busy;

  async function rollbackImport() {
    if (!selectedImportId) {
      setRollbackError("Select an import from history first.");
      return;
    }
    const ok = await confirm({
      title: "Roll back this import?",
      message: "This restores the previous snapshot for the selected import. This cannot be undone.",
      confirmLabel: "Roll back",
      danger: true
    });
    if (!ok) {
      return;
    }
    setRollbackBusy(true);
    setRollbackError("");
    setRollbackMessage("");
    try {
      const result = await api.rollbackImport(selectedImportId);
      const [students, subjects, rooms, examCycles] = await Promise.all([
        api.listStudents(),
        api.listSubjects(),
        api.listRooms(),
        api.listExamCycles()
      ]);
      dispatch({ type: "set-students", students });
      dispatch({ type: "set-subjects", subjects });
      dispatch({ type: "set-rooms", rooms });
      dispatch({ type: "set-exam-cycles", examCycles });
      setRollbackMessage(`Rolled back import. Restored ${result.restoredRecords} records.`);
      success("Import rolled back.");
      await loadImportHistory();
    } catch (caught) {
      setRollbackError(caught instanceof AppError ? caught.message : "Could not roll back this import.");
    } finally {
      setRollbackBusy(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Import"
        subtitle="Upload a JSON file to preview and apply master data plus optional theory/practical records."
        actions={
          <button type="button" className="secondary" onClick={() => void refreshExamCycles()} disabled={refreshing}>
            {refreshing ? "Refreshing\u2026" : "Refresh exam cycles"}
          </button>
        }
      />
      <PageIntro>
        Import is the fastest way to load a complete dataset. Preview first, then apply into a selected exam cycle so you can review before anything is saved.
      </PageIntro>
      <PageHelp>
        Use a JSON file exported from this app. After you apply an import, use Import history to roll back that snapshot if needed.
      </PageHelp>

      <div className="page-grid">
        <PageSection title="Upload JSON">
          <div className="import-layout">
            <div className="card">
              <label>
                Exam cycle
                <SearchableSelect
                  options={examCycleOptions}
                  value={examCycleId}
                  onChange={setExamCycleId}
                  placeholder={state.examCycles.length ? "Select exam cycle" : "No exam cycles yet"}
                  disabled={state.examCycles.length === 0}
                />
              </label>
              {state.examCycles.length === 0 ? (
                <InfoBanner>Create an exam cycle in Exam Cycles before importing.</InfoBanner>
              ) : selectedExamCycle ? (
                <p className="muted">
                  Importing into {selectedExamCycle.academicYear} / {selectedExamCycle.semester} / {selectedExamCycle.examName}.
                </p>
              ) : null}
              <label>
                JSON file
                <input type="file" accept="application/json,.json" onChange={(event) => onFile(event.target.files?.[0])} />
              </label>
              {fileName ? <p className="muted">Selected file: {fileName}</p> : null}
              {lastImportedAt ? <p className="muted">Last applied import: {new Date(lastImportedAt).toLocaleString()}</p> : null}
              {error ? <ErrorBanner>{error}</ErrorBanner> : null}
              {successMsg ? <SuccessBanner>{successMsg}</SuccessBanner> : null}
              <button type="button" onClick={() => void applyImport()} disabled={!canApply}>
                {busy ? "Importing\u2026" : "Apply import"}
              </button>
            </div>
            <div className="card">
              <h3>Template</h3>
              <ImportTemplateCard />
            </div>
          </div>
        </PageSection>

        <PageSection title="Preview">
          {payload ? <ImportPreview payload={payload} /> : <EmptyState title="No file loaded" message="Choose a JSON file to preview students, subjects, rooms, and optional exam records." />}
        </PageSection>

        <PageSection title="Import history">
          {historyLoading ? <p className="muted">Loading import history\u2026</p> : null}
          {rollbackError ? <ErrorBanner>{rollbackError}</ErrorBanner> : null}
          {rollbackMessage ? <SuccessBanner>{rollbackMessage}</SuccessBanner> : null}
          {importHistory.length === 0 && !historyLoading ? (
            <EmptyState title="No imports yet" message="Applied imports will appear here so you can roll back a snapshot if needed." />
          ) : (
            <>
              <div className="toolbar">
                <SearchableSelect
                  options={importHistory.map((item) => ({
                    value: item.id,
                    label: `${item.fileName} \u00b7 ${item.recordsImported} records \u00b7 ${new Date(item.importedAt).toLocaleString()}`
                  }))}
                  value={selectedImportId}
                  onChange={setSelectedImportId}
                  placeholder="Select an import to roll back"
                />
                <button type="button" className="danger" onClick={() => void rollbackImport()} disabled={!selectedImportId || rollbackBusy}>
                  {rollbackBusy ? "Rolling back\u2026" : "Roll back selected import"}
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Imported</th>
                      <th>Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importHistory.map((item) => (
                      <tr key={item.id}>
                        <td>{item.fileName}</td>
                        <td>{new Date(item.importedAt).toLocaleString()}</td>
                        <td>{item.recordsImported}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </PageSection>
      </div>
    </PageShell>
  );
}
