# Disaster Recovery

## Protection goals

Survive laptop/browser failure, accidental deletion/import mistakes, bad allocation runs, overwrite attempts, and cloud data issues.

## Layers

1. **Live D1** — operational source of truth
2. **R2 archives** — source Excels, published allocations, backups, audit exports
3. **Officer downloadable encrypted backup** — offline contingency
4. **D1 Time Travel** (Free: documented retention window) — platform-level recovery aid

## Automatic archival backups

After APPROVED / PUBLISHED / LOCKED transitions, create an archival backup to R2.

## Manual backup

Admin/Officer can trigger backup anytime.

## Backup contents (minimum)

Encrypted officer download and API/R2 JSON archives include at least:

- metadata (cycle, timestamps, note)
- teachers, schools, centres, centre↔school relationships
- duty / published history
- allocation runs, results, input snapshots, and decision reasons (when present)
- practical batches/schedules, manual overrides, open duty_assignments
- examiner pair memory (`examiner_pairs`) that drives the annual practical role switch
- audit trail (up to recent window in canonical server backup)
- active rule version label / parameters snapshot
- upload provenance (`source_imports`, `source_import_rows`) and export receipts
  (`export_records`) — the tables Audit reads via GET `/api/imports` and
  `/api/exports`

New canonical archives always include those provenance arrays (they may be
empty). Restore then wipes and reloads them so a same-DB overwrite does not
leave uploads that happened after the snapshot, and a fresh database comes back
with the Audit drill-down. Archives taken before this field existed omit the
keys; restore leaves live provenance intact rather than inventing an empty
wipe. The audit trail still records every apply and export.

The same key-present replace applies to `subjects` and `rule_parameters`.
Canonical snapshots always include those arrays. Upsert-only restore used to
leave rows inserted after the snapshot (an extra subject, an extra parameter
on the live rule version). Those leftovers would show up on GET `/api/subjects`
and in boot-hydrated rules. Old backups that omit the keys still leave seed
subjects and live parameters in place.

`exam_cycles` and `rule_versions` follow the same pattern. They were
upsert-only, so a cycle or version created after the snapshot survived
same-DB restore and appeared on GET `/api/exam-cycles` / GET `/api/rule-versions`.
Boot hydrate prefers the leftover seed cycle id when it is still present.
Canonical archives always include both arrays; restore wipes leftovers then
reloads. Versions are wiped only when `rule_parameters` is also present, so
an old snapshot that has versions but omits parameters cannot drop live
parameter rows. `exam_days` / `exam_sessions` (unwritten — OQ-020) are
cleared only as FK hygiene so a leftover cycle row can be deleted; they are
not filled. `audit_logs` wipe when the snapshot includes that key, including
an empty array (previously only a non-empty audit list triggered the wipe).
Session-shaped rows (`id` / `detail`, no `audit_id`) are the Backup page's
in-browser trail, not `audit_logs`. They do not trigger that wipe and are
not inserted. Encrypted officer download uses the server-canonical snapshot
when the API is up so the `.bin` includes the same collections as R2.

`teacher_exemptions` and `teacher_*_history` follow the same key-present
replace. They used to be deleted on every restore, so a local-built
contingency (or an old snapshot that omitted those keys) dropped live
GET `/api/exemptions` and teacher school/designation/location history.
Canonical archives always include the arrays; restore wipes leftovers then
reloads, including an empty array. Old or offline payloads that omit the
keys leave live rows when `includeHistory` is false. `includeHistory=true`
still clears those child tables so teacher delete stays FK-safe.
`duty_assignment_history` leftovers wipe only when `includeHistory` is
true; the default path still preserves published history.

Allocation runs, results, decision reasons, input snapshots, practical
batches/schedules, examiner pairs, manual overrides, duty_assignments, and
centre↔school relationships use the same key-present contract. They used
to be deleted on every restore, so a local-built contingency (or an old
snapshot that omitted those keys) dropped live GET `/api/allocation-runs`
and pair memory. Canonical archives always include the arrays. Omitting
the keys leaves live rows when `includeHistory` is false. Wiping a parent
still clears children first: replacing `exam_cycles` or `rule_versions`
clears runs (NOT NULL FKs); replacing `subjects` or deleting teachers on
`includeHistory=true` clears pairs, batches, and schedules. Snapshot-only
replace unlinks `allocation_runs.input_snapshot_id` instead of dropping
runs.

CSV tabular exports remain available via the Reports module for officers; the encrypted contingency backup uses structured JSON for transactional restore.

## Restore procedure

```text
Upload backup → Validate checksum/schema → Preview → Admin confirmation → Transactional restore
```

Offline preflight (no API):

```bash
npm run verify:backup -- path/to/backup.json
npm run verify:backup -- path/to/backup.json --expect-checksum <sha256>
```

Server archives: `POST /api/backups` with `{ "fromServer": true }`, list via `GET /api/backups`, download via `GET /api/backups/:id`.

Never partially restore silently. Failed validation aborts entirely.

Transactional restore deletes FK children before parents (practical schedules → runs,
overrides → results) so **same-database** overwrite (staging/production DR) succeeds
with foreign keys enabled — not only restore onto an empty database.

## Published data

Published allocations remain immutable; restore must not silently rewrite published history without an audited admin restore path.
