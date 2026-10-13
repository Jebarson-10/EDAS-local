-- Explicit school level for higher-secondary chief eligibility. Old rows stay intact.
ALTER TABLE schools ADD COLUMN school_level TEXT;
