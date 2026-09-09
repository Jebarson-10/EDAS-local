import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_RULE_PARAMETERS,
  EMPTY_HYDRATE_REPORT,
  allocationRunReasonsFromFetch,
  allocationRunResultsFromFetch,
  allocationRunsToHydrate,
  latestRunForModuleInCycle,
  publishableSiblingRun,
  runsForExamCycle,
  applyStoredRuleParameters,
  applyTeacherImport,
  assertMutable,
  shouldApplySessionAfterApi,
  shouldApplySessionAfterApis,
  buildHydrateReport,
  canTransition,
  classifyHydrateList,
  labelForRuleVersion,
  pickAuthoritativeList,
  createAmendmentDescriptor,
  pickHydrateExamCycle,
  createId,
  type ExamCycleStatus,
  type HydrateOutcome,
  type HydrateReport,
  type ImportPreviewSummary,
  type RuleParameters,
  type Role,
  conflictsFromPersistedReasons,
  feasibleFromPersistedSummary,
  findPersistedResultForPracticalSchedule,
  hallAssignmentsFromPersistedResults,
  hallShortagesFromPersisted,
  issuesFromPersisted,
  practicalBatchesFromPersistedResults,
  practicalIdentityFromDecisionTrace,
  practicalSchedulesFromPersistedResults,
  practicalSubjectFromBatchOrTrace,
  theoryShortagesFromPersisted,
  validCountFromPersistedSummary,
  roleSwitchAppliedForSchedule,
  roleSwitchAppliedFromPersisted,
  theoryAssignmentsFromPersistedResults,
  type TeacherDesignationHistoryRow,
  type TeacherExemption,
  type TeacherLocationHistoryRow,
  type TeacherSchoolHistoryRow,
  type SessionCode,
  type ExamTimetableEntry,
  type DataQuality,
} from "@exam-duty/shared";
import type {
  HallResult,
  PracticalResult,
  TheoryAllocationResult,
} from "@exam-duty/allocation-engine";
import type { ValidationResult } from "@exam-duty/validator";
import { loadDemoDataset, type DemoDataset } from "../data/demoStore";
import { autosaveApi } from "../lib/api";

export interface AuditEntry {
  id: string;
  action: string;
  timestamp: string;
  detail: string;
  reason?: string;
}

export type ModuleResult =
  TheoryAllocationResult | PracticalResult | HallResult;

export interface AllocationRunRecord {
  runId: string;
  examCycleId: string;
  module: "THEORY" | "PRACTICAL" | "HALL";
  createdAt: string;
  algorithmVersion: string;
  validationStatus: string;
  result: ModuleResult | null;
  validation: ValidationResult | null;
  publishedIntoHistory?: boolean;
}

export function isTheoryRun(
  r: AllocationRunRecord,
): r is AllocationRunRecord & {
  module: "THEORY";
  result: TheoryAllocationResult;
} {
  return r.module === "THEORY" && !!r.result && "assignments" in r.result;
}

export interface ExamCycleState {
  examCycleId: string;
  name: string;
  academicYear: string;
  status: ExamCycleStatus;
  ruleVersionId: string;
  ruleVersionLabel: string;
  amendedFromId?: string;
  /** Officer-configured examination window; null until they set it. */
  startDate: string | null;
  endDate: string | null;
}

