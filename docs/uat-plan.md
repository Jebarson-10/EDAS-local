# UAT Plan

## Principles

1. Synthetic data first.  
2. Client real data only in controlled staging.  
3. Never put real PII into GitHub.

## Verify

- Counts: teachers, schools, centres, blocks  
- Historical assignments auto-loaded  
- Theory / practical / hall results correctness vs officer expectations  
- Reports (Excel/PDF)  
- Manual overrides + audit  
- Backup and restore  
- Role-based access  
- Publish lock / immutability  

## Sign-off

Record cycle name, rule version, run IDs, officer name, date, defects, and acceptance decision. Production promote requires explicit approval.

## Local synthetic evidence (not §107 complete)

```bash
npm run uat:local          # writes .data/uat-local-latest.json
npm run check:bindings     # fails while REPLACE_ME placeholders remain
npm run check:bindings -- --env staging   # gate before remote migrate
```

`uat:local` proves inventable UAT checks (restore, allocate, validate, persist reasons,
publish, backup, Access role policy, **same-DB FK-safe restore**, stored rule
parameters, hydrate-failure classification, **blocks/subjects list after restore**,
**import provenance + export receipts survive same-DB restore**, **empty D1 lists
do not reuse demo history**, **leftover subjects/rule_parameters drop on
canonical restore**, **leftover exam_cycles/rule_versions drop on
canonical restore**, **session-shaped `audit_logs` do not wipe persisted
audit**, **leftover `teacher_exemptions` drop when the key is present**,
**omitting `teacher_exemptions` leaves live rows**, **`includeHistory=true`
drops leftover `duty_assignment_history`**, **omitting `allocation_runs` /
`examiner_pairs` leaves live rows while a canonical payload still replaces
leftovers**, **theory fallback and practical role-switch hydrate from
persisted traces**, **theory/hall shortage objects and requirementKey
hydrate from persisted summary/reasons**, **validation Valid and leftover
UNK practical subject hydrate from persist**, **generate `date`/`duty` persist onto
`examDate`/details and conflicts are stored once**, **hall shortage
`centreId` does not inherit a filled slot's Teacher/When**, **override Why
names the replacement teacher after persist/hydrate**, **override drops
INFO-SELECTED from listed decision reasons**, **practical publish writes
`PRACTICAL_EXTERNAL` into duty history**, **hall/practical review tables
show every persisted slot and hall publish writes invigilator + standby
history**, **publish/calendar ignore leftover INVALID runs from the previous
cycle**) on
synthetic data.
Live Cloudflare D1/R2, Access IdP, and human staging sign-off remain required for §107.
