/** Browser client for Worker / local API. Falls back gracefully if API is down. */
import { isLoadableBackupPayload } from "@exam-duty/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export type ApiRole = "ADMIN" | "OFFICER" | "DATA_OPERATOR" | "VIEWER";

/**
 * Dev-only identity headers. Production builds omit them so Access claims
 * are authoritative (OQ-010). Staging/production Workers refuse X-Dev-* spoof.
 */
function headers(role: ApiRole, extra?: HeadersInit): HeadersInit {
  const base: Record<string, string> = {
    "content-type": "application/json",
  };
  if (import.meta.env.DEV) {
    base["x-dev-role"] = role;
    base["x-dev-email"] = `${role.toLowerCase()}@example.local`;
  }
  return { ...base, ...extra };
}

export async function apiHealth(): Promise<{
  ok: boolean;
  dbOk?: boolean;
  r2Ok?: boolean | null;
  storage?: string;
  environment?: string;
  counts?: Record<string, number>;
  accessRoleMapConfigured?: boolean;
  accessRoleMapEntries?: number;
  dbError?: string;
  r2Error?: string;
  note?: string;
} | null> {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok && res.status !== 503) return null;
    return (await res.json()) as {
      ok: boolean;
      dbOk?: boolean;
      r2Ok?: boolean | null;
      storage?: string;
      environment?: string;
      counts?: Record<string, number>;
      accessRoleMapConfigured?: boolean;
      accessRoleMapEntries?: number;
      dbError?: string;
      r2Error?: string;
      note?: string;
    };
  } catch {
    return null;
  }
}

export async function persistRun(
  role: ApiRole,
  body: Record<string, unknown>,
): Promise<{ accepted?: boolean; error?: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/allocation-runs`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify(body),
    });
    return (await res.json()) as { accepted?: boolean; error?: string };
  } catch {
    return null;
  }
}

export async function publishRunApi(
  role: ApiRole,
  runId: string,
  examCycleId: string,
  academicYear: string,
): Promise<{ ok?: boolean; published?: number; error?: string } | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/allocation-runs/${runId}/publish`,
      {
        method: "POST",
        headers: headers(role),
        body: JSON.stringify({ examCycleId, academicYear }),
      },
    );
    return (await res.json()) as {
      ok?: boolean;
      published?: number;
      error?: string;
    };
  } catch {
    return null;
  }
}

export async function backupApi(
  role: ApiRole,
  payload: unknown,
  reason: string,
  opts?: { fromServer?: boolean },
): Promise<{
  backupId?: string;
  checksum?: string;
  fromServer?: boolean;
  stored?: boolean;
  payload?: Record<string, unknown>;
  note?: string;
  error?: string;
} | null> {
  try {
    const res = await fetch(`${API_BASE}/api/backups`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify({
        payload: opts?.fromServer ? undefined : payload,
        reason,
        fromServer: opts?.fromServer ?? false,
      }),
    });
    return (await res.json()) as {
      backupId?: string;
      checksum?: string;
      fromServer?: boolean;
      stored?: boolean;
      payload?: Record<string, unknown>;
      note?: string;
      error?: string;
    };
  } catch {
    return null;
  }
}

