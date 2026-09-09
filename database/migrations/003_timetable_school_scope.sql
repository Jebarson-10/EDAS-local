-- A timetable row may apply district-wide (NULL) or to a selected school.
-- The school picker is populated from the operator's own master-school list.
ALTER TABLE exam_timetable_entries ADD COLUMN school_id TEXT REFERENCES schools(school_id);
CREATE INDEX idx_exam_timetable_school ON exam_timetable_entries(school_id);
