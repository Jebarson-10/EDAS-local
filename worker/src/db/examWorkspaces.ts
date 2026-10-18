import {
  workspaceSchema,
  type ExamWorkspace,
  type WorkspaceRun,
  type WorkspaceHistory,
} from "@exam-duty/shared";
import type { DbClient } from "./client.js";
import { runAtomic } from "./client.js";
import { validateWorkspaceRun, workspaceManualCandidates, fillWorkspaceShortage } from "@exam-duty/validator";

async function writeSnapshot(db: DbClient, value: unknown): Promise<string> {
  const snapshotId = crypto.randomUUID();
  const json = JSON.stringify(value);
  const statements = [];
  // Keep D1 text values comfortably under its per-row limit. The head is moved
  // only after every chunk has been written; partial saves are never loaded.
  for (
    let offset = 0, part = 0;
    offset < json.length;
    offset += 60000, part++
  ) {
    statements.push(
      db
        .prepare(
          "INSERT INTO exam_workspace_chunks(snapshot_id,part,content) VALUES (?,?,?)",
        )
        .bind(snapshotId, part, json.slice(offset, offset + 60000)),
    );
  }
  for (let start = 0; start < statements.length; start += 40) {
    const batch = statements.slice(start, start + 40);
    if (db.batch) await db.batch(batch);
    else for (const statement of batch) await statement.run();
  }
  return snapshotId;
}
async function readSnapshot<T>(db: DbClient, snapshotId: string): Promise<T> {
  const rows = await db
    .prepare(
      "SELECT content FROM exam_workspace_chunks WHERE snapshot_id=? ORDER BY part",
    )
    .bind(snapshotId)
    .all<{ content: string }>();
  if (!rows.results.length)
    throw new Error(
      "Saved cycle data is missing. Restore a backup before continuing.",
    );
  return JSON.parse(rows.results.map((r) => r.content).join("")) as T;
}
export async function listWorkspaces(db: DbClient) {
  return (
    await db
      .prepare(
        "SELECT workspace_id AS id,name,revision,updated_at AS updatedAt FROM exam_workspaces ORDER BY updated_at DESC",
      )
      .all()
  ).results;
}
export async function readWorkspace(db: DbClient, id: string) {
  const head = await db
    .prepare(
      "SELECT snapshot_id,revision FROM exam_workspaces WHERE workspace_id=?",
    )
    .bind(id)
    .first<{ snapshot_id: string; revision: number }>();
  if (!head) throw new Error("Exam cycle not found.");
  const workspace = await readSnapshot<ExamWorkspace>(db, head.snapshot_id);
  return { ...workspace, revision: head.revision };
}
export async function saveWorkspace(db: DbClient, value: unknown) {
  const data = workspaceSchema.parse(value);
  const head = await db
    .prepare("SELECT revision FROM exam_workspaces WHERE workspace_id=?")
    .bind(data.id)
    .first<{ revision: number }>();
  if (head && head.revision !== data.revision)
    throw new Error(
      "This cycle changed in another window. Reload it before saving.",
    );
  if (!head && data.revision !== 0)
    throw new Error("New cycles must start at revision zero.");
  const next = { ...data, revision: data.revision + 1 };
  const snapshotId = await writeSnapshot(db, next);
  const now = new Date().toISOString();
  if (head) {
    const result = await db
      .prepare(
        "UPDATE exam_workspaces SET name=?,revision=?,snapshot_id=?,updated_at=? WHERE workspace_id=? AND revision=?",
      )
      .bind(data.name, next.revision, snapshotId, now, data.id, data.revision)
      .run();
    if (result.meta?.changes !== 1)
      throw new Error(
        "This cycle changed while saving. Reload it to keep both versions safe.",
      );
  } else {
    await db
      .prepare(
        "INSERT INTO exam_workspaces(workspace_id,name,revision,snapshot_id,updated_at) VALUES (?,?,?,?,?)",
      )
      .bind(data.id, data.name, next.revision, snapshotId, now)
      .run();
  }
  return { revision: next.revision };
}
export async function listWorkspaceRuns(db: DbClient, id: string) {
  const records = (
    await db
      .prepare(
        "SELECT result_snapshot_id,published FROM exam_workspace_runs WHERE workspace_id=? ORDER BY rowid DESC",
      )
      .bind(id)
      .all<{ result_snapshot_id: string; published: number }>()
  ).results;
  const results: WorkspaceRun[] = [];
  for (const record of records)
    results.push({
      ...(await readSnapshot<WorkspaceRun>(db, record.result_snapshot_id)),
      published: Boolean(record.published),
    });
  return results;
}
export async function workspaceHistoryReference(
  db: DbClient,
  exceptId: string,
): Promise<WorkspaceHistory[]> {
  const chunks = (
    await db
      .prepare(
        `SELECT r.run_id,c.part,c.content FROM exam_workspace_runs r
    JOIN exam_workspace_chunks c ON c.snapshot_id=r.result_snapshot_id
    WHERE r.published=1 AND r.workspace_id<>? ORDER BY r.run_id,c.part`,
      )
      .bind(exceptId)
      .all<{ run_id: string; part: number; content: string }>()
  ).results;
  const strings = new Map<string, string[]>();
  for (const chunk of chunks) {
    const parts = strings.get(chunk.run_id) ?? [];
    parts.push(chunk.content);
    strings.set(chunk.run_id, parts);
  }
  const unique = new Map<string, WorkspaceHistory>();
  for (const parts of strings.values())
    for (const a of (JSON.parse(parts.join("")) as WorkspaceRun).assignments) {
      const h = {
        staffId: a.staffId,
        centreUdise: a.centreUdise,
        date: a.date,
        role: a.role,
      };
      unique.set(`${h.staffId}|${h.centreUdise}|${h.date}|${h.role}`, h);
    }
  return [...unique.values()];
}
export async function saveWorkspaceRun(
  db: DbClient,
  workspaceId: string,
  run: WorkspaceRun,
) {
  if (run?.parentRunId || run?.assignments?.some((a) => a.manual))
    throw new Error("Use the manual assignment action to record a staff choice and its reason.");
  if (
    !run ||
    !run.id ||
    !["10", "12"].includes(run.standard) ||
    !["THEORY", "PRACTICAL"].includes(run.module) ||
    !Array.isArray(run.assignments) ||
    !Array.isArray(run.shortages) ||
    !Array.isArray(run.errors)
  )
    throw new Error("Invalid duty list.");
  const head = await db
    .prepare(
      "SELECT revision,snapshot_id FROM exam_workspaces WHERE workspace_id=?",
    )
    .bind(workspaceId)
    .first<{ revision: number; snapshot_id: string }>();
  if (!head || head.revision !== run.inputRevision)
    throw new Error("The input changed. Generate the duty list again.");
  const input = await readSnapshot<ExamWorkspace>(db, head.snapshot_id);
  const inputSnapshot = input.settings.retainHistory
    ? await writeSnapshot(db, {
        ...input,
        history: [
          ...input.history,
          ...(await workspaceHistoryReference(db, workspaceId)),
        ],
      })
    : head.snapshot_id;
  const snapshot = await writeSnapshot(db, { ...run, published: false });
  await db
    .prepare(
      "INSERT INTO exam_workspace_runs(run_id,workspace_id,input_snapshot_id,result_snapshot_id,standard,module,created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(
      run.id,
      workspaceId,
      inputSnapshot,
      snapshot,
      run.standard,
      run.module,
      run.createdAt,
    )
    .run();
}
async function manualContext(db: DbClient, workspaceId: string, runId: string) {
  const row = await db.prepare("SELECT input_snapshot_id,result_snapshot_id FROM exam_workspace_runs WHERE workspace_id=? AND run_id=?")
    .bind(workspaceId, runId).first<{ input_snapshot_id: string; result_snapshot_id: string }>();
  if (!row) throw new Error("Saved duty list not found.");
  const run = await readSnapshot<WorkspaceRun>(db, row.result_snapshot_id);
  const runs = await listWorkspaceRuns(db, workspaceId);
  if (runs.find((r) => r.standard === run.standard && r.module === run.module)?.id !== run.id)
    throw new Error("A newer duty list exists. Open the latest list before assigning staff.");
  const workspace = await readSnapshot<ExamWorkspace>(db, row.input_snapshot_id);
  if ((await readWorkspace(db, workspaceId)).revision !== run.inputRevision)
    throw new Error("The input changed. Generate a new list before filling shortages.");
  const latest = new Map<string, WorkspaceRun>();
  for (const r of runs) {
    const key = `${r.standard}|${r.module}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  const other = [...latest.values()].filter((r) => r.standard !== run.standard || r.module !== run.module).flatMap((r) => r.assignments);
  return { workspace, run, other, inputSnapshot: row.input_snapshot_id };
}

export async function assignWorkspaceShortage(db: DbClient, workspaceId: string, runId: string,
  choice: { shortageKey: string; staffId: string; reason: string; distanceException: boolean }) {
  const context = await manualContext(db, workspaceId, runId);
  const next = fillWorkspaceShortage(context.workspace, context.run, choice, context.other);
  const snapshot = await writeSnapshot(db, next);
  await runAtomic(db, [
    db.prepare("INSERT INTO exam_workspace_manual_changes(parent_run_id,new_run_id,workspace_id,shortage_key,staff_id,reason,distance_exception,approved_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(runId, next.id, workspaceId, choice.shortageKey, choice.staffId, choice.reason.trim(), next.assignments.find((a) => a.manual?.parentRunId === runId)!.manual!.distanceException ? 1 : 0, next.createdAt),
    db.prepare("INSERT INTO exam_workspace_runs(run_id,workspace_id,input_snapshot_id,result_snapshot_id,standard,module,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(next.id, workspaceId, context.inputSnapshot, snapshot, next.standard, next.module, next.createdAt),
  ]);
  return next;
}
export async function publishWorkspaceRun(
  db: DbClient,
  workspaceId: string,
  runId: string,
) {
  const row = await db
    .prepare(
      "SELECT result_snapshot_id,input_snapshot_id FROM exam_workspace_runs WHERE workspace_id=? AND run_id=?",
    )
    .bind(workspaceId, runId)
    .first<{ result_snapshot_id: string; input_snapshot_id: string }>();
  if (!row) throw new Error("Duty list not found.");
  const run = await readSnapshot<WorkspaceRun>(db, row.result_snapshot_id);
  const input = await readSnapshot<ExamWorkspace>(db, row.input_snapshot_id);
  if (!run.assignments.length || !input.settings.confirmed)
    throw new Error(
      "A checked, non-empty duty list is required before confirming.",
    );
  const checks = validateWorkspaceRun(input, run);
  if (checks.length)
    throw new Error(
      `Duty-list checks failed: ${checks.slice(0, 5).join("; ")}`,
    );
  if (run.errors.length || run.shortages.length)
    throw new Error(
      "Resolve shortages and checking errors before confirming this list.",
    );
  await db
    .prepare(
      "UPDATE exam_workspace_runs SET published=1 WHERE workspace_id=? AND run_id=?",
    )
    .bind(workspaceId, runId)
    .run();
}
export async function workspaceEndpoint(
  db: DbClient,
  method: string,
  query: URLSearchParams,
  body?: unknown,
): Promise<unknown> {
  const id = query.get("id");
  if (method === "GET") {
    if (!id) return { cycles: await listWorkspaces(db) };
    if (query.get("runId")) {
      if (query.has("shortageKey")) {
        const context = await manualContext(db, id, query.get("runId")!);
        return { candidates: workspaceManualCandidates(context.workspace, context.run, query.get("shortageKey")!, context.other) };
      }
      const row = await db
        .prepare(
          "SELECT input_snapshot_id FROM exam_workspace_runs WHERE workspace_id=? AND run_id=?",
        )
        .bind(id, query.get("runId"))
        .first<{ input_snapshot_id: string }>();
      if (!row) throw new Error("Saved duty list not found.");
      return {
        workspace: await readSnapshot<ExamWorkspace>(db, row.input_snapshot_id),
      };
    }
    if (query.get("history") === "1")
      return { history: await workspaceHistoryReference(db, id) };
    const workspace = await readWorkspace(db, id),
      runs = await listWorkspaceRuns(db, id);
    if (query.get("backup") === "1") {
      const inputs: Record<string, ExamWorkspace> = {};
      for (const run of runs) {
        const record = await db
          .prepare(
            "SELECT input_snapshot_id FROM exam_workspace_runs WHERE run_id=? AND workspace_id=?",
          )
          .bind(run.id, id)
          .first<{ input_snapshot_id: string }>();
        if (record)
          inputs[run.id] = await readSnapshot(db, record.input_snapshot_id);
      }
      return { format: "EDAS_WORKSPACE_1", workspace, runs, inputs };
    }
    return { workspace, runs };
  }
  const input = body as {
    action?: string;
    workspace?: unknown;
    workspaceId?: string;
    run?: WorkspaceRun;
    runId?: string;
    choice?: { shortageKey: string; staffId: string; reason: string; distanceException: boolean };
    backup?: {
      format: string;
      workspace: unknown;
      runs: WorkspaceRun[];
      inputs: Record<string, unknown>;
    };
  };
  if (
    input.action === "restore" &&
    input.backup?.format === "EDAS_WORKSPACE_1"
  ) {
    const backup = input.backup;
    const restored = workspaceSchema.parse({
      ...workspaceSchema.parse(backup.workspace),
      id: crypto.randomUUID(),
      revision: 0,
    });
    restored.name = `${restored.name} (restored)`;
    if (!Array.isArray(backup.runs) || !backup.inputs)
      throw new Error("Backup is missing its saved duty-list inputs.");
    const prepared = backup.runs.map((run) => ({
      run,
      input: workspaceSchema.parse(backup.inputs[run.id]),
    }));
    const saved = await saveWorkspace(db, restored);
    // Backup lists are newest first; insert oldest first to retain save order.
    for (const item of prepared.reverse()) {
      const run = { ...item.run, id: crypto.randomUUID() };
      const inputSnapshot = await writeSnapshot(db, {
        ...item.input,
        id: restored.id,
      });
      const resultSnapshot = await writeSnapshot(db, run);
      await db
        .prepare(
          "INSERT INTO exam_workspace_runs(run_id,workspace_id,input_snapshot_id,result_snapshot_id,standard,module,created_at,published) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          run.id,
          restored.id,
          inputSnapshot,
          resultSnapshot,
          run.standard,
          run.module,
          run.createdAt,
          run.published ? 1 : 0,
        )
        .run();
    }
    return { ok: true, id: restored.id, revision: saved.revision };
  }
  if (input.action === "save")
    return { ok: true, ...(await saveWorkspace(db, input.workspace)) };
  if (input.action === "assign" && input.workspaceId && input.runId && input.choice)
    return { ok: true, run: await assignWorkspaceShortage(db, input.workspaceId, input.runId, input.choice) };
  if (input.action === "run" && input.workspaceId && input.run) {
    await saveWorkspaceRun(db, input.workspaceId, input.run);
    return { ok: true };
  }
  if (input.action === "publish" && input.workspaceId && input.runId) {
    await publishWorkspaceRun(db, input.workspaceId, input.runId);
    return { ok: true };
  }
  throw new Error("Choose a valid cycle action.");
}