/** Ask the local desktop API to retain a canonical SQLite crash snapshot. */
export async function autosaveApi(
  role: ApiRole,
): Promise<{ ok?: boolean; savedAt?: string; error?: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/autosave`, {
      method: "POST",
      headers: headers(role),
    });
    return (await res.json()) as { ok?: boolean; savedAt?: string; error?: string };
  } catch {
    return null;
  }
}

export async function fetchManualOverrides(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/manual-overrides`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      overrides: Array<{
        override_id: string;
        run_id: string;
        result_id: string;
        changed_by: string;
        changed_at: string;
        reason: string;
        old_value: string;
        new_value: string;
        module?: string | null;
        centre_id?: string | null;
        role_code?: string | null;
        exam_date?: string | null;
        session_code?: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchExportRecords(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/exports`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      exports: Array<{
        export_id: string;
        created_at: string;
        created_by?: string | null;
        export_type: string;
        exam_cycle_id?: string | null;
        run_id?: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchSourceImports(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/imports`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      imports: Array<{
        import_id: string;
        filename: string;
        file_hash?: string | null;
        uploaded_by?: string | null;
        uploaded_at: string;
        row_count?: number | null;
        status?: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function listBackupsApi(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/backups`, {
      headers: headers(role),
    });
    if (!res.ok) {
      return (await res.json()) as { error?: string; backups?: undefined };
    }
    return (await res.json()) as {
      backups: Array<{
        backup_id: string;
        created_at: string;
        created_by?: string | null;
        trigger_reason?: string | null;
        checksum?: string | null;
        status?: string;
        r2_key?: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchBackupPayload(
  role: ApiRole,
  backupId: string,
): Promise<{ payload?: unknown; checksum?: string; error?: string } | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/backups/${encodeURIComponent(backupId)}`,
      { headers: headers(role) },
    );
    const body: unknown = await res.json();
    if (!res.ok) {
      const err =
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : `Backup GET ${res.status}`;
      return { error: err };
    }
    if (!isLoadableBackupPayload(body)) {
      const nested =
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : "Backup payload is not a canonical snapshot";
      return { error: nested };
    }
    const checksum = res.headers.get("x-backup-checksum") ?? undefined;
    return { payload: body, checksum };
  } catch {
    return null;
  }
}

export async function restoreApi(
  role: ApiRole,
  payload: unknown,
  opts: { includeHistory?: boolean; expectedChecksum?: string },
): Promise<{
  ok?: boolean;
  counts?: Record<string, number>;
  error?: string;
} | null> {
  if (!isLoadableBackupPayload(payload)) {
    return {
      ok: false,
      error:
        "Backup payload is not a canonical snapshot — needs teachers, schools, and centres arrays",
    };
  }
  try {
    const res = await fetch(`${API_BASE}/api/restore`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify({
        payload,
        adminConfirmed: true,
        includeHistory: opts.includeHistory ?? false,
        expectedChecksum: opts.expectedChecksum,
      }),
    });
    return (await res.json()) as {
      ok?: boolean;
      counts?: Record<string, number>;
      error?: string;
    };
  } catch {
    return null;
  }
}

export async function fetchExamCycles(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/exam-cycles`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      cycles: Array<{
        exam_cycle_id: string;
        name?: string;
        academic_year?: string;
        status?: string;
        rule_version_id?: string;
        start_date?: string | null;
        end_date?: string | null;
        amended_from_id?: string | null;
        amendment_reason?: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function uploadImportApi(
  role: ApiRole,
  file: File,
  opts?: { rowCount?: number },
) {
  try {
    const buf = await file.arrayBuffer();
    const res = await fetch(`${API_BASE}/api/imports`, {
      method: "POST",
      headers: {
        ...headers(role),
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": file.name,
        ...(opts?.rowCount != null
          ? { "X-Row-Count": String(opts.rowCount) }
          : {}),
      },
      body: buf,
    });
    const body = (await res.json()) as {
      importId?: string;
      filename?: string;
      bytes?: number;
      fileHash?: string;
      rowCount?: number;
      stored?: boolean;
      error?: string;
    };
    if (!res.ok) {
      return { error: body.error ?? `Upload failed (${res.status})` };
    }
    return body;
  } catch {
    return null;
  }
}

export async function applyImportApi(
  role: ApiRole,
  teachers: unknown[],
  importId?: string,
  history?: {
    schoolHistory?: Array<{
      id: string;
      teacherId: string;
      schoolId: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
      sourceImportId?: string | null;
      createdAt?: string;
    }>;
    designationHistory?: Array<{
      id: string;
      teacherId: string;
      designation: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
      sourceImportId?: string | null;
      createdAt?: string;
    }>;
    locationHistory?: Array<{
      id: string;
      teacherId: string;
      locationType: "HOME" | "SCHOOL";
      latitude: number;
      longitude: number;
      effectiveFrom: string;
      effectiveTo?: string | null;
      sourceImportId?: string | null;
      createdAt?: string;
    }>;
  },
  /** Per-row preview outcomes; payloads are deliberately not sent. */
  rows?: Array<{
    rowNumber: number;
    status:
      "NEW" | "UPDATED" | "UNCHANGED" | "INVALID" | "DUPLICATE" | "MISSING";
    entityKey?: string;
    message?: string;
  }>,
  examCycleId?: string,
) {
  try {
    const res = await fetch(`${API_BASE}/api/imports/apply`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify({
        teachers,
        importId,
        note: "client apply",
        schoolHistory: history?.schoolHistory,
        designationHistory: history?.designationHistory,
        locationHistory: history?.locationHistory,
        rows,
        examCycleId,
      }),
    });
    return (await res.json()) as {
      ok?: boolean;
      upserted?: number;
      schoolHistory?: number;
      designationHistory?: number;
      locationHistory?: number;
      importRows?: number;
      error?: string;
      conflict?: boolean;
    };
  } catch {
    return null;
  }
}

export async function manualOverrideApi(
  role: ApiRole,
  body: {
    runId: string;
    requirementKey: string;
    centreId: string;
    oldTeacherId: string;
    newTeacherId: string;
    reason: string;
  },
) {
  try {
    const res = await fetch(`${API_BASE}/api/manual-overrides`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify(body),
    });
    return (await res.json()) as {
      ok?: boolean;
      overrideId?: string;
      error?: string;
      conflict?: boolean;
    };
  } catch {
    return null;
  }
}

export async function fetchMasterTeachers(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/teachers`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      teachers: Array<{
        teacher_id: string;
        employee_code: string;
        name: string;
        school_id: string;
        designation: string;
        subject?: string | null;
        seniority_rank?: number | null;
        joining_date?: string | null;
        home_latitude?: number | null;
        home_longitude?: number | null;
        is_active?: number;
        data_quality?: string;
      }>;
    };
  } catch {
    return null;
  }
}

