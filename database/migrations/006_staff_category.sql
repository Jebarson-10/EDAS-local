-- Keeps teaching and non-teaching staff in separate eligibility pools.
ALTER TABLE teachers ADD COLUMN staff_category TEXT NOT NULL DEFAULT 'TEACHING'
  CHECK (staff_category IN ('TEACHING', 'NON_TEACHING'));

-- Existing installations have already run the reference seed. Add the new
-- catalogue items and rule values idempotently without changing old history.
INSERT OR IGNORE INTO duty_types (duty_type_id, code, name, module) VALUES
  ('dt-theory-office', 'OFFICE_STAFF', 'Office Staff', 'THEORY'),
  ('dt-custodian', 'CUSTODIAN', 'Custodian', 'THEORY');

INSERT OR IGNORE INTO rule_parameters (id, rule_version_id, param_key, param_value, value_type)
SELECT 'rp-19', 'rv-2027-1', 'department_officer_second_threshold', '500', 'number'
WHERE EXISTS (SELECT 1 FROM rule_versions WHERE rule_version_id = 'rv-2027-1');
INSERT OR IGNORE INTO rule_parameters (id, rule_version_id, param_key, param_value, value_type)
SELECT 'rp-20', 'rv-2027-1', 'office_staff_per_centre', '2', 'number'
WHERE EXISTS (SELECT 1 FROM rule_versions WHERE rule_version_id = 'rv-2027-1');
INSERT OR IGNORE INTO rule_parameters (id, rule_version_id, param_key, param_value, value_type)
SELECT 'rp-21', 'rv-2027-1', 'custodian_schools_per_custodian', '10', 'number'
WHERE EXISTS (SELECT 1 FROM rule_versions WHERE rule_version_id = 'rv-2027-1');
