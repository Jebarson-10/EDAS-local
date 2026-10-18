-- One successor per manually edited list prevents conflicting edits from two windows.
CREATE TABLE IF NOT EXISTS exam_workspace_manual_changes (
  parent_run_id TEXT PRIMARY KEY,
  new_run_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  shortage_key TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  distance_exception INTEGER NOT NULL,
  approved_at TEXT NOT NULL
);
