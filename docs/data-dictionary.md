# Data Dictionary

All identifiers are opaque UUIDs unless noted. Timestamps are ISO-8601 UTC. Soft history uses `effective_from` / `effective_to` (null `effective_to` = current).

## Core geography / org

### blocks
| Column | Type | Notes |
|--------|------|-------|
| block_id | TEXT PK | |
| block_code | TEXT UNIQUE | |
| block_name | TEXT | |
| active | INTEGER | 0/1 |
| created_at, updated_at | TEXT | |

Read path: `GET /api/blocks` (`master.read`). Boot hydrate replaces the demo
block list so school/centre `block_id` values resolve after restore.

### schools
| Column | Type | Notes |
|--------|------|-------|
| school_id | TEXT PK | |
| school_code | TEXT UNIQUE | |
| school_name | TEXT | |
| block_id | TEXT FK | |
| address | TEXT | |
| latitude, longitude | REAL | nullable |
| school_type | TEXT | |
| active | INTEGER | |
| data_quality | TEXT | Confirmed / Unverified / Imported / ManuallyCorrected / Derived |
| created_at, updated_at | TEXT | |

### centres
| Column | Type | Notes |
|--------|------|-------|
| centre_id | TEXT PK | |
| centre_code | TEXT UNIQUE | |
| centre_name | TEXT | |
| block_id | TEXT FK | |
| address | TEXT | |
| latitude, longitude | REAL | |
| capacity | INTEGER | |
| active | INTEGER | |
| data_quality | TEXT | |
| created_at, updated_at | TEXT | |

### centre_school_relationships
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| centre_id | TEXT FK | |
| school_id | TEXT FK | |
| relationship_type | TEXT | e.g. CLUBBED, HOST |
| effective_from | TEXT | |
| effective_to | TEXT | nullable |
| source_import_id | TEXT | nullable |

Key-present replace (`centre_school_relationships` or `relationships`).
`includeHistory=true` still clears the table so school/centre delete stays
FK-safe.

## Teachers

### teachers (current state)
| Column | Type | Notes |
|--------|------|-------|
| teacher_id | TEXT PK | |
| employee_code | TEXT UNIQUE | |
| name | TEXT | |
| school_id | TEXT FK | current |
| designation | TEXT | |
| subject | TEXT | nullable |
| seniority_rank | INTEGER | nullable |
| joining_date | TEXT | nullable |
| home_latitude, home_longitude | REAL | sensitive |
| is_active | INTEGER | |
| data_quality | TEXT | |
| created_at, updated_at | TEXT | |

### teacher_school_history
teacher_id, school_id, effective_from, effective_to, source_import_id, created_at

Canonical restore wipes leftovers when `teacher_school_history` (or
`schoolHistory`) is present; omitting the key leaves live rows unless
`includeHistory` is true (FK hygiene before teacher delete).

### teacher_designation_history
teacher_id, designation, effective_from, effective_to, source_import_id, created_at

Same key-present replace as school history (`teacher_designation_history` /
`designationHistory`).

### teacher_location_history
teacher_id, location_type, latitude, longitude, effective_from, effective_to, source_import_id, created_at

Same key-present replace (`teacher_location_history` / `locationHistory`).
Display hydrate only — not scored (OQ-001 / OQ-004).

### teacher_exemptions
id, teacher_id, is_exempted, reason, effective_from, effective_to, source, created_at, created_by

Read path: `GET /api/exemptions` (`master.read`). When the snapshot includes
`teacher_exemptions` or the `exemptions` alias, restore wipes leftovers then
reloads that array (empty array clears live rows). Old or offline payloads
that omit the key leave live exemptions when `includeHistory` is false.
`includeHistory=true` still deletes the table as FK hygiene before teacher
delete.

## Subjects & duties

### subjects
subject_id, code, name, is_practical, active

Read path: `GET /api/subjects` (`master.read`). Seed catalogue plus any rows
restored from a canonical backup. When the snapshot includes the `subjects`
key, restore wipes leftovers then reloads that array (seed stays if an old
backup omits the key). Not the exam-cycle timetable (`exam_subjects` stays
unwritten — OQ-020).

### duty_types
duty_type_id, code, name, module (THEORY|PRACTICAL|HALL)

## Exam cycle

### exam_cycles
exam_cycle_id, name, academic_year, standard, start_date, end_date, status, rule_version_id, created_at, created_by

Statuses: DRAFT, OPEN, ALLOCATION_GENERATED, UNDER_REVIEW, APPROVED, PUBLISHED, LOCKED, ARCHIVED

