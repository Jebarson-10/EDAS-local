-- A practical batch key (school|subject|index) is only unique inside one exam
-- cycle. Holding batch_id as a global PRIMARY KEY meant the second cycle to
-- reuse a school/subject pair could never persist its batches: the insert hit
-- UNIQUE constraint failed: practical_batches.batch_id, the run showed
-- "Not persisted", and pair memory never updated.
--
-- Rebuild both tables so the identity is (exam_cycle_id, batch_id), and carry
-- the cycle on practical_schedules so a schedule can only join its own cycle's
-- batch. SQLite/D1 need the copy-drop-rename dance for this.

CREATE TABLE practical_batches_new (
  batch_id TEXT NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(exam_cycle_id),
  school_id TEXT NOT NULL REFERENCES schools(school_id),
  subject_id TEXT NOT NULL REFERENCES subjects(subject_id),
  student_count INTEGER NOT NULL,
  batch_index INTEGER NOT NULL,
  PRIMARY KEY (exam_cycle_id, batch_id)
);

INSERT INTO practical_batches_new
  (batch_id, exam_cycle_id, school_id, subject_id, student_count, batch_index)
SELECT batch_id, exam_cycle_id, school_id, subject_id, student_count, batch_index
FROM practical_batches;

-- Staging table without foreign keys: the composite parent key does not exist
-- until the rename below, so an FK-bearing insert would fail here.
CREATE TABLE practical_schedules_stage (
  schedule_id TEXT NOT NULL,
  exam_cycle_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  exam_date TEXT NOT NULL,
  session_code TEXT NOT NULL,
  internal_examiner_id TEXT NOT NULL,
  external_examiner_id TEXT NOT NULL,
  run_id TEXT
);

INSERT INTO practical_schedules_stage
  (schedule_id, exam_cycle_id, batch_id, exam_date, session_code,
   internal_examiner_id, external_examiner_id, run_id)
SELECT sch.schedule_id, pb.exam_cycle_id, sch.batch_id, sch.exam_date,
       sch.session_code, sch.internal_examiner_id, sch.external_examiner_id,
       sch.run_id
FROM practical_schedules sch
INNER JOIN practical_batches pb ON pb.batch_id = sch.batch_id;

DROP TABLE practical_schedules;
DROP TABLE practical_batches;
ALTER TABLE practical_batches_new RENAME TO practical_batches;

CREATE TABLE practical_schedules (
  schedule_id TEXT PRIMARY KEY,
  exam_cycle_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  exam_date TEXT NOT NULL,
  session_code TEXT NOT NULL CHECK (session_code IN ('MORNING','AFTERNOON')),
  internal_examiner_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  external_examiner_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  run_id TEXT REFERENCES allocation_runs(run_id),
  FOREIGN KEY (exam_cycle_id, batch_id)
    REFERENCES practical_batches(exam_cycle_id, batch_id)
);

INSERT INTO practical_schedules
  (schedule_id, exam_cycle_id, batch_id, exam_date, session_code,
   internal_examiner_id, external_examiner_id, run_id)
SELECT schedule_id, exam_cycle_id, batch_id, exam_date, session_code,
       internal_examiner_id, external_examiner_id, run_id
FROM practical_schedules_stage;

DROP TABLE practical_schedules_stage;

CREATE INDEX idx_practical_batches_cycle ON practical_batches(exam_cycle_id);
CREATE INDEX idx_practical_schedules_cycle
  ON practical_schedules(exam_cycle_id, batch_id);
CREATE INDEX idx_practical_schedules_run ON practical_schedules(run_id);
