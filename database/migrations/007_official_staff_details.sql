-- Retains non-allocation fields from the CEO's official staff return.
ALTER TABLE teachers ADD COLUMN official_details_json TEXT;

-- The official return's school reference is not an examination-centre code.
ALTER TABLE schools ADD COLUMN source_school_code TEXT;
CREATE INDEX idx_schools_source_school_code ON schools(source_school_code);
