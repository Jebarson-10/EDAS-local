-- Officer-entered timetable. One row represents one dated examination session.
-- The two flags make the duty demand explicit rather than assuming that every
-- subject/session needs the same kinds of staff.
CREATE TABLE exam_timetable_entries (
  timetable_entry_id TEXT PRIMARY KEY,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(exam_cycle_id),
  exam_date TEXT NOT NULL,
  session_code TEXT NOT NULL CHECK (session_code IN ('MORNING', 'AFTERNOON')),
  subject_label TEXT NOT NULL,
  requires_chief INTEGER NOT NULL DEFAULT 1 CHECK (requires_chief IN (0, 1)),
  requires_hall INTEGER NOT NULL DEFAULT 1 CHECK (requires_hall IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (exam_cycle_id, exam_date, session_code)
);
CREATE INDEX idx_exam_timetable_cycle_date
  ON exam_timetable_entries(exam_cycle_id, exam_date, session_code);
