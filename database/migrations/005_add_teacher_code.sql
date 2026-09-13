-- Migration 005: Add teacher_code column
-- Government-issued teacher identifier (e.g., EMIS code)
-- Nullable, unique where non-null

ALTER TABLE teachers ADD COLUMN teacher_code TEXT;
CREATE UNIQUE INDEX idx_teachers_teacher_code
  ON teachers(teacher_code) WHERE teacher_code IS NOT NULL;
