import { useCallback, useEffect, useRef, useState } from "react";
import { autosaveApi, autosaveStatusApi, type ApiRole, type AutosaveMeta } from "./api";

export type AutosaveState =
  | { status: "idle"; latest: AutosaveMeta | null }
  | { status: "saving"; latest: AutosaveMeta | null }
  | { status: "saved"; latest: AutosaveMeta }
  | { status: "unavailable"; latest: AutosaveMeta | null; reason: string };

const DEBOUNCE_MS = 1500;

/**
 * Debounced autosave of the durable snapshot after any tracked mutation.
 * `revision` should change whenever persisted state changes (runs, audit, …).
 * Writes are skipped for roles without master.write.
 */
export function useLocalAutosave(
  role: ApiRole,
  revision: number,
): AutosaveState & { saveNow: () => void } {
  const [state, setState] = useState<AutosaveState>({
    status: "idle",
    latest: null,
  });
  const lastSaved = useRef(-1);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void autosaveStatusApi(role).then((s) => {
      if (cancelled || !s) return;
      setState((prev) =>
        prev.status === "saved" ? prev : { status: "idle", latest: s.latest },
      );
    });
    return () => {
      cancelled = true;
    };
    // Status is read once per role; saves keep it fresh afterwards.
  }, [role]);

  const save = useCallback(
    async (forRevision: number) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState((prev) => ({ status: "saving", latest: prev.latest }));
      const res = await autosaveApi(role);
      inFlight.current = false;
      if (!res) {
        setState((prev) => ({
          status: "unavailable",
          latest: prev.latest,
          reason: "API unreachable",
        }));
        return;
      }
      if (res.error) {
        setState((prev) => ({
          status: "unavailable",
          latest: prev.latest,
          reason: res.error!,
        }));
        return;
      }
      if (res.stored === false || !res.savedAt || !res.checksum) {
        setState((prev) => ({
          status: "unavailable",
          latest: prev.latest,
          reason: res.note ?? "No snapshot store configured",
        }));
        return;
      }
      lastSaved.current = forRevision;
      setState({
        status: "saved",
        latest: {
          savedAt: res.savedAt,
          checksum: res.checksum,
          bytes: res.bytes ?? 0,
          path: res.path ?? "",
          relativePath: res.relativePath ?? "",
        },
      });
    },
    [role],
  );

  useEffect(() => {
    if (revision <= 0 || revision === lastSaved.current) return;
    const t = setTimeout(() => void save(revision), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [revision, save]);

  const saveNow = useCallback(() => void save(revision), [save, revision]);

  return { ...state, saveNow };
}