export type ManualMasterRecord =
  | { kind: "block"; blockCode: string; blockName: string; active?: boolean }
  | {
      kind: "school";
      schoolCode: string;
      schoolName: string;
      blockId: string;
      latitude: number;
      longitude: number;
      active?: boolean;
    }
  | {
      kind: "centre";
      centreCode: string;
      centreName: string;
      blockId: string;
      latitude: number;
      longitude: number;
      capacity: number;
      active?: boolean;
    }
  | {
      kind: "teacher";
      employeeCode: string;
      name: string;
      schoolId: string;
      designation: string;
      subject: string;
      seniorityRank: number;
      joiningDate?: string | null;
      homeLatitude: number;
      homeLongitude: number;
      isActive?: boolean;
    };

/** Save one manually entered master record. The server validates all required fields. */
export async function upsertManualMasterRecord(
  role: ApiRole,
  record: ManualMasterRecord,
): Promise<{ ok?: boolean; id?: string; created?: boolean; error?: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/master-records`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify(record),
    });
    return (await res.json()) as {
      ok?: boolean;
      id?: string;
      created?: boolean;
      error?: string;
    };
  } catch {
    return null;
  }
}

export async function fetchMasterSchools(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/schools`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      schools: Array<{
        school_id: string;
        school_code: string;
        school_name: string;
        block_id: string;
        latitude?: number | null;
        longitude?: number | null;
        active?: number;
        data_quality?: string;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchMasterBlocks(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/blocks`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      blocks: Array<{
        block_id: string;
        block_code: string;
        block_name: string;
        active?: number;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchMasterSubjects(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/subjects`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      subjects: Array<{
        subject_id: string;
        code: string;
        name: string;
        is_practical?: number;
        active?: number;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchMasterCentres(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/centres`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      centres: Array<{
        centre_id: string;
        centre_code: string;
        centre_name: string;
        block_id?: string;
        latitude?: number | null;
        longitude?: number | null;
        capacity?: number | null;
        active?: number;
        data_quality?: string;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchMasterRelationships(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/relationships`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      relationships: Array<{
        id?: string;
        centre_id?: string;
        school_id?: string;
        relationship_type?: string;
        effective_from?: string;
        effective_to?: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function createExamCycleApi(
  role: ApiRole,
  body: {
    examCycleId: string;
    name: string;
    academicYear: string;
    ruleVersionId: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    amendedFromId?: string;
    amendmentReason?: string;
  },
) {
  try {
    const res = await fetch(`${API_BASE}/api/exam-cycles`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify(body),
    });
    return (await res.json()) as {
      ok?: boolean;
      examCycleId?: string;
      error?: string;
    };
  } catch {
    return null;
  }
}

export async function fetchRuleParameters(
  role: ApiRole,
  ruleVersionId: string,
) {
  try {
    const res = await fetch(
      `${API_BASE}/api/rule-versions/${encodeURIComponent(ruleVersionId)}/parameters`,
      { headers: headers(role) },
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      ruleVersionId: string;
      versionLabel?: string;
      parameters: Array<{
        param_key: string;
        param_value: string;
        value_type: string;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchRuleVersions(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/rule-versions`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      versions: Array<{
        rule_version_id: string;
        version_label: string;
        description: string | null;
        is_active: number;
      }>;
    };
  } catch {
    return null;
  }
}

export async function createRuleVersionApi(
  role: ApiRole,
  body: {
    versionLabel: string;
    description: string;
    cloneFromId: string;
    activate?: boolean;
  },
) {
  try {
    const res = await fetch(`${API_BASE}/api/rule-versions`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify(body),
    });
    return (await res.json()) as {
      ok?: boolean;
      ruleVersionId?: string;
      error?: string;
    };
  } catch {
    return null;
  }
}

export async function activateRuleVersionApi(
  role: ApiRole,
  ruleVersionId: string,
) {
  try {
    const res = await fetch(`${API_BASE}/api/rule-versions/activate`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify({ ruleVersionId }),
    });
    return (await res.json()) as {
      ok?: boolean;
      ruleVersionId?: string;
      versionLabel?: string;
      error?: string;
    };
  } catch {
    return null;
  }
}

export async function updateExamCycleStatusApi(
  role: ApiRole,
  examCycleId: string,
  status: string,
  reason?: string,
) {
  try {
    const res = await fetch(
      `${API_BASE}/api/exam-cycles/${encodeURIComponent(examCycleId)}/status`,
      {
        method: "POST",
        headers: headers(role),
        body: JSON.stringify({ status, reason }),
      },
    );
    return (await res.json()) as {
      ok?: boolean;
      status?: string;
      error?: string;
    };
  } catch {
    return null;
  }
}

/** Set (or clear with nulls) the examination window an officer configured. */
export async function setExamCycleWindowApi(
  role: ApiRole,
  examCycleId: string,
  window: { startDate: string | null; endDate: string | null },
) {
  try {
    const res = await fetch(
      `${API_BASE}/api/exam-cycles/${encodeURIComponent(examCycleId)}/window`,
      {
        method: "POST",
        headers: headers(role),
        body: JSON.stringify(window),
      },
    );
    return (await res.json()) as {
      ok?: boolean;
      startDate?: string | null;
      endDate?: string | null;
      error?: string;
    };
  } catch {
    return null;
  }
}

export type ApiTimetableEntry = {
  timetable_entry_id?: string;
  exam_date?: string;
  session_code?: "MORNING" | "AFTERNOON";
  subject_label?: string;
  requires_chief?: number;
  requires_hall?: number;
  notes?: string | null;
};

export async function fetchExamTimetable(role: ApiRole, examCycleId: string) {
  try {
    const res = await fetch(
      `${API_BASE}/api/exam-cycles/${encodeURIComponent(examCycleId)}/timetable`,
      { headers: headers(role) },
    );
    if (!res.ok) return null;
    return (await res.json()) as { entries: ApiTimetableEntry[] };
  } catch {
    return null;
  }
}

export async function replaceExamTimetableApi(
  role: ApiRole,
  examCycleId: string,
  entries: Array<{
    timetableEntryId?: string;
    examDate: string;
    sessionCode: "MORNING" | "AFTERNOON";
    subjectLabel: string;
    requiresChief: boolean;
    requiresHall: boolean;
    notes?: string | null;
  }>,
) {
  try {
    const res = await fetch(
      `${API_BASE}/api/exam-cycles/${encodeURIComponent(examCycleId)}/timetable`,
      {
        method: "POST",
        headers: headers(role),
        body: JSON.stringify({ entries }),
      },
    );
    return (await res.json()) as {
      ok?: boolean;
      entries?: ApiTimetableEntry[];
      error?: string;
    };
  } catch {
    return null;
  }
}

export async function applyClubbingApi(
  role: ApiRole,
  body: {
    asOfDate: string;
    importId?: string;
    examCycleId?: string;
    relationships: Array<{
      centreId: string;
      schoolId: string;
      relationshipType: "HOST" | "CLUBBED";
      effectiveFrom: string;
      effectiveTo?: string | null;
    }>;
  },
) {
  try {
    const res = await fetch(`${API_BASE}/api/relationships/clubbing`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify(body),
    });
    return (await res.json()) as {
      ok?: boolean;
      inserted?: number;
      closed?: number;
      error?: string;
      conflict?: boolean;
    };
  } catch {
    return null;
  }
}

export async function updateCentreCapacityApi(
  role: ApiRole,
  centres: Array<{ centreId: string; capacity: number }>,
  examCycleId?: string,
) {
  try {
    const res = await fetch(`${API_BASE}/api/centres/capacity`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify({ centres, examCycleId }),
    });
    return (await res.json()) as {
      ok?: boolean;
      updated?: number;
      error?: string;
      conflict?: boolean;
    };
  } catch {
    return null;
  }
}

export async function persistPracticalBatchesApi(
  role: ApiRole,
  body: {
    examCycleId: string;
    runId?: string;
    academicYear?: string;
    batches: Array<{
      batchId: string;
      schoolId: string;
      subjectCode: string;
      studentCount: number;
      batchIndex: number;
      examDate?: string;
      sessionCode?: "MORNING" | "AFTERNOON";
      internalExaminerId?: string;
      externalExaminerId?: string;
    }>;
  },
) {
  try {
    const res = await fetch(`${API_BASE}/api/practical-batches`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify(body),
    });
    return (await res.json()) as {
      ok?: boolean;
      batches?: number;
      schedules?: number;
      pairs?: number;
      error?: string;
    };
  } catch {
    return null;
  }
}

/** Per-row provenance of one import (what the file said about each row). */
export async function fetchImportRows(role: ApiRole, importId: string) {
  try {
    const res = await fetch(
      `${API_BASE}/api/imports/${encodeURIComponent(importId)}/rows`,
      { headers: headers(role) },
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      importId: string;
      rows: Array<{
        id: string;
        row_number: number;
        status: string;
        entity_type: string | null;
        entity_key: string | null;
        message: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

/**
 * Examiner pair memory from earlier cycles — feeds the practical role switch.
 */
export async function fetchExaminerPairs(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/examiner-pairs`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      pairs: Array<{
        pair_id: string;
        teacher_a_id: string;
        teacher_b_id: string;
        subject_id: string;
        subject_code?: string | null;
        school_id: string;
        academic_year: string;
        internal_teacher_id: string;
        external_teacher_id: string;
        exam_cycle_id: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchDutyHistory(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/history`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      history: Array<{
        teacher_id: string;
        centre_id?: string | null;
        duty_type_code: string;
        role_code?: string | null;
        exam_date: string;
        session_code: string;
        academic_year: string;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchExemptions(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/exemptions`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      exemptions: Array<{
        id?: string;
        teacher_id: string;
        is_exempted: number;
        reason: string;
        effective_from: string;
        effective_to?: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function upsertExemptionApi(
  role: ApiRole,
  body: {
    id?: string;
    teacherId: string;
    reason: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    isExempted?: boolean;
  },
) {
  try {
    const res = await fetch(`${API_BASE}/api/exemptions`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify(body),
    });
    return (await res.json()) as { ok?: boolean; id?: string; error?: string };
  } catch {
    return null;
  }
}

export async function fetchPracticalBatchesApi(
  role: ApiRole,
  examCycleId?: string,
) {
  try {
    const q = examCycleId
      ? `?examCycleId=${encodeURIComponent(examCycleId)}`
      : "";
    const res = await fetch(`${API_BASE}/api/practical-batches${q}`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      batches: Array<{
        batch_id: string;
        exam_cycle_id: string;
        school_id: string;
        subject_id: string;
        subject_code?: string | null;
        student_count: number;
        batch_index: number;
      }>;
      schedules: Array<{
        schedule_id: string;
        batch_id: string;
        exam_date: string;
        session_code: string;
        internal_examiner_id: string;
        external_examiner_id: string;
        run_id: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchAllocationRuns(role: ApiRole, examCycleId?: string) {
  try {
    const q = examCycleId
      ? `?examCycleId=${encodeURIComponent(examCycleId)}`
      : "";
    const res = await fetch(`${API_BASE}/api/allocation-runs${q}`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      runs: Array<{
        run_id: string;
        exam_cycle_id: string;
        algorithm_version: string;
        module: string;
        created_at: string;
        status: string;
        validation_status: string | null;
        summary_json: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchAllocationRunResults(role: ApiRole, runId: string) {
  try {
    const res = await fetch(
      `${API_BASE}/api/allocation-runs/${encodeURIComponent(runId)}/results`,
      { headers: headers(role) },
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      runId: string;
      results: Array<{
        teacher_id: string;
        final_teacher_id?: string | null;
        is_override?: number | null;
        centre_id: string;
        duty_type_code: string;
        role_code: string;
        exam_date: string;
        session_code: string;
        score: number;
        decision_trace_json: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchAllocationRunReasons(role: ApiRole, runId: string) {
  try {
    const res = await fetch(
      `${API_BASE}/api/allocation-runs/${encodeURIComponent(runId)}/reasons`,
      { headers: headers(role) },
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      runId: string;
      reasons: Array<{
        id: string;
        result_id: string;
        rule_code: string;
        severity: string;
        message: string;
        details_json: string | null;
        teacher_id: string;
        centre_id: string;
        exam_date: string;
        session_code: string;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchAudit(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/audit`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      entries: Array<{
        audit_id: string;
        user_id: string;
        action: string;
        entity: string | null;
        entity_id: string | null;
        timestamp: string;
        reason: string | null;
        new_value: string | null;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchTeacherSchoolHistory(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/teacher-history/schools`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      rows: Array<{
        id: string;
        teacher_id: string;
        school_id: string;
        effective_from: string;
        effective_to: string | null;
        source_import_id: string | null;
        created_at: string;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchTeacherDesignationHistory(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/teacher-history/designations`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      rows: Array<{
        id: string;
        teacher_id: string;
        designation: string;
        effective_from: string;
        effective_to: string | null;
        source_import_id: string | null;
        created_at: string;
      }>;
    };
  } catch {
    return null;
  }
}

export async function fetchTeacherLocationHistory(role: ApiRole) {
  try {
    const res = await fetch(`${API_BASE}/api/teacher-history/locations`, {
      headers: headers(role),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      rows: Array<{
        id: string;
        teacher_id: string;
        location_type: "HOME" | "SCHOOL";
        latitude: number;
        longitude: number;
        effective_from: string;
        effective_to: string | null;
        source_import_id: string | null;
        created_at: string;
      }>;
    };
  } catch {
    return null;
  }
}

export async function recordExportApi(
  role: ApiRole,
  body: {
    exportType: string;
    examCycleId?: string;
    runId?: string;
    meta?: Record<string, unknown>;
  },
) {
  try {
    const res = await fetch(`${API_BASE}/api/exports`, {
      method: "POST",
      headers: headers(role),
      body: JSON.stringify(body),
    });
    const payload = (await res.json()) as {
      ok?: boolean;
      exportId?: string;
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: payload.error ?? `Export receipt failed (${res.status})`,
      };
    }
    return payload;
  } catch {
    return null;
  }
}
