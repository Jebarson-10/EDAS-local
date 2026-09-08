-- Seed: synthetic reference data only — no real government PII

INSERT INTO duty_types (duty_type_id, code, name, module) VALUES
  ('dt-theory-chief', 'CHIEF_EXAMINATION', 'Chief of Examination', 'THEORY'),
  ('dt-theory-dept', 'DEPARTMENT_OFFICER', 'Department Officer', 'THEORY'),
  ('dt-theory-inv', 'THEORY_INVIGILATOR', 'Theory Invigilator', 'THEORY'),
  ('dt-prac-int', 'PRACTICAL_INTERNAL', 'Practical Internal Examiner', 'PRACTICAL'),
  ('dt-prac-ext', 'PRACTICAL_EXTERNAL', 'Practical External Examiner', 'PRACTICAL'),
  ('dt-hall', 'HALL_INVIGILATOR', 'Hall Invigilator', 'HALL'),
  ('dt-hall-standby', 'HALL_STANDBY', 'Hall Standby', 'HALL');

INSERT INTO subjects (subject_id, code, name, is_practical, active) VALUES
  ('sub-phy', 'PHY', 'Physics', 1, 1),
  ('sub-che', 'CHE', 'Chemistry', 1, 1),
  ('sub-bio', 'BIO', 'Biology', 1, 1),
  ('sub-cs', 'CS', 'Computer Science', 1, 1),
  ('sub-voc', 'VOC', 'Vocational', 1, 1),
  ('sub-eng', 'ENG', 'English', 0, 1),
  ('sub-tam', 'TAM', 'Tamil', 0, 1),
  ('sub-mat', 'MAT', 'Mathematics', 0, 1);

INSERT INTO rule_versions (rule_version_id, version_label, description, created_at, created_by, is_active)
VALUES (
  'rv-2027-1',
  '2027.1',
  'Provisional seed rule version — parameters pending client confirmation (see docs/open-questions.md)',
  '2026-01-01T00:00:00.000Z',
  'system',
  1
);

-- Provisional defaults; OQ items documented in open-questions.md
INSERT INTO rule_parameters (id, rule_version_id, param_key, param_value, value_type) VALUES
  ('rp-1', 'rv-2027-1', 'maximum_distance_km', '10', 'number'),
  ('rp-2', 'rv-2027-1', 'distance_policy', '"HOME_OR_SCHOOL"', 'string'),
  ('rp-3', 'rv-2027-1', 'repeat_years', '2', 'number'),
  ('rp-4', 'rv-2027-1', 'students_per_hall', '20', 'number'),
  ('rp-5', 'rv-2027-1', 'standby_percentage', '10', 'number'),
  ('rp-6', 'rv-2027-1', 'practical_batch_size', '50', 'number'),
  ('rp-7', 'rv-2027-1', 'practical_completion_days', '3', 'number'),
  ('rp-8', 'rv-2027-1', 'fairness_window_days', '365', 'number'),
  ('rp-9', 'rv-2027-1', 'seniority_mode', '"block_then_district"', 'string'),
  ('rp-10', 'rv-2027-1', 'block_priority_mode', '"none"', 'string'),
  ('rp-11', 'rv-2027-1', 'designation_priority_order', '["HM","PRINCIPAL","SENIOR_PG","PG"]', 'json'),
  ('rp-12', 'rv-2027-1', 'hm_fallback_designations', '["SENIOR_PG"]', 'json'),
  ('rp-13', 'rv-2027-1', 'chief_preferred_designations', '["PRINCIPAL","HM"]', 'json'),
  ('rp-14', 'rv-2027-1', 'chief_fallback_designations', '["SENIOR_PG"]', 'json'),
  ('rp-15', 'rv-2027-1', 'scoring_weights', '{"recent_duty":5,"repeated_duty":3,"distance":1,"workload":2,"role_balance":1}', 'json'),
  ('rp-16', 'rv-2027-1', 'role_switch_mode', '"soft"', 'string'),
  ('rp-17', 'rv-2027-1', 'hall_designation_allowlist', '[]', 'json'),
  ('rp-18', 'rv-2027-1', 'missing_coordinates_policy', '"INELIGIBLE"', 'string');

INSERT INTO permissions (permission_id, code, description) VALUES
  ('p-master-read', 'master.read', 'Read master data'),
  ('p-master-write', 'master.write', 'Write master data'),
  ('p-import', 'import.apply', 'Apply Excel imports'),
  ('p-generate', 'allocation.generate', 'Generate allocations'),
  ('p-override', 'allocation.override', 'Manual overrides'),
  ('p-approve', 'allocation.approve', 'Approve/publish'),
  ('p-backup', 'backup.manage', 'Backup and restore'),
  ('p-audit', 'audit.read', 'Read audit log'),
  ('p-users', 'users.manage', 'Manage users'),
  ('p-rules', 'rules.manage', 'Manage rule versions');

INSERT INTO role_permissions (role, permission_id) VALUES
  ('VIEWER', 'p-master-read'),
  ('VIEWER', 'p-audit'),
  ('DATA_OPERATOR', 'p-master-read'),
  ('DATA_OPERATOR', 'p-master-write'),
  ('DATA_OPERATOR', 'p-import'),
  ('DATA_OPERATOR', 'p-audit'),
  ('OFFICER', 'p-master-read'),
  ('OFFICER', 'p-master-write'),
  ('OFFICER', 'p-import'),
  ('OFFICER', 'p-generate'),
  ('OFFICER', 'p-override'),
  ('OFFICER', 'p-approve'),
  ('OFFICER', 'p-backup'),
  ('OFFICER', 'p-audit'),
  ('ADMIN', 'p-master-read'),
  ('ADMIN', 'p-master-write'),
  ('ADMIN', 'p-import'),
  ('ADMIN', 'p-generate'),
  ('ADMIN', 'p-override'),
  ('ADMIN', 'p-approve'),
  ('ADMIN', 'p-backup'),
  ('ADMIN', 'p-audit'),
  ('ADMIN', 'p-users'),
  ('ADMIN', 'p-rules');

INSERT INTO users (user_id, external_subject, email, display_name, role, active, created_at, updated_at)
VALUES
  ('user-admin', 'dev-admin', 'admin@example.local', 'Synthetic Admin', 'ADMIN', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('user-officer', 'dev-officer', 'officer@example.local', 'Synthetic Officer', 'OFFICER', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('user-operator', 'dev-operator', 'operator@example.local', 'Synthetic Operator', 'DATA_OPERATOR', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('user-viewer', 'dev-viewer', 'viewer@example.local', 'Synthetic Viewer', 'VIEWER', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
