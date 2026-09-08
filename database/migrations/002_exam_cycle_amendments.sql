-- Amendment linkage for published-cycle corrections (never mutate published rows in place).
ALTER TABLE exam_cycles ADD COLUMN amended_from_id TEXT REFERENCES exam_cycles(exam_cycle_id);
ALTER TABLE exam_cycles ADD COLUMN amendment_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_exam_cycles_amended_from ON exam_cycles(amended_from_id);
