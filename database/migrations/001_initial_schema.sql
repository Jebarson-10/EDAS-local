-- Migration 001: initial schema for Erode Examination Duty Allotment System
-- Never hard-delete historical allotment data from application code.

PRAGMA foreign_keys = ON;

CREATE TABLE blocks (
  block_id TEXT PRIMARY KEY,
  block_code TEXT NOT NULL UNIQUE,
  block_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE schools (
  school_id TEXT PRIMARY KEY,
  school_code TEXT NOT NULL UNIQUE,
  school_name TEXT NOT NULL,
  block_id TEXT NOT NULL REFERENCES blocks(block_id),
  address TEXT,
  latitude REAL,
  longitude REAL,
  school_type TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  data_quality TEXT NOT NULL DEFAULT 'Imported'
    CHECK (data_quality IN ('Confirmed','Unverified','Imported','ManuallyCorrected','Derived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_schools_block ON schools(block_id);

CREATE TABLE centres (
  centre_id TEXT PRIMARY KEY,
  centre_code TEXT NOT NULL UNIQUE,
  centre_name TEXT NOT NULL,
  block_id TEXT NOT NULL REFERENCES blocks(block_id),
  address TEXT,
  latitude REAL,
  longitude REAL,
  capacity INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  data_quality TEXT NOT NULL DEFAULT 'Imported'
    CHECK (data_quality IN ('Confirmed','Unverified','Imported','ManuallyCorrected','Derived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_centres_block ON centres(block_id);

CREATE TABLE centre_school_relationships (
  id TEXT PRIMARY KEY,
  centre_id TEXT NOT NULL REFERENCES centres(centre_id),
  school_id TEXT NOT NULL REFERENCES schools(school_id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('HOST','CLUBBED')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  source_import_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_csr_centre ON centre_school_relationships(centre_id);
CREATE INDEX idx_csr_school ON centre_school_relationships(school_id);
CREATE INDEX idx_csr_effective ON centre_school_relationships(effective_from, effective_to);

CREATE TABLE subjects (
  subject_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_practical INTEGER NOT NULL DEFAULT 0 CHECK (is_practical IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE teachers (
  teacher_id TEXT PRIMARY KEY,
  employee_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  school_id TEXT NOT NULL REFERENCES schools(school_id),
  designation TEXT NOT NULL,
  subject TEXT,
  seniority_rank INTEGER,
  joining_date TEXT,
  home_latitude REAL,
  home_longitude REAL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  data_quality TEXT NOT NULL DEFAULT 'Imported'
    CHECK (data_quality IN ('Confirmed','Unverified','Imported','ManuallyCorrected','Derived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_teachers_school ON teachers(school_id);
CREATE INDEX idx_teachers_designation ON teachers(designation);
CREATE INDEX idx_teachers_active ON teachers(is_active);

CREATE TABLE teacher_school_history (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  school_id TEXT NOT NULL REFERENCES schools(school_id),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  source_import_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tsh_teacher ON teacher_school_history(teacher_id);

CREATE TABLE teacher_designation_history (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  designation TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  source_import_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tdh_teacher ON teacher_designation_history(teacher_id);

CREATE TABLE teacher_location_history (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  location_type TEXT NOT NULL CHECK (location_type IN ('HOME','SCHOOL')),
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  source_import_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tlh_teacher ON teacher_location_history(teacher_id);

CREATE TABLE teacher_exemptions (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  is_exempted INTEGER NOT NULL DEFAULT 1 CHECK (is_exempted IN (0, 1)),
  reason TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX idx_tex_teacher ON teacher_exemptions(teacher_id);

CREATE TABLE duty_types (
  duty_type_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('THEORY','PRACTICAL','HALL'))
);

CREATE TABLE rule_versions (
  rule_version_id TEXT PRIMARY KEY,
  version_label TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1))
);

CREATE TABLE rule_parameters (
  id TEXT PRIMARY KEY,
  rule_version_id TEXT NOT NULL REFERENCES rule_versions(rule_version_id),
  param_key TEXT NOT NULL,
  param_value TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('number','string','boolean','json')),
  UNIQUE (rule_version_id, param_key)
);

CREATE TABLE exam_cycles (
  exam_cycle_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  standard TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT','OPEN','ALLOCATION_GENERATED','UNDER_REVIEW',
    'APPROVED','PUBLISHED','LOCKED','ARCHIVED'
  )),
  rule_version_id TEXT REFERENCES rule_versions(rule_version_id),
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX idx_exam_cycles_status ON exam_cycles(status);

CREATE TABLE exam_days (
  exam_day_id TEXT PRIMARY KEY,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(exam_cycle_id),
  exam_date TEXT NOT NULL,
  UNIQUE (exam_cycle_id, exam_date)
);

CREATE TABLE exam_sessions (
  exam_session_id TEXT PRIMARY KEY,
  exam_day_id TEXT NOT NULL REFERENCES exam_days(exam_day_id),
  session_code TEXT NOT NULL CHECK (session_code IN ('MORNING','AFTERNOON')),
  UNIQUE (exam_day_id, session_code)
);

CREATE TABLE exam_subjects (
  id TEXT PRIMARY KEY,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(exam_cycle_id),
  subject_id TEXT NOT NULL REFERENCES subjects(subject_id),
  UNIQUE (exam_cycle_id, subject_id)
);

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  external_subject TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','OFFICER','DATA_OPERATOR','VIEWER')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE permissions (
  permission_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE role_permissions (
  role TEXT NOT NULL CHECK (role IN ('ADMIN','OFFICER','DATA_OPERATOR','VIEWER')),
  permission_id TEXT NOT NULL REFERENCES permissions(permission_id),
  PRIMARY KEY (role, permission_id)
);

CREATE TABLE source_imports (
  import_id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL,
  exam_cycle_id TEXT REFERENCES exam_cycles(exam_cycle_id),
  row_count INTEGER,
  status TEXT NOT NULL CHECK (status IN (
    'UPLOADED','VALIDATED','PREVIEWED','APPLIED','REJECTED','FAILED'
  )),
  r2_key TEXT,
  summary_json TEXT
);

CREATE TABLE source_import_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES source_imports(import_id),
  row_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('NEW','UPDATED','UNCHANGED','INVALID','DUPLICATE','MISSING')),
  entity_type TEXT,
  entity_key TEXT,
  message TEXT,
  payload_json TEXT
);
CREATE INDEX idx_sir_import ON source_import_rows(import_id);

CREATE TABLE input_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  storage_key TEXT,
  inline_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE allocation_runs (
  run_id TEXT PRIMARY KEY,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(exam_cycle_id),
  rule_version_id TEXT NOT NULL REFERENCES rule_versions(rule_version_id),
  algorithm_version TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('THEORY','PRACTICAL','HALL','COMBINED')),
  input_snapshot_id TEXT REFERENCES input_snapshots(snapshot_id),
  seed TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'GENERATED','VALIDATED','REVIEWED','APPROVED','PUBLISHED','LOCKED','SUPERSEDED'
  )),
  validation_status TEXT CHECK (validation_status IN (
    'VALID','VALID_WITH_WARNINGS','INVALID','PENDING'
  )),
  summary_json TEXT
);
CREATE INDEX idx_runs_cycle ON allocation_runs(exam_cycle_id);

CREATE TABLE allocation_run_results (
  result_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES allocation_runs(run_id),
  teacher_id TEXT,
  centre_id TEXT,
  school_id TEXT,
  duty_type_code TEXT,
  role_code TEXT,
  exam_date TEXT,
  session_code TEXT,
  subject_id TEXT,
  score REAL,
  decision_trace_json TEXT,
  is_generated INTEGER NOT NULL DEFAULT 1,
  is_override INTEGER NOT NULL DEFAULT 0,
  final_teacher_id TEXT,
  generated_teacher_id TEXT,
  data_quality_flags TEXT
);
CREATE INDEX idx_arr_run ON allocation_run_results(run_id);
CREATE INDEX idx_arr_teacher ON allocation_run_results(final_teacher_id);

CREATE TABLE allocation_decision_reasons (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL REFERENCES allocation_run_results(result_id),
  rule_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','ERROR')),
  message TEXT NOT NULL,
  details_json TEXT
);

CREATE TABLE manual_overrides (
  override_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES allocation_runs(run_id),
  result_id TEXT NOT NULL REFERENCES allocation_run_results(result_id),
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL
);

CREATE TABLE duty_assignments (
  assignment_id TEXT PRIMARY KEY,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(exam_cycle_id),
  run_id TEXT REFERENCES allocation_runs(run_id),
  teacher_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  centre_id TEXT,
  school_id TEXT,
  duty_type_code TEXT NOT NULL,
  role_code TEXT,
  exam_date TEXT NOT NULL,
  session_code TEXT NOT NULL CHECK (session_code IN ('MORNING','AFTERNOON')),
  subject_id TEXT,
  academic_year TEXT,
  is_published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_da_teacher_slot ON duty_assignments(teacher_id, exam_date, session_code);
CREATE INDEX idx_da_centre ON duty_assignments(centre_id);
CREATE INDEX idx_da_year ON duty_assignments(academic_year);

-- Immutable append-only history of published/locked assignments
CREATE TABLE duty_assignment_history (
  history_id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  exam_cycle_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  centre_id TEXT,
  school_id TEXT,
  duty_type_code TEXT NOT NULL,
  role_code TEXT,
  exam_date TEXT NOT NULL,
  session_code TEXT NOT NULL,
  subject_id TEXT,
  academic_year TEXT,
  published_at TEXT NOT NULL,
  run_id TEXT
);
CREATE INDEX idx_dah_teacher ON duty_assignment_history(teacher_id);
CREATE INDEX idx_dah_centre_year ON duty_assignment_history(centre_id, academic_year);

CREATE TABLE practical_batches (
  batch_id TEXT PRIMARY KEY,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(exam_cycle_id),
  school_id TEXT NOT NULL REFERENCES schools(school_id),
  subject_id TEXT NOT NULL REFERENCES subjects(subject_id),
  student_count INTEGER NOT NULL,
  batch_index INTEGER NOT NULL
);

CREATE TABLE practical_schedules (
  schedule_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES practical_batches(batch_id),
  exam_date TEXT NOT NULL,
  session_code TEXT NOT NULL CHECK (session_code IN ('MORNING','AFTERNOON')),
  internal_examiner_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  external_examiner_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  run_id TEXT REFERENCES allocation_runs(run_id)
);

CREATE TABLE examiner_pairs (
  pair_id TEXT PRIMARY KEY,
  teacher_a_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  teacher_b_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  subject_id TEXT NOT NULL REFERENCES subjects(subject_id),
  school_id TEXT NOT NULL REFERENCES schools(school_id),
  academic_year TEXT NOT NULL,
  internal_teacher_id TEXT NOT NULL,
  external_teacher_id TEXT NOT NULL,
  exam_cycle_id TEXT
);
CREATE INDEX idx_ep_pair ON examiner_pairs(teacher_a_id, teacher_b_id, subject_id);

CREATE TABLE audit_logs (
  audit_id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  timestamp TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  meta_json TEXT
);
CREATE INDEX idx_audit_ts ON audit_logs(timestamp);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE backup_records (
  backup_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT,
  trigger_reason TEXT,
  r2_key TEXT,
  checksum TEXT,
  status TEXT NOT NULL,
  meta_json TEXT
);

CREATE TABLE export_records (
  export_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT,
  export_type TEXT NOT NULL,
  exam_cycle_id TEXT,
  run_id TEXT,
  r2_key TEXT,
  meta_json TEXT
);
