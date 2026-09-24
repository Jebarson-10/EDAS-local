-- Each examination retains its own centre membership and student strengths.
CREATE TABLE centre_checklists (
  exam_cycle_id TEXT PRIMARY KEY REFERENCES exam_cycles(exam_cycle_id),
  standard TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  rows_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE practical_student_returns (
  exam_cycle_id TEXT PRIMARY KEY REFERENCES exam_cycles(exam_cycle_id),
  rows_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE custodian_plans (
  exam_cycle_id TEXT PRIMARY KEY REFERENCES exam_cycles(exam_cycle_id),
  rows_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
