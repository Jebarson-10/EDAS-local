-- A cycle owns its complete current input. Old master tables and history remain
-- untouched. Snapshots and run inputs are immutable; only the head advances.
CREATE TABLE IF NOT EXISTS exam_workspaces (
  workspace_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  snapshot_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exam_workspace_chunks (
  snapshot_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, part)
);
CREATE TABLE IF NOT EXISTS exam_workspace_runs (
  run_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES exam_workspaces(workspace_id),
  input_snapshot_id TEXT NOT NULL,
  result_snapshot_id TEXT NOT NULL,
  standard TEXT NOT NULL,
  module TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0
);
