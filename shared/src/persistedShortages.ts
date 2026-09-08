import type { ShortageRecord, ShortageSourceKind } from "./types.js";
import { makeId } from "./ids.js";

export function persistedShortageSourceKind(
  row: { source_kind?: unknown; sourceKind?: unknown },
): ShortageSourceKind {
  const raw = String(row.source_kind ?? row.sourceKind ?? "CALCULATED");
  return raw === "MANUAL" ? "MANUAL" : "CALCULATED";
}

export function mapShortageRow(r: Record<string, unknown>): ShortageRecord {
  return {
    shortageId: String(r.shortage_id ?? r.shortageId),
    examCycleId: String(r.exam_cycle_id ?? r.examCycleId),
    centreId: String(r.centre_id ?? r.centreId),
    examDate: String(r.exam_date ?? r.examDate),
    session: String(r.session) as ShortageRecord["session"],
    dutyTypeCode: String(r.duty_type_code ?? r.dutyTypeCode),
    requiredCount: Number(r.required_count ?? r.requiredCount),
    allocatedCount: Number(r.allocated_count ?? r.allocatedCount),
    shortageCount: Number(r.shortage_count ?? r.shortageCount),
    sourceKind: persistedShortageSourceKind(r),
    createdAt: String(r.created_at ?? r.createdAt ?? ""),
  };
}

export function mapShortageRows(rows: unknown): ShortageRecord[] {
  return Array.isArray(rows) ? rows.map((r) => mapShortageRow(r as Record<string, unknown>)) : [];
}

export function persistedShortageToRow(s: ShortageRecord) {
  return {
    shortage_id: s.shortageId,
    exam_cycle_id: s.examCycleId,
    centre_id: s.centreId,
    exam_date: s.examDate,
    session: s.session,
    duty_type_code: s.dutyTypeCode,
    required_count: s.requiredCount,
    allocated_count: s.allocatedCount,
    shortage_count: s.shortageCount,
    source_kind: s.sourceKind,
    created_at: s.createdAt,
  };
}

export function mergeShortagesKeepingManual(
  previous: ShortageRecord[],
  calculated: ShortageRecord[],
): ShortageRecord[] {
  const manuals = previous.filter((s) => s.sourceKind === "MANUAL");
  const calc = calculated.filter((s) => s.sourceKind === "CALCULATED");
  const out: ShortageRecord[] = [...calc];
  for (const m of manuals) {
    const idx = out.findIndex(
      (s) =>
        s.examCycleId === m.examCycleId &&
        s.centreId === m.centreId &&
        s.examDate === m.examDate &&
        s.session === m.session &&
        s.dutyTypeCode === m.dutyTypeCode,
    );
    if (idx >= 0) out[idx] = m;
    else out.push(m);
  }
  return out;
}

export function upsertManualShortage(
  previous: ShortageRecord[],
  patch: Omit<ShortageRecord, "shortageId" | "createdAt" | "sourceKind"> & {
    shortageId?: string;
    createdAt?: string;
  },
): ShortageRecord[] {
  const row: ShortageRecord = {
    shortageId: patch.shortageId ?? makeId("sh"),
    examCycleId: patch.examCycleId,
    centreId: patch.centreId,
    examDate: patch.examDate,
    session: patch.session,
    dutyTypeCode: patch.dutyTypeCode,
    requiredCount: patch.requiredCount,
    allocatedCount: patch.allocatedCount,
    shortageCount: patch.shortageCount,
    sourceKind: "MANUAL",
    createdAt: patch.createdAt ?? new Date().toISOString(),
  };
  const idx = previous.findIndex(
    (s) =>
      s.examCycleId === row.examCycleId &&
      s.centreId === row.centreId &&
      s.examDate === row.examDate &&
      s.session === row.session &&
      s.dutyTypeCode === row.dutyTypeCode,
  );
  if (idx >= 0) {
    const next = [...previous];
    next[idx] = { ...row, shortageId: previous[idx]!.shortageId, createdAt: previous[idx]!.createdAt };
    return next;
  }
  return [...previous, row];
}