Read path: `GET /api/exam-cycles` (`master.read`). When a snapshot includes
the `exam_cycles` key, restore wipes leftover cycle rows then reloads that
array (live cycles stay if an old backup omits the key).

### exam_days / exam_sessions / exam_subjects
Normalized schedule and subject links for a cycle. Intentionally unwritten
(OQ-020). Restore may `DELETE` these only as FK hygiene when replacing
`exam_cycles`; it does not invent timetable rows.

## Rules

### rule_versions
rule_version_id, version_label, description, created_at, created_by, is_active

Read path: `GET /api/rule-versions` (`master.read`). Canonical restore wipes
leftover versions when both `rule_versions` and `rule_parameters` keys are
present, then reloads both.

### rule_parameters
id, rule_version_id, param_key, param_value (JSON text), value_type

## Allocation

### allocation_runs
run_id, exam_cycle_id, rule_version_id, algorithm_version, module, input_snapshot_id, seed, created_by, created_at, status, validation_status

Read path: `GET /api/allocation-runs`. Canonical restore wipes leftovers
when `allocation_runs` is present (empty array clears live rows). Old or
offline payloads that omit the key leave live runs when `includeHistory`
is false, unless the snapshot is also replacing `exam_cycles` or
`rule_versions` (NOT NULL FKs — children wipe first).

### allocation_run_results
result_id, run_id, assignment payload fields, decision_trace (JSON), is_override, final_* fields

Same key-present replace as runs; also cleared when runs are wiped.

### allocation_decision_reasons
id, result_id, rule_code, severity, message, details JSON

Same key-present replace; also cleared when results are wiped.

### input_snapshots
snapshot_id, run_id, payload_hash, storage_key (R2) or inline JSON for small fixtures, created_at

Key-present replace. When snapshots are replaced but runs are not, restore
sets `allocation_runs.input_snapshot_id` to NULL (nullable FK) instead of
dropping live runs.

### manual_overrides
override_id, run_id, result_id, changed_by, changed_at, reason, old_value, new_value

### duty_assignments / duty_assignment_history
Normalized durable duty events for conflict engine and future history (published/locked only promote to permanent history).

`duty_assignments` follows key-present replace. Also cleared when replacing
`exam_cycles` or `allocation_runs`, or when `includeHistory` deletes
teachers. `duty_assignment_history` leftovers wipe only when restore sets
`includeHistory=true`; the default path preserves published history.

## Practical

### practical_batches
batch_id, exam_cycle_id, school_id, subject_id, student_count, batch_index

Key-present replace. Also cleared when replacing `exam_cycles` or
`subjects`, or when `includeHistory` deletes schools (NOT NULL FKs).

### practical_schedules
schedule_id, batch_id, date, session, internal_examiner_id, external_examiner_id, run_id

Key-present replace. Also cleared when batches or runs are wiped, or when
`includeHistory` deletes teachers.

### examiner_pairs
pair_id, teacher_a_id, teacher_b_id, subject_id, school_id, academic_year, internal_teacher_id, external_teacher_id, exam_cycle_id

Read path: `GET /api/examiner-pairs`. Key-present replace like exemptions.
Omitting the key leaves live pair memory when `includeHistory` is false.
`includeHistory=true` or a `subjects` replace still clears the table so
teacher/subject delete stays FK-safe.

## Import / audit / backup

### source_imports
import_id, filename, file_hash, uploaded_by, uploaded_at, exam_cycle_id, row_count, status, r2_key

Read path: `GET /api/imports` (`audit.read`). Included in the canonical backup
and reloaded by `transactionalRestore` when the snapshot contains the key.

### source_import_rows
row-level validation outcomes

Read path: `GET /api/imports/:id/rows` (`audit.read`). Restored with
`source_imports` when the backup archived them.

### audit_logs
audit_id, user_id, action, entity, entity_id, timestamp, old_value, new_value, reason, ip/meta

Read path: `GET /api/audit` (`audit.read`). Canonical restore wipes leftovers
when the snapshot has `audit_logs` as `[]` or as persisted rows (`audit_id`).
A session-trail array (Backup page `id` / `detail`) is not this table and
does not replace live rows.

### users / roles / permissions
Managed identity subject mapped to local role grants

### backup_records / export_records
`export_records` are download *receipts* (type, cycle, run, officer) — not
the workbook/PDF/CSV itself. `POST /api/exports` requires `master.write`
(VIEWER is 403); `GET /api/exports` stays `audit.read`. Listed receipts
are included in the canonical backup. `backup_records` describe server
archives themselves and are not restored from a payload.

## Data quality enum

`Confirmed` | `Unverified` | `Imported` | `ManuallyCorrected` | `Derived`