interface AppState {
  role: Role;
  setRole: (r: Role) => void;
  locale: "en" | "ta";
  setLocale: (locale: "en" | "ta") => void;
  tamilFont: "unicode" | "bamini" | "vanavil" | "tace16";
  setTamilFont: (font: "unicode" | "bamini" | "vanavil" | "tace16") => void;
  dataset: DemoDataset | null;
  setDataset: (d: DemoDataset) => void;
  loading: boolean;
  rules: RuleParameters;
  hydrateReport: HydrateReport;
  hydrateReady: boolean;
  runs: AllocationRunRecord[];
  addRun: (run: AllocationRunRecord) => void;
  updateRun: (runId: string, patch: Partial<AllocationRunRecord>) => void;
  audit: AuditEntry[];
  logAudit: (action: string, detail: string, reason?: string) => void;
  examCycle: ExamCycleState;
  examCycleName: string;
  schoolHistory: TeacherSchoolHistoryRow[];
  designationHistory: TeacherDesignationHistoryRow[];
  /** Display/audit only — not fed into allocation engines (OQ-001 / OQ-004). */
  locationHistory: TeacherLocationHistoryRow[];
  setLocationHistory: (rows: TeacherLocationHistoryRow[]) => void;
  exemptions: TeacherExemption[];
  setExemptions: (rows: TeacherExemption[]) => void;
  applyImportPreview: (
    preview: ImportPreviewSummary,
    opts?: {
      missingAction?: "leave" | "deactivate";
      importId?: string;
      rows?: Array<{
        rowNumber: number;
        status:
          | "NEW"
          | "UPDATED"
          | "UNCHANGED"
          | "INVALID"
          | "DUPLICATE"
          | "MISSING";
        entityKey?: string;
        message?: string;
      }>;
    },
  ) => Promise<
    | {
        ok: true;
        message: string;
        teachers: DemoDataset["teachers"];
        schoolHistory: TeacherSchoolHistoryRow[];
        designationHistory: TeacherDesignationHistoryRow[];
      }
    | { ok: false; error: string }
  >;
  transitionExamCycle: (
    to: ExamCycleStatus,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  setExamWindow: (
    startDate: string | null,
    endDate: string | null,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  timetable: ExamTimetableEntry[];
  timetableState: "loading" | "ready" | "failed";
  saveTimetable: (
    entries: ExamTimetableEntry[],
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  setActiveRuleVersion: (
    ruleVersionId: string,
    label: string,
  ) => Promise<void>;
  publishLatestTheoryRun: () => Promise<
    | { ok: true; message: string; publishedRunIds?: string[] }
    | { ok: false; error: string }
  >;
  createAmendment: (
    reason: string,
  ) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  practicalBatchDemand: Array<{
    schoolCode: string;
    subject: string;
    batchCount: number;
  }> | null;
  setPracticalBatchDemand: (
    rows: Array<{
      schoolCode: string;
      subject: string;
      batchCount: number;
    }> | null,
  ) => void;
}

const Ctx = createContext<AppState | null>(null);

const INITIAL_CYCLE: ExamCycleState = {
  examCycleId: "ec_2027_hsc",
  name: "New 12th Standard Examination",
  academicYear: "2027",
  status: "OPEN",
  ruleVersionId: "rv-2027-1",
  ruleVersionLabel: "2027.1",
  startDate: null,
  endDate: null,
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("ADMIN");
  const [locale, setLocale] = useState<"en" | "ta">(
    () => (localStorage.getItem("edas-locale") === "ta" ? "ta" : "en"),
  );
  const [tamilFont, setTamilFont] = useState<"unicode" | "bamini" | "vanavil" | "tace16">(
    () => (localStorage.getItem("edas-tamil-font") as "unicode" | "bamini" | "vanavil" | "tace16") || "unicode",
  );
  const [dataset, setDataset] = useState<DemoDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<AllocationRunRecord[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [examCycle, setExamCycle] = useState<ExamCycleState>(INITIAL_CYCLE);
  const examCycleIdRef = useRef(INITIAL_CYCLE.examCycleId);
  const [practicalBatchDemand, setPracticalBatchDemand] = useState<Array<{
    schoolCode: string;
    subject: string;
    batchCount: number;
  }> | null>(null);
  const [exemptions, setExemptions] = useState<TeacherExemption[]>([]);
  const [schoolHistory, setSchoolHistory] = useState<TeacherSchoolHistoryRow[]>(
    [],
  );
  const [designationHistory, setDesignationHistory] = useState<
    TeacherDesignationHistoryRow[]
  >([]);
  const [locationHistory, setLocationHistory] = useState<
    TeacherLocationHistoryRow[]
  >([]);
  const [rules, setRules] = useState<RuleParameters>(DEFAULT_RULE_PARAMETERS);
  const [timetable, setTimetable] = useState<ExamTimetableEntry[]>([]);
  const [timetableState, setTimetableState] = useState<"loading" | "ready" | "failed">("loading");
  const [hydrateReport, setHydrateReport] =
    useState<HydrateReport>(EMPTY_HYDRATE_REPORT);
  const [hydrateReady, setHydrateReady] = useState(false);

  useEffect(() => {
    document.documentElement.lang = locale === "ta" ? "ta" : "en";
    document.documentElement.dataset.tamilFont = tamilFont;
    localStorage.setItem("edas-locale", locale);
    localStorage.setItem("edas-tamil-font", tamilFont);
  }, [locale, tamilFont]);

  // The desktop API snapshots its canonical SQLite state after changes. A
  // short debounce coalesces a form edit that updates several React states.
  useEffect(() => {
    if (!hydrateReady || role === "VIEWER") return;
    const timer = window.setTimeout(() => {
      void autosaveApi(role);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [
    audit,
    dataset,
    designationHistory,
    examCycle,
    exemptions,
    hydrateReady,
    locationHistory,
    role,
    rules,
    runs,
    schoolHistory,
    timetable,
  ]);

  const logAudit = useCallback(
    (action: string, detail: string, reason?: string) => {
      setAudit((prev) => [
        {
          id: `a_${crypto.randomUUID()}`,
          action,
          timestamp: new Date().toISOString(),
          detail,
          reason,
        },
        ...prev,
      ]);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await loadDemoDataset();
      if (!cancelled) {
        setDataset(data);
        setLoading(false);
        setAudit([
          {
            id: "a0",
            action: "LOGIN",
            timestamp: new Date().toISOString(),
            detail: "Local operator session",
          },
        ]);
      }
      const sources: Record<string, HydrateOutcome> = {};
      try {
        const api = await import("../lib/api");
        const [cycles, versions] = await Promise.all([
          api.fetchExamCycles("OFFICER"),
          api.fetchRuleVersions("OFFICER"),
        ]);
        // Empty GET keeps INITIAL_CYCLE (first-boot). A miss is failed —
        // generate must refuse so the session placeholder is not persisted
        // as if D1 returned that cycle. Leftover published ec_2027_hsc
        // must not win over a DRAFT/OPEN amendment after full reload.
        sources.exam_cycles = classifyHydrateList(cycles, cycles?.cycles);
        const preferred = pickHydrateExamCycle(
          cycles?.cycles,
          INITIAL_CYCLE.examCycleId,
        );
        let cycleId = INITIAL_CYCLE.examCycleId;
        let cycleRuleVersionId = INITIAL_CYCLE.ruleVersionId;
        if (!cancelled && preferred) {
          cycleId = String(preferred.exam_cycle_id);
          cycleRuleVersionId = String(
            preferred.rule_version_id ?? INITIAL_CYCLE.ruleVersionId,
          );
          examCycleIdRef.current = cycleId;
          setExamCycle((prev) => ({
            ...prev,
            examCycleId: cycleId,
            name: String(preferred.name ?? prev.name),
            academicYear: String(preferred.academic_year ?? prev.academicYear),
            status:
              (preferred.status as ExamCycleState["status"]) ?? prev.status,
            ruleVersionId: cycleRuleVersionId,
            ruleVersionLabel: labelForRuleVersion(
              versions?.versions ?? [],
              cycleRuleVersionId,
              INITIAL_CYCLE.ruleVersionLabel,
            ),
            startDate: preferred.start_date
              ? String(preferred.start_date)
              : null,
            endDate: preferred.end_date ? String(preferred.end_date) : null,
            amendedFromId: preferred.amended_from_id
              ? String(preferred.amended_from_id)
              : prev.amendedFromId,
          }));
        }

        const [
          hist,
          ex,
          teachersApi,
          schoolsApi,
          centres,
          rels,
          runsApi,
          schoolHistApi,
          desigHistApi,
          locHistApi,
          auditApi,
          blocksApi,
          subjectsApi,
          timetableApi,
        ] = await Promise.all([
          api.fetchDutyHistory("OFFICER"),
          api.fetchExemptions("OFFICER"),
          api.fetchMasterTeachers("OFFICER"),
          api.fetchMasterSchools("OFFICER"),
          api.fetchMasterCentres("OFFICER"),
          api.fetchMasterRelationships("OFFICER"),
          api.fetchAllocationRuns("OFFICER", cycleId),
          api.fetchTeacherSchoolHistory("OFFICER"),
          api.fetchTeacherDesignationHistory("OFFICER"),
          api.fetchTeacherLocationHistory("OFFICER"),
          api.fetchAudit("OFFICER"),
          api.fetchMasterBlocks("OFFICER"),
          api.fetchMasterSubjects("OFFICER"),
          api.fetchExamTimetable("OFFICER", cycleId),
        ]);

        if (cancelled) return;

        sources.duty_history = classifyHydrateList(hist, hist?.history);
        sources.exemptions = classifyHydrateList(ex, ex?.exemptions);
        sources.teachers = classifyHydrateList(
          teachersApi,
          teachersApi?.teachers,
        );
        sources.schools = classifyHydrateList(schoolsApi, schoolsApi?.schools);
        sources.centres = classifyHydrateList(centres, centres?.centres);
        sources.relationships = classifyHydrateList(
          rels,
          rels?.relationships,
        );
        sources.allocation_runs = classifyHydrateList(runsApi, runsApi?.runs);
        sources.teacher_school_history = classifyHydrateList(
          schoolHistApi,
          schoolHistApi?.rows,
        );
        sources.teacher_designation_history = classifyHydrateList(
          desigHistApi,
          desigHistApi?.rows,
        );
        sources.teacher_location_history = classifyHydrateList(
          locHistApi,
          locHistApi?.rows,
        );
        sources.audit = classifyHydrateList(auditApi, auditApi?.entries);
        sources.blocks = classifyHydrateList(blocksApi, blocksApi?.blocks);
        sources.subjects = classifyHydrateList(
          subjectsApi,
          subjectsApi?.subjects,
        );
        if (timetableApi == null) {
          setTimetableState("failed");
        } else {
          setTimetable(
            (timetableApi.entries ?? []).map((entry) => ({
              timetableEntryId: String(entry.timetable_entry_id ?? ""),
              examDate: String(entry.exam_date ?? ""),
              sessionCode: entry.session_code ?? "MORNING",
              subjectLabel: String(entry.subject_label ?? ""),
              requiresChief: entry.requires_chief !== 0,
              requiresHall: entry.requires_hall !== 0,
              notes: entry.notes ?? null,
            })),
          );
          setTimetableState("ready");
        }

        const paramsApi = await api.fetchRuleParameters(
          "OFFICER",
          cycleRuleVersionId,
        );
        sources.rule_parameters = classifyHydrateList(
          paramsApi,
          paramsApi?.parameters,
        );
        // Overlay stored rows only after GET returned a list. A miss leaves
        // DEFAULT_RULE_PARAMETERS in session — generate must refuse until
        // rule_parameters is ok/empty so seed defaults are not persisted as
        // the cycle's catalog.
        if (paramsApi?.parameters?.length) {
          const applied = applyStoredRuleParameters(paramsApi.parameters);
          if (!cancelled) setRules(applied.parameters);
        }

        if (auditApi?.entries?.length) {
          setAudit((prev) => {
            const mapped = auditApi.entries.map((e) => ({
              id: e.audit_id,
              action: e.action,
              timestamp: e.timestamp,
              detail: [e.entity, e.entity_id, e.new_value]
                .filter(Boolean)
                .join(" · "),
              reason: e.reason ?? undefined,
            }));
            const ids = new Set(mapped.map((m) => m.id));
            return [...mapped, ...prev.filter((p) => !ids.has(p.id))];
          });
        }

        if (schoolHistApi?.rows?.length) {
          setSchoolHistory(
            schoolHistApi.rows.map((r) => ({
              id: r.id,
              teacherId: r.teacher_id,
              schoolId: r.school_id,
              effectiveFrom: r.effective_from,
              effectiveTo: r.effective_to,
              sourceImportId: r.source_import_id ?? "",
              createdAt: r.created_at,
            })),
          );
        }
        if (desigHistApi?.rows?.length) {
          setDesignationHistory(
            desigHistApi.rows.map((r) => ({
              id: r.id,
              teacherId: r.teacher_id,
              designation: r.designation,
              effectiveFrom: r.effective_from,
              effectiveTo: r.effective_to,
              sourceImportId: r.source_import_id ?? "",
              createdAt: r.created_at,
            })),
          );
        }
        if (locHistApi?.rows?.length) {
          setLocationHistory(
            locHistApi.rows.map((r) => ({
              id: r.id,
              teacherId: r.teacher_id,
              locationType: r.location_type,
              latitude: r.latitude,
              longitude: r.longitude,
              effectiveFrom: r.effective_from,
              effectiveTo: r.effective_to,
              sourceImportId: r.source_import_id ?? "",
              createdAt: r.created_at,
            })),
          );
        }

        if (ex?.exemptions) {
          setExemptions(
            ex.exemptions.map((e) => ({
              id: e.id,
              teacherId: e.teacher_id,
              isExempted: e.is_exempted === 1,
              reason: e.reason,
              effectiveFrom: e.effective_from,
              effectiveTo: e.effective_to ?? null,
            })),
          );
        }

        setDataset((prev) => {
          if (!prev) return prev;
          let next = { ...prev };
          const mappedHistory = (hist?.history ?? []).map((h) => ({
            teacherId: h.teacher_id,
            centreId: h.centre_id ?? null,
            dutyTypeCode: h.duty_type_code,
            roleCode: h.role_code ?? null,
            examDate: h.exam_date,
            sessionCode: h.session_code as SessionCode,
            academicYear: h.academic_year,
            dataQuality: "Confirmed" as const,
          }));
          // Miss keeps the session seed. Generate must refuse until
          // duty_history / teachers / schools are ok or empty (first-boot).
          const history = pickAuthoritativeList(
            sources.duty_history ?? "failed",
            next.history,
            mappedHistory,
          );
          if ((sources.duty_history ?? "failed") !== "failed") {
            next = {
              ...next,
              history,
              meta: {
                ...next.meta,
                counts: { ...next.meta.counts, history: history.length },
                note: `${next.meta.note} · history hydrated from API (${history.length})`,
              },
            };
          }
          const prevTeachersById = new Map(
            next.teachers.map((t) => [t.teacherId, t]),
          );
          const mappedTeachers = (teachersApi?.teachers ?? []).map((t) => {
            const prior = prevTeachersById.get(String(t.teacher_id));
            const dq = (t.data_quality ??
              prior?.dataQuality ??
              "Imported") as DataQuality;
            return {
              teacherId: String(t.teacher_id),
              employeeCode: String(t.employee_code),
              name: String(t.name),
              schoolId: String(t.school_id),
              designation: String(t.designation),
              subject: t.subject ?? prior?.subject ?? null,
              seniorityRank: t.seniority_rank ?? prior?.seniorityRank ?? null,
              joiningDate: t.joining_date ?? prior?.joiningDate ?? null,
              homeLatitude:
                typeof t.home_latitude === "number"
                  ? t.home_latitude
                  : (prior?.homeLatitude ?? null),
              homeLongitude:
                typeof t.home_longitude === "number"
                  ? t.home_longitude
                  : (prior?.homeLongitude ?? null),
              isActive: t.is_active !== 0,
              dataQuality: dq,
              blockId: prior?.blockId,
            };
          });
          const teachers = pickAuthoritativeList(
            sources.teachers ?? "failed",
            next.teachers,
            mappedTeachers,
          );
          if ((sources.teachers ?? "failed") !== "failed") {
            next = {
              ...next,
              teachers,
              meta: {
                ...next.meta,
                counts: { ...next.meta.counts, teachers: teachers.length },
                note: `${next.meta.note} · teachers hydrated from API (${teachers.length})`,
              },
            };
          }
          const prevSchoolsById = new Map(
            next.schools.map((s) => [s.schoolId, s]),
          );
          const mappedSchools = (schoolsApi?.schools ?? []).map((s) => {
            const prior = prevSchoolsById.get(String(s.school_id));
            return {
              schoolId: String(s.school_id),
              schoolCode: String(s.school_code),
              schoolName: String(s.school_name),
              blockId: String(s.block_id || prior?.blockId || "blk_restored"),
              latitude:
                typeof s.latitude === "number"
                  ? s.latitude
                  : (prior?.latitude ?? 0),
              longitude:
                typeof s.longitude === "number"
                  ? s.longitude
                  : (prior?.longitude ?? 0),
              active: s.active !== 0,
            };
          });
          const schools = pickAuthoritativeList(
            sources.schools ?? "failed",
            next.schools,
            mappedSchools,
          );
          if ((sources.schools ?? "failed") !== "failed") {
            next = {
              ...next,
              schools,
              meta: {
                ...next.meta,
                counts: { ...next.meta.counts, schools: schools.length },
                note: `${next.meta.note} · schools hydrated from API (${schools.length})`,
              },
            };
          }
          const prevCentresById = new Map(
            next.centres.map((c) => [c.centreId, c]),
          );
          const mappedCentres = (centres?.centres ?? []).map((c) => {
            const id = String(c.centre_id);
            const prior = prevCentresById.get(id);
            return {
              centreId: id,
              centreCode: String(c.centre_code ?? prior?.centreCode ?? id),
              centreName: String(c.centre_name ?? prior?.centreName ?? id),
              blockId: String(c.block_id || prior?.blockId || "blk_restored"),
              latitude:
                typeof c.latitude === "number"
                  ? c.latitude
                  : (prior?.latitude ?? 0),
              longitude:
                typeof c.longitude === "number"
                  ? c.longitude
                  : (prior?.longitude ?? 0),
              capacity:
                typeof c.capacity === "number" ? c.capacity : prior?.capacity,
              active: c.active !== 0,
            };
          });
          const nextCentres = pickAuthoritativeList(
            sources.centres ?? "failed",
            next.centres,
            mappedCentres,
          );
          if ((sources.centres ?? "failed") !== "failed") {
            next = {
              ...next,
              centres: nextCentres,
              meta: {
                ...next.meta,
                counts: { ...next.meta.counts, centres: nextCentres.length },
                note: `${next.meta.note} · centres hydrated from API (${nextCentres.length})`,
              },
            };
          }
          const mappedRels = (rels?.relationships ?? []).map((r) => ({
            centreId: String(r.centre_id),
            schoolId: String(r.school_id),
            relationshipType: (r.relationship_type === "CLUBBED"
              ? "CLUBBED"
              : "HOST") as "HOST" | "CLUBBED",
            effectiveFrom: String(r.effective_from ?? "2020-01-01"),
            effectiveTo: r.effective_to ?? null,
          }));
          const relationships = pickAuthoritativeList(
            sources.relationships ?? "failed",
            next.relationships,
            mappedRels,
          );
          if ((sources.relationships ?? "failed") !== "failed") {
            next = {
              ...next,
              relationships,
              meta: {
                ...next.meta,
                counts: {
                  ...next.meta.counts,
                  relationships: relationships.length,
                },
              },
            };
          }
          const mappedBlocks = (blocksApi?.blocks ?? []).map((b) => ({
            blockId: String(b.block_id),
            blockCode: String(b.block_code),
            blockName: String(b.block_name),
          }));
          const blocks = pickAuthoritativeList(
            sources.blocks ?? "failed",
            next.blocks,
            mappedBlocks,
          );
          if ((sources.blocks ?? "failed") !== "failed") {
            next = {
              ...next,
              blocks,
              meta: {
                ...next.meta,
                counts: { ...next.meta.counts, blocks: blocks.length },
                note: `${next.meta.note} · blocks hydrated from API (${blocks.length})`,
              },
            };
          }
          const mappedSubjects = (subjectsApi?.subjects ?? []).map((s) => ({
            subjectId: String(s.subject_id),
            code: String(s.code),
            name: String(s.name),
            isPractical: s.is_practical !== 0,
            active: s.active !== 0,
          }));
          const subjects = pickAuthoritativeList(
            sources.subjects ?? "failed",
            next.subjects ?? [],
            mappedSubjects,
          );
          if ((sources.subjects ?? "failed") !== "failed") {
            next = {
              ...next,
              subjects,
              meta: {
                ...next.meta,
                counts: { ...next.meta.counts, subjects: subjects.length },
                note: `${next.meta.note} · subjects hydrated from API (${subjects.length})`,
              },
            };
          }
          return next;
        });

        if (runsApi?.runs?.length) {
          const hydrated: AllocationRunRecord[] = [];
          const cycleIdForPractical =
            cycleId ??
            runsApi.runs.find((r) => r.module === "PRACTICAL")?.exam_cycle_id;
          const practicalApi = cycleIdForPractical
            ? await api.fetchPracticalBatchesApi("OFFICER", cycleIdForPractical)
            : null;
          const schedulesByRun = new Map<
            string,
            NonNullable<typeof practicalApi>["schedules"]
          >();
          const batchesByCycle = practicalApi?.batches ?? [];
          for (const sch of practicalApi?.schedules ?? []) {
            const rid = sch.run_id ?? "";
            if (!rid) continue;
            const list = schedulesByRun.get(rid) ?? [];
            list.push(sch);
            schedulesByRun.set(rid, list);
          }

          const codesByTeacherId = new Map(
            (teachersApi?.teachers ?? []).map((t) => [
              String(t.teacher_id),
              String(t.employee_code),
            ]),
          );

          let resultsMissed = false;
          for (const r of allocationRunsToHydrate(runsApi.runs)) {
            if (
              r.module !== "THEORY" &&
              r.module !== "PRACTICAL" &&
              r.module !== "HALL"
            ) {
              continue;
            }
            const [detail, reasonsApi] = await Promise.all([
              api.fetchAllocationRunResults("OFFICER", r.run_id),
              api.fetchAllocationRunReasons("OFFICER", r.run_id),
            ]);
            const loaded = allocationRunResultsFromFetch(detail);
            const loadedReasons = allocationRunReasonsFromFetch(reasonsApi);
            if (loaded.missed || loadedReasons.missed) {
              // A results or reasons GET miss is not an empty persist — do
              // not invent 0 assignments / 0 Validation issues for a listed
              // run, and do not treat the catalog as usable for generate /
              // cross-module calendar.
              resultsMissed = true;
              continue;
            }
            const rows = loaded.results;
            const persistedReasons = loadedReasons.reasons;
            const persistedConflicts = conflictsFromPersistedReasons(
              persistedReasons,
            );
            const persistedIssues = issuesFromPersisted(
              r.summary_json,
              persistedReasons,
            );
            const persistedValid = validCountFromPersistedSummary(
              r.summary_json,
            );
            const validationStub: ValidationResult = {
              status:
                (r.validation_status as ValidationResult["status"]) ??
                "PENDING",
              assignments: rows.length,
              ...(persistedValid !== undefined ? { valid: persistedValid } : {}),
              warnings: persistedIssues.filter((i) => i.severity === "WARNING")
                .length,
              errors: persistedIssues.filter((i) => i.severity === "ERROR")
                .length,
              issues: persistedIssues,
              conflicts: persistedConflicts,
            };

            if (r.module === "THEORY") {
              const assignments = theoryAssignmentsFromPersistedResults(
                rows,
                codesByTeacherId,
              );
              hydrated.push({
                runId: r.run_id,
                examCycleId: String(r.exam_cycle_id ?? cycleId),
                module: "THEORY",
                createdAt: r.created_at,
                algorithmVersion: r.algorithm_version,
                validationStatus: r.validation_status ?? "PENDING",
                publishedIntoHistory: r.status === "PUBLISHED",
                validation: validationStub,
                result: {
                  algorithmVersion: r.algorithm_version,
                  assignments,
                  shortages: theoryShortagesFromPersisted(
                    r.summary_json,
                    persistedReasons,
                  ),
                  candidateMatrixSize: 0,
                  feasible: feasibleFromPersistedSummary(
                    r.summary_json,
                    assignments.length,
                  ),
                },
              });
              continue;
            }

            if (r.module === "HALL") {
              const assignments = hallAssignmentsFromPersistedResults(
                rows,
                codesByTeacherId,
              );
              hydrated.push({
                runId: r.run_id,
                examCycleId: String(r.exam_cycle_id ?? cycleId),
                module: "HALL",
                createdAt: r.created_at,
                algorithmVersion: r.algorithm_version,
                validationStatus: r.validation_status ?? "PENDING",
                publishedIntoHistory: r.status === "PUBLISHED",
                validation: validationStub,
                result: {
                  algorithmVersion: r.algorithm_version,
                  requiredHallsByCentre: {},
                  standbyByCentre: {},
                  assignments,
                  shortages: hallShortagesFromPersisted(
                    r.summary_json,
                    persistedReasons,
                  ),
                  feasible: feasibleFromPersistedSummary(
                    r.summary_json,
                    assignments.length,
                  ),
                } satisfies HallResult,
              });
              continue;
            }

            // PRACTICAL — prefer schedules from practical_batches API;
            // when those rows are missing after restore, hydrate identity
            // from persisted result traces (do not invent UNK / demand).
            const runSchedules = schedulesByRun.get(r.run_id) ?? [];
            const schedules =
              runSchedules.length > 0
                ? runSchedules.map((s) => {
                    const batch = batchesByCycle.find(
                      (b) => b.batch_id === s.batch_id,
                    );
                    const persistedRow = findPersistedResultForPracticalSchedule(
                      rows,
                      {
                        batchId: s.batch_id,
                        examDate: s.exam_date,
                        internalExaminerId: s.internal_examiner_id,
                      },
                    );
                    const identity = practicalIdentityFromDecisionTrace(
                      persistedRow?.decision_trace_json,
                    );
                    const schoolId =
                      batch?.school_id ?? identity.schoolId ?? "";
                    return {
                      batchKey: s.batch_id,
                      schoolId,
                      subjectId: practicalSubjectFromBatchOrTrace(
                        batch,
                        identity.subjectId,
                      ),
                      examDate: s.exam_date,
                      sessionCode: s.session_code as SessionCode,
                      internalExaminerId: s.internal_examiner_id,
                      externalExaminerId: s.external_examiner_id,
                      roleSwitchApplied: persistedRow
                        ? roleSwitchAppliedFromPersisted(persistedRow)
                        : roleSwitchAppliedForSchedule(rows, {
                            schoolId,
                            examDate: s.exam_date,
                            internalExaminerId: s.internal_examiner_id,
                          }),
                      decisionNotes: identity.decisionNotes,
                    };
                  })
                : practicalSchedulesFromPersistedResults(rows);
            const batchRows =
              runSchedules.length > 0 && batchesByCycle.length > 0
                ? batchesByCycle
                    .filter((b) =>
                      runSchedules.some((s) => s.batch_id === b.batch_id),
                    )
                    .map((b) => ({
                      batchKey: b.batch_id,
                      schoolId: b.school_id,
                      subjectId: b.subject_code ?? b.subject_id ?? "",
                      batchIndex: b.batch_index,
                      studentCount: b.student_count,
                    }))
                : practicalBatchesFromPersistedResults(rows);
            hydrated.push({
              runId: r.run_id,
              examCycleId: String(r.exam_cycle_id ?? cycleId),
              module: "PRACTICAL",
              createdAt: r.created_at,
              algorithmVersion: r.algorithm_version,
              validationStatus: r.validation_status ?? "PENDING",
              publishedIntoHistory: r.status === "PUBLISHED",
              validation: {
                ...validationStub,
                assignments: schedules.length,
              },
              result: {
                algorithmVersion: r.algorithm_version,
                batches: batchRows,
                schedules,
                feasible: feasibleFromPersistedSummary(
                  r.summary_json,
                  schedules.length,
                ),
                message: "Hydrated from API",
              } satisfies PracticalResult,
            });
          }
          if (resultsMissed) {
            sources.allocation_runs = "failed";
          }
          if (!cancelled && hydrated.length) {
            setRuns((prev) => {
              const ids = new Set(prev.map((p) => p.runId));
              const openCycleId = examCycleIdRef.current;
              return [
                ...prev,
                ...hydrated.filter(
                  (h) =>
                    !ids.has(h.runId) && h.examCycleId === openCycleId,
                ),
              ];
            });
          }
        }
      } catch {
        for (const key of [
          "exam_cycles",
          "duty_history",
          "exemptions",
          "teachers",
          "schools",
          "centres",
          "relationships",
          "allocation_runs",
          "teacher_school_history",
          "teacher_designation_history",
          "teacher_location_history",
          "audit",
          "rule_parameters",
          "blocks",
          "subjects",
        ]) {
          if (!(key in sources)) sources[key] = "failed";
        }
      }
      if (!cancelled) {
        setHydrateReport(buildHydrateReport(sources));
        setHydrateReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addRun = useCallback(
    (run: AllocationRunRecord) => {
      const gate = assertMutable(examCycle.status, "generate allocation");
      if (!gate.ok) {
        logAudit("GENERATE_ALLOCATION", gate.error);
        return;
      }
      setRuns((prev) => [run, ...prev]);
      if (examCycle.status === "OPEN") {
        setExamCycle((c) => ({ ...c, status: "ALLOCATION_GENERATED" }));
      }
    },
    [examCycle.status, logAudit],
  );

  const updateRun = useCallback(
    (runId: string, patch: Partial<AllocationRunRecord>) => {
      setRuns((prev) =>
        prev.map((r) => (r.runId === runId ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  const applyImportPreview = useCallback(
    async (
      preview: ImportPreviewSummary,
      opts?: {
        missingAction?: "leave" | "deactivate";
        importId?: string;
        rows?: Array<{
          rowNumber: number;
          status:
            | "NEW"
            | "UPDATED"
            | "UNCHANGED"
            | "INVALID"
            | "DUPLICATE"
            | "MISSING";
          entityKey?: string;
          message?: string;
        }>;
      },
    ) => {
      if (!dataset) return { ok: false as const, error: "Dataset not loaded" };
      if (role === "VIEWER") {
        return { ok: false as const, error: "VIEWER cannot apply imports" };
      }
      const gate = assertMutable(examCycle.status, "apply import");
      if (!gate.ok) {
        return { ok: false as const, error: gate.error };
      }
      const importId = opts?.importId;
      const asOf = new Date().toISOString().slice(0, 10);
      const applied = applyTeacherImport({
        preview,
        teachers: dataset.teachers,
        schools: dataset.schools.map((s) => ({
          schoolId: s.schoolId,
          schoolCode: s.schoolCode,
        })),
        importId,
        asOfDate: asOf,
        missingAction: opts?.missingAction ?? "leave",
      });
      const { applyImportApi } = await import("../lib/api");
      const api = await applyImportApi(
        role,
        applied.teachers,
        importId,
        {
          schoolHistory: applied.schoolHistory,
          designationHistory: applied.designationHistory,
        },
        opts?.rows,
        examCycle.examCycleId,
      );
      const decision = shouldApplySessionAfterApi(api);
      if (!decision.apply) {
        return { ok: false as const, error: decision.error };
      }
      setDataset({
        ...dataset,
        teachers: applied.teachers,
        meta: {
          ...dataset.meta,
          counts: {
            ...dataset.meta.counts,
            teachers: applied.teachers.length,
          },
        },
      });
      setSchoolHistory((h) => [...applied.schoolHistory, ...h]);
      setDesignationHistory((h) => [...applied.designationHistory, ...h]);
      const message = `Applied import ${importId ?? "(no archive)"}: +${applied.appliedNew} ~${applied.appliedUpdated} deactivated=${applied.deactivated}${
        api?.ok
          ? ` · API ok${api.importRows != null ? `, row outcomes=${api.importRows}` : ""}`
          : ""
      }`;
      logAudit("IMPORT", message);
      return {
        ok: true as const,
        message,
        teachers: applied.teachers,
        schoolHistory: applied.schoolHistory,
        designationHistory: applied.designationHistory,
      };
    },
    [dataset, role, examCycle.status, examCycle.examCycleId, logAudit],
  );

  const transitionExamCycle = useCallback(
    async (to: ExamCycleStatus) => {
      if (role !== "ADMIN" && role !== "OFFICER") {
        return { ok: false as const, error: "Insufficient role" };
      }
      if (!canTransition(examCycle.status, to)) {
        return {
          ok: false as const,
          error: `Illegal transition ${examCycle.status} → ${to}`,
        };
      }
      const { updateExamCycleStatusApi } = await import("../lib/api");
      const api = await updateExamCycleStatusApi(
        role,
        examCycle.examCycleId,
        to,
      );
      const decision = shouldApplySessionAfterApi(api);
      if (!decision.apply) {
        return { ok: false as const, error: decision.error };
      }
      const from = examCycle.status;
      setExamCycle((c) => ({ ...c, status: to }));
      logAudit("UPDATE", `Exam cycle status ${from} → ${to}`);
      return { ok: true as const };
    },
    [examCycle.status, examCycle.examCycleId, role, logAudit],
  );

  const setExamWindow = useCallback(
    async (startDate: string | null, endDate: string | null) => {
      if (role !== "ADMIN" && role !== "OFFICER") {
        return { ok: false as const, error: "Insufficient role" };
      }
      if (startDate && endDate && endDate < startDate) {
        return {
          ok: false as const,
          error: "End date must not precede the start date",
        };
      }
      const { setExamCycleWindowApi } = await import("../lib/api");
      const api = await setExamCycleWindowApi(role, examCycle.examCycleId, {
        startDate,
        endDate,
      });
      if (!api?.ok) {
        return {
          ok: false as const,
          error: api?.error ?? "Could not save the examination window",
        };
      }
      setExamCycle((c) => ({ ...c, startDate, endDate }));
      logAudit(
        "UPDATE",
        `Exam window set to ${startDate ?? "—"} → ${endDate ?? "—"}`,
      );
      return { ok: true as const };
    },
    [examCycle.examCycleId, role, logAudit],
  );

  const saveTimetable = useCallback(
    async (entries: ExamTimetableEntry[]) => {
      if (role !== "ADMIN" && role !== "OFFICER") {
        return { ok: false as const, error: "Insufficient access" };
      }
      const { replaceExamTimetableApi } = await import("../lib/api");
      const api = await replaceExamTimetableApi(role, examCycle.examCycleId, entries);
      if (!api?.ok) {
        return { ok: false as const, error: api?.error ?? "Could not save the timetable" };
      }
      const saved = (api.entries ?? []).map((entry) => ({
        timetableEntryId: String(entry.timetable_entry_id ?? ""),
        examDate: String(entry.exam_date ?? ""),
        sessionCode: entry.session_code ?? "MORNING",
        subjectLabel: String(entry.subject_label ?? ""),
        requiresChief: entry.requires_chief !== 0,
        requiresHall: entry.requires_hall !== 0,
        notes: entry.notes ?? null,
      }));
      setTimetable(saved);
      setTimetableState("ready");
      logAudit("UPDATE", `Saved timetable (${saved.length} session(s))`);
      return { ok: true as const };
    },
    [examCycle.examCycleId, role, logAudit],
  );

  const setActiveRuleVersion = useCallback(
    async (_ruleVersionId: string, _label: string) => {
      // Activate flips rule_versions.is_active only. Do not rewrite the
      // session cycle label — exam_cycles.rule_version_id is unchanged.
      const { fetchRuleParameters } = await import("../lib/api");
      const paramsApi = await fetchRuleParameters(
        role,
        examCycle.ruleVersionId,
      );
      if (paramsApi?.parameters?.length) {
        setRules(applyStoredRuleParameters(paramsApi.parameters).parameters);
        setHydrateReport((prev) =>
          buildHydrateReport({
            ...prev.sources,
            rule_parameters: "ok",
          }),
        );
        return;
      }
      setHydrateReport((prev) =>
        buildHydrateReport({
          ...prev.sources,
          rule_parameters: paramsApi == null ? "failed" : "empty",
        }),
      );
    },
    [role, examCycle.ruleVersionId],
  );

  const publishLatestTheoryRun = useCallback(async () => {
    if (role !== "ADMIN" && role !== "OFFICER") {
      return { ok: false as const, error: "Insufficient role" };
    }
    if (isFrozen(examCycle.status)) {
      return {
        ok: false as const,
        error: `Cycle already ${examCycle.status} — create an amendment to correct`,
      };
    }
    const cycleRuns = runsForExamCycle(runs, examCycle.examCycleId);
    const latest = latestRunForModuleInCycle(
      cycleRuns,
      "THEORY",
      examCycle.examCycleId,
    );
    if (!latest || !isTheoryRun(latest) || !latest.validation) {
      return { ok: false as const, error: "No theory run to publish" };
    }
    if (latest.validation.status === "INVALID") {
      return {
        ok: false as const,
        error: `Theory run ${latest.runId} is INVALID — regenerate theory on this cycle before publishing`,
      };
    }
    if (!dataset) return { ok: false as const, error: "No dataset" };

    const allowed: ExamCycleStatus[] = [
      "ALLOCATION_GENERATED",
      "UNDER_REVIEW",
      "APPROVED",
    ];
    if (!allowed.includes(examCycle.status)) {
      return {
        ok: false as const,
        error: `Cannot publish from status ${examCycle.status}`,
      };
    }

    const practicalPick = publishableSiblingRun(
      latestRunForModuleInCycle(
        cycleRuns,
        "PRACTICAL",
        examCycle.examCycleId,
      ),
    );
    const hallPick = publishableSiblingRun(
      latestRunForModuleInCycle(cycleRuns, "HALL", examCycle.examCycleId),
    );
    const practical = practicalPick.publish;
    const hall = hallPick.publish;
    const omittedInvalid = [practicalPick.omitted, hallPick.omitted].filter(
      (row): row is string => Boolean(row),
    );

    type HistRow = {
      teacherId: string;
      centreId: string | null;
      dutyTypeCode: string;
      examDate: string;
      sessionCode: SessionCode;
      academicYear: string;
      dataQuality: "Confirmed";
    };
    const historyRows: HistRow[] = latest.result.assignments.map((a) => ({
      teacherId: a.teacherId,
      centreId: a.centreId,
      dutyTypeCode: a.roleCode,
      examDate: a.examDate,
      sessionCode: a.sessionCode,
      academicYear: examCycle.academicYear,
      dataQuality: "Confirmed" as const,
    }));

    const practicalResult = practical?.result as
      | {
          schedules?: Array<{
            internalExaminerId: string;
            externalExaminerId: string;
            schoolId: string;
            examDate: string;
            sessionCode: SessionCode;
          }>;
        }
      | null
      | undefined;
    if (practicalResult?.schedules?.length) {
      for (const s of practicalResult.schedules) {
        historyRows.push({
          teacherId: s.internalExaminerId,
          centreId: s.schoolId,
          dutyTypeCode: "PRACTICAL_INTERNAL",
          examDate: s.examDate,
          sessionCode: s.sessionCode,
          academicYear: examCycle.academicYear,
          dataQuality: "Confirmed",
        });
        historyRows.push({
          teacherId: s.externalExaminerId,
          centreId: s.schoolId,
          dutyTypeCode: "PRACTICAL_EXTERNAL",
          examDate: s.examDate,
          sessionCode: s.sessionCode,
          academicYear: examCycle.academicYear,
          dataQuality: "Confirmed",
        });
      }
    }

    const hallResult = hall?.result as
      | {
          assignments?: Array<{
            teacherId: string;
            centreId: string;
            roleCode: string;
            examDate: string;
            sessionCode: SessionCode;
          }>;
        }
      | null
      | undefined;
    if (hallResult?.assignments?.length) {
      for (const a of hallResult.assignments) {
        historyRows.push({
          teacherId: a.teacherId,
          centreId: a.centreId,
          dutyTypeCode: a.roleCode,
          examDate: a.examDate,
          sessionCode: a.sessionCode,
          academicYear: examCycle.academicYear,
          dataQuality: "Confirmed",
        });
      }
    }

    const publishIds = [latest.runId];
    if (practical?.result) publishIds.push(practical.runId);
    if (hall?.result) publishIds.push(hall.runId);

    const { publishRunApi } = await import("../lib/api");
    let publishedTotal = 0;
    let lastError: string | undefined;
    const publishResults: Array<{
      ok?: boolean;
      published?: number;
      error?: string;
    } | null> = [];
    for (const runId of publishIds) {
      const api = await publishRunApi(
        role,
        runId,
        examCycle.examCycleId,
        examCycle.academicYear,
      );
      publishResults.push(api);
      if (api?.ok) {
        publishedTotal += api.published ?? 0;
      } else if (api?.error) {
        lastError = api.error;
      }
    }
    const decision = shouldApplySessionAfterApis(publishResults);
    if (!decision.apply) {
      return {
        ok: false as const,
        error: lastError ?? decision.error,
      };
    }
    const reachedApi = !decision.offline;

    setDataset({
      ...dataset,
      history: [...historyRows, ...dataset.history],
      meta: {
        ...dataset.meta,
        counts: {
          ...dataset.meta.counts,
          history: dataset.history.length + historyRows.length,
        },
      },
    });
    setRuns((prev) =>
      prev.map((r) =>
        publishIds.includes(r.runId) ? { ...r, publishedIntoHistory: true } : r,
      ),
    );
    setExamCycle((c) => ({ ...c, status: "PUBLISHED" }));
    logAudit("APPROVE", `Approved theory run ${latest.runId}`);
    logAudit(
      "PUBLISH",
      `Published theory${practical ? "+practical" : ""}${hall ? "+hall" : ""} into duty history (${historyRows.length} rows)${
        omittedInvalid.length
          ? `; omitted leftover INVALID ${omittedInvalid.join(", ")}`
          : ""
      }`,
    );
    logAudit("BACKUP", "Archival backup trigger (local marker after publish)");
    return {
      ok: true as const,
      message: `Published ${historyRows.length} history rows (theory${practical?.result ? "+practical" : ""}${hall?.result ? "+hall" : ""}); cycle PUBLISHED${
        reachedApi ? ` · API published ${publishedTotal} history rows` : ""
      }${
        omittedInvalid.length
          ? ` · omitted leftover INVALID ${omittedInvalid.join(", ")}`
          : ""
      }`,
      publishedRunIds: publishIds,
    };
  }, [role, runs, dataset, examCycle, logAudit]);

  const createAmendment = useCallback(
    async (reason: string) => {
      if (role !== "ADMIN" && role !== "OFFICER") {
        return { ok: false as const, error: "Insufficient role" };
      }
      if (
        examCycle.status !== "PUBLISHED" &&
        examCycle.status !== "LOCKED" &&
        examCycle.status !== "ARCHIVED"
      ) {
        return {
          ok: false as const,
          error: "Amendments only from PUBLISHED/LOCKED/ARCHIVED",
        };
      }
      try {
        const newId = createId("ec");
        const amd = createAmendmentDescriptor(
          examCycle.examCycleId,
          newId,
          reason,
        );
        const { createExamCycleApi } = await import("../lib/api");
        const api = await createExamCycleApi(role, {
          examCycleId: newId,
          name: `${INITIAL_CYCLE.name} — amendment`,
          academicYear: examCycle.academicYear,
          ruleVersionId: examCycle.ruleVersionId,
          status: "DRAFT",
          startDate: examCycle.startDate ?? undefined,
          endDate: examCycle.endDate ?? undefined,
          amendedFromId: examCycle.examCycleId,
          amendmentReason: reason,
        });
        const decision = shouldApplySessionAfterApi(api);
        if (!decision.apply) {
          return { ok: false as const, error: decision.error };
        }
        examCycleIdRef.current = amd.newCycleId;
        setExamCycle({
          examCycleId: amd.newCycleId,
          name: `${INITIAL_CYCLE.name} — amendment`,
          academicYear: examCycle.academicYear,
          status: "DRAFT",
          ruleVersionId: examCycle.ruleVersionId,
          ruleVersionLabel: examCycle.ruleVersionLabel,
          amendedFromId: examCycle.examCycleId,
          // An amendment corrects the same examination, so it inherits its window.
          startDate: examCycle.startDate,
          endDate: examCycle.endDate,
        });
        setRuns([]);
        logAudit("CREATE", `Amendment cycle ${newId}`, reason);
        return {
          ok: true as const,
          message: `Created amendment ${newId} from ${examCycle.examCycleId}`,
        };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : "Amendment failed",
        };
      }
    },
    [role, examCycle, logAudit],
  );

  const value = useMemo<AppState>(
    () => ({
      role,
      setRole,
      locale,
      setLocale,
      tamilFont,
      setTamilFont,
      dataset,
      setDataset: (d) => setDataset(d),
      loading,
      rules,
      hydrateReport,
      hydrateReady,
      runs,
      addRun,
      updateRun,
      audit,
      logAudit,
      examCycle,
      examCycleName: examCycle.name,
      schoolHistory,
      designationHistory,
      locationHistory,
      setLocationHistory,
      exemptions,
      setExemptions,
      applyImportPreview,
      transitionExamCycle,
      setExamWindow,
      timetable,
      timetableState,
      saveTimetable,
      setActiveRuleVersion,
      publishLatestTheoryRun,
      createAmendment,
      practicalBatchDemand,
      setPracticalBatchDemand,
    }),
    [
      role,
      locale,
      tamilFont,
      dataset,
      loading,
      rules,
      hydrateReport,
      hydrateReady,
      runs,
      addRun,
      updateRun,
      audit,
      logAudit,
      examCycle,
      schoolHistory,
      designationHistory,
      locationHistory,
      exemptions,
      applyImportPreview,
      transitionExamCycle,
      setExamWindow,
      timetable,
      timetableState,
      saveTimetable,
      setActiveRuleVersion,
      publishLatestTheoryRun,
      createAmendment,
      practicalBatchDemand,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function isFrozen(status: ExamCycleStatus): boolean {
  return status === "PUBLISHED" || status === "LOCKED" || status === "ARCHIVED";
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}
