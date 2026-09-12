-- Keep old identifiers and duty records. A school's public code is its centre code.
-- __school_ keys are private storage keys for schools without a centre code.
INSERT INTO centres (centre_id, centre_code, centre_name, block_id, latitude, longitude, active, data_quality, created_at, updated_at)
SELECT 'centre_' || school_id, school_code, school_name, block_id, latitude, longitude, active, data_quality, created_at, updated_at
FROM schools WHERE trim(school_code) <> '' AND substr(school_code, 1, 9) <> '__school_'
ON CONFLICT(centre_code) DO UPDATE SET centre_name=excluded.centre_name, block_id=excluded.block_id,
 latitude=excluded.latitude, longitude=excluded.longitude, active=excluded.active;

UPDATE centres SET active=0 WHERE NOT EXISTS (
 SELECT 1 FROM schools s WHERE s.school_code=centres.centre_code AND s.active=1
 AND trim(s.school_code)<>'' AND substr(s.school_code,1,9)<>'__school_'
);

INSERT INTO centre_school_relationships (id, centre_id, school_id, relationship_type, effective_from, created_at)
SELECT 'host_' || s.school_id, c.centre_id, s.school_id, 'HOST', date('now'), datetime('now')
FROM schools s JOIN centres c ON c.centre_code=s.school_code
WHERE c.active=1 AND NOT EXISTS (
 SELECT 1 FROM centre_school_relationships r WHERE r.centre_id=c.centre_id
 AND r.school_id=s.school_id AND r.relationship_type='HOST' AND r.effective_to IS NULL
);
