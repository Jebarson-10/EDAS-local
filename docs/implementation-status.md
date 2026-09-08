# Implementation status

Tracked against master specification §107. **Goal remains open** until live Cloudflare bindings, Access, UAT, and client open-question answers are evidenced.

**Hunts frozen (operator instruction).** Treat this HEAD as the local slice. Do not start another inventable-gap hunt, restore-leftover pass, or hydrate-honesty audit unless a named defect is reported. Remaining work is only [`docs/client-inputs-checklist.md`](client-inputs-checklist.md): live D1/R2 ids, Access/`ACCESS_EMAIL_ROLE_MAP` (OQ-010), staging UAT on bound D1/R2, client answers in [`docs/open-questions.md`](open-questions.md), and explicit human production promote.

## Done (repo + automated evidence)

| Area                                                                   | Evidence                                                                                                                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical schema + import apply without delete                        | `database/migrations`, `shared/importApply` tests                                                                                                  |
| Deterministic theory/practical/hall engines                            | `allocation-engine` + adversarial tests (incl. Case 15)                                                                                            |
| Independent validators (theory/practical/hall) + conflicts             | `validator` (+ practical/hall tests)                                                                                                               |
| Rule versions + allocation runs                                        | seeds + UI + Worker persist routes                                                                                                                 |
| Excel .xlsx import/preview/apply                                       | Import UI + ExcelJS                                                                                                                                |
| Excel + PDF reports (no home coords)                                   | Reports: theory xlsx/PDF + practical/hall CSV + Duty-In/Out layouts                                                                                |
| Client sample format alignment                                         | `docs/client-sample-formats.md` + `shared/clientFormats` apply paths (clubbing, strength, FORM-01 SYN codes, batch demand) — no client PII in repo |
| AuthAdapter (Access vs X-Dev-*)                                        | `worker/src/auth/adapter.ts` + unit tests; local API uses same adapter                                                                             |
| Rule version clone + activate (ADMIN)                                  | `POST /api/rule-versions` + `/activate` + Settings UI                                                                                              |
| Exam-cycle status persisted with workflow graph                        | `POST /api/exam-cycles/:id/status` + UI sync; publish uses force                                                                                   |
| Backup SHA-256 checksum                                                | Worker + local API `backup_records.checksum`                                                                                                       |
| Pages `_routes.json` + CSP                                             | `frontend/public/_routes.json` includes `/api/*`; CSP in `_headers`                                                                                |
| Validation UI surfaces conflict engine                                 | Validation page conflicts panel                                                                                                                    |
| Publish → history + immutability + amendment                           | Exam cycle workflow + `npm run e2e:cycle`                                                                                                          |
| Import apply persists to D1/SQLite                                     | `POST /api/imports/apply` + Import UI                                                                                                              |
| Manual override row in DB                                              | `POST /api/manual-overrides` + Theory override                                                                                                     |
| Master list APIs                                                       | `GET /api/teachers`, `/schools`, `/centres`, `/blocks`, `/subjects`                                                                                |
| Zod request body validation                                            | `shared/src/validation.ts` on Worker + local API                                                                                                   |
| Officer / admin guides                                                 | `docs/officer-guide.md`, `docs/admin-guide.md`                                                                                                     |
| Post-publish archival backup trigger                                   | Exam cycle publish → `backupApi`                                                                                                                   |
| Practical / hall generate on full demo dataset                         | Practical/Hall pages + persist to API                                                                                                              |
| Clubbing apply → SQLite/D1 (close prior CLUBBED; never delete HOST)    | `POST /api/relationships/clubbing` + Import UI                                                                                                     |
| Centre strength → capacity persist                                     | `POST /api/centres/capacity` + Import UI                                                                                                           |
| Practical batches + schedules persist                                  | `POST /api/practical-batches` on Practical generate                                                                                                |
| Teacher import upsert by employee_code (preserve teacher_id / history) | `upsertTeachers` + repos tests                                                                                                                     |
| Exam-cycle create / amendment persist (previous stays PUBLISHED)       | `POST /api/exam-cycles` + migration `002_exam_cycle_amendments`                                                                                    |
| Relationships list API                                                 | `GET /api/relationships`                                                                                                                           |
| Passphrase AES-GCM backup download (OQ-015)                            | `shared/backupCrypto` + Backup UI; server archives JSON + SHA-256                                                                                  |
| Exam cycle hydrate from API on load                                    | AppContext + `GET /api/exam-cycles`                                                                                                                |
| Duty history + exemptions + allocation-runs hydrate                    | `GET /api/history`, `/exemptions`, `/allocation-runs` (+ results); engines use API history/exemptions                                              |
| Teacher school/designation/location history persist + hydrate          | `POST /api/imports/apply` history arrays; `GET /api/teacher-history/*`                                                                             |
| Export download metadata (`export_records`)                            | `POST /api/exports` + Reports UI (all theory/practical/hall/letter exports)                                                                        |
| Backup restore reloads teacher_*_history                               | `transactionalRestore` + Backup payload includes school/designation/location history                                                               |
| Backup restore reloads exemptions                                      | `teacher_exemptions` in backup payload + restore                                                                                                   |
| Publish honors overrides; idempotent; refuses INVALID                  | `publishRunToHistory` uses `COALESCE(final_teacher_id, teacher_id)`                                                                                |
| Allocation input snapshots with SHA-256                                | Theory/Practical/Hall persist `snapshot`; `input_snapshots.payload_hash`                                                                           |
| Master list limits raised for district scale                           | Teachers 10k / schools+centres 5k defaults                                                                                                         |
| Source import provenance (`source_imports`)                            | `POST/GET /api/imports` writes SHA-256 + status; apply marks APPLIED                                                                               |
| CORS origin allowlist                                                  | `resolveCorsOrigin` — localhost in dev; `ALLOWED_ORIGINS` in staging/prod                                                                          |
| Zod request-body unit tests                                            | `shared/src/validation.test.ts`                                                                                                                    |
| End exemption from Master UI                                           | Upsert with `effectiveTo` + `isExempted: false`                                                                                                    |
| Server immutability gates on frozen cycles                             | `assertExamCycleMutable` on generate/override/practical/clubbing/capacity                                                                          |
| Atomic publish + cycle match + snapshot hash verify                    | `publishRunToHistory` via `runAtomic`; refuses mismatch/tamper                                                                                     |
| Server-canonical backup + list + checksum restore                      | `buildCanonicalBackup`, `GET /api/backups`, `expectedChecksum` on restore                                                                          |
| Restore rate limit + 20 MB body caps (local+worker)                    | Parity with Worker abuse controls                                                                                                                  |
| Publish practical + hall into duty history                             | Exam cycle publish folds VALID practical/hall runs + API publish each                                                                              |
| Restore exam_cycles + rule_versions/parameters                         | `transactionalRestore` + `buildCanonicalBackup` include rules/cycles                                                                               |
| Canonical backup includes runs + reasons + audit                       | `buildCanonicalBackup` / restore reloads snapshots, runs, results, reasons, audit                                                                  |
| Canonical backup includes practical + overrides + duty_assignments     | Restore no longer silently drops wiped tables                                                                                                      |
| Same-DB transactional restore (FK child→parent wipe order)             | `repos.test.ts` + `uat:local` UAT-11                                                                                                               |
| Master teachers/schools/centres hydrate from API                       | AppContext + list* includes coordinates                                                                                                            |
| Backup UI: catalog list + checksum-gated restore                       | BackupPage + `listBackupsApi` / `fetchBackupPayload`; Load only when the payload was stored                                                         |
| Worker restore 20 MB body cap (parity with local)                      | `worker/src/index.ts` 413                                                                                                                          |
| Bento-grid admin UI + shared surface primitives                        | `frontend/src/components/ui.tsx`, dashboard/theory/validation/reports/settings/backup tiles                                                        |
| Responsive render gate (420 / 820 / 1440 px)                           | `npm run check:responsive` in CI + `staging:preflight`                                                                                             |
| Global API/DB offline banner + real empty states                       | `AppShell` banner; `EmptyState` on theory/practical/hall/reports/validation/backups                                                                |
| GET `/api/manual-overrides`, GET `/api/exports`                        | `listManualOverrides` / `listExportRecords` + repos test                                                                                           |
| Audit page shows overrides, exports, import provenance                 | `AuditPage` bento tiles over the three GET surfaces                                                                                                |
| Examiner pair memory persisted per cycle (prior cycles kept)           | `persistPracticalBatches` writes `examiner_pairs`; repos tests + `uat:local` UAT-12/UAT-14                                                         |
| `GET /api/examiner-pairs` (both surfaces) + route inventory            | `listExaminerPairs`; `npm run check:routes`                                                                                                        |
| Pair memory in canonical backup + same-DB restore                      | `buildCanonicalBackup` / `transactionalRestore` `examiner_pairs`; UAT-15                                                                           |
| Practical page hydrates `pairHistory` (annual role switch)             | `fetchExaminerPairs` → `PracticalPage`; UAT-13 proves the next-cycle switch                                                                        |
| Cross-module duty calendar (no same-session double-booking)            | `shared/src/dutyCalendar.ts` + `crossModuleCalendar` on theory/practical/hall; UAT-16                                                              |
| Per-row import provenance (`source_import_rows`)                       | Apply stores each row's preview outcome; `insertSourceImportRows` + repos test                                                                     |
| `GET /api/imports/:id/rows` (both surfaces) + audit drill-down         | `listSourceImportRows`; AuditPage row-outcome table                                                                                                |
| Officer-set exam window (`exam_cycles.start_date`/`end_date`)          | `POST /api/exam-cycles/:id/window`; Exam Cycle tile; restore reloads it                                                                            |
| Rule parameters hydrated from D1 for the cycle's version               | `GET /api/rule-versions/:id/parameters`; `applyStoredRuleParameters`; Settings JSON                                                                |
| Boot hydrate failure banner (not silent demo fallback)                 | `hydrateReport` + AppShell `hydrate-banner` when API is up but a source missed                                                                     |
| Duty dates bound by the cycle window (theory/practical/hall)           | `shared/src/examWindow.ts` + tests; replaces hardcoded 2027 dates                                                                                  |
| Theory/hall use the open cycle's academic year                         | Was pinned to `"2027"`, so history lookback ignored the selected cycle                                                                             |
| Client input checklist (bindings, OQ-010, OQs, UAT, promote)           | `docs/client-inputs-checklist.md`                                                                                                                  |
| GET `/api/blocks` + `/api/subjects` + boot hydrate                     | Both API surfaces; AppContext replaces demo geography; Master Blocks/Subjects tabs; `countMaster`; UAT-21                                          |
| GET `/api/imports` + `/imports/:id/rows` use `audit.read`              | VIEWER can open Audit provenance; POST apply/upload stay `import.apply`; `authz.http.test`; UAT-22/23                                              |
| Location-history boot hydrate (display only)                           | AppContext + Import count + Backup payload; not fed into engines (OQ-001 / OQ-004)                                                                 |
| Hydrated-run `validation.conflicts` from `RULE-CONFLICT-*` reasons     | `conflictsFromPersistedReasons`; AppContext hydrate + Validation page; UAT-24                                                                      |
| Canonical backup includes import provenance + export receipts          | `source_imports` / `source_import_rows` / `export_records` in `buildCanonicalBackup`; same-DB restore; UAT-25                                      |
| Empty D1 lists replace demo seed (not silent fallback)                 | `pickAuthoritativeList`; AppContext hydrate; banner stays **failed-only**; UAT-26                                                                  |
| Canonical restore wipes leftover subjects + rule_parameters            | Same key-present pattern as provenance; old snapshots omit keys and leave seed; UAT-27                                                             |
| Canonical restore wipes leftover exam_cycles + rule_versions           | Same key-present pattern; versions only with `rule_parameters`; empty `audit_logs` also wipes leftovers; UAT-28                                    |
| Session-shaped `audit_logs` do not wipe persisted audit                | Restore requires `audit_id` (or empty array); Backup encrypted download uses canonical; UAT-29                                                     |
| Canonical restore wipes leftover `teacher_exemptions`                  | Key-present (empty or populated); old/offline omit leaves live rows; UAT-30/31                                                                     |
| Offline contingency omits exemption + teacher-history keys             | `buildOfflineContingencyPayload`; restoring a local-built file cannot drop GET `/api/exemptions`                                                   |
| `includeHistory=true` leftover `duty_assignment_history` wipe          | DELETE then reload; `includeHistory=false` still preserves; UAT-32                                                                                 |
| Canonical restore wipes leftover allocation runs + examiner pairs      | Key-present (empty or populated); omitted keys leave live rows when `includeHistory` is false; UAT-33                                              |
| Offline contingency omits run / pair / snapshot wipe-trigger keys      | `OFFLINE_CONTINGENCY_WIPE_TRIGGER_KEYS`; restoring a local-built file cannot drop GET `/api/allocation-runs`                                       |
| Hall hydrate reads persisted `slotIndex` from `decision_trace_json`    | `hallAssignmentsFromPersistedResults`; Hall page + hall CSV no longer invent a global slot from result order after restore/reload; UAT-34          |
| Theory/practical hydrate reads fallback + role-switch flags            | `theoryAssignmentsFromPersistedResults` / `roleSwitchAppliedFromPersisted`; persist folds `usedFallback` into `decision_trace_json`; Theory Fallback column, exception report, Practical Role-switch + CSV no longer invent `false` after restore/reload; UAT-35          |
| Theory/hall shortage objects + requirementKey hydrate                  | Persist writes shortage objects (required/eligible/shortage) into `summary_json` and RULE-SHORTAGE details; hydrate reads them (count-only summary stays empty — numbers are not invented); Theory shortage list, exception SHORTAGE rows, Hall Shortages stat, Validation Errors; requirementKey on the theory trace; UAT-36 |
| Validation Valid + leftover UNK practical subject                      | Persist writes `valid` on `summary_json`; hydrate reads it (row count is not invented). Leftover `UNK` batch subject does not beat persisted identity; UAT-38 |
| Boot hydrate `examCycle.ruleVersionLabel` from D1                      | `labelForRuleVersion` + GET `/api/rule-versions`; does not write `exam_cycles.rule_version_id` (OQ-021)                                            |
| Local demo seed skips when masters / history / frozen cycle exist      | `seedDemoDatasetIfEmpty`; leftover schools/centres/blocks/history/runs, leftover snapshots/imports/exports/persisted audit, or a PUBLISHED/LOCKED/ARCHIVED cycle block remaster; empty `audit_logs` and session-shaped rows (no `audit_id`) do not; UAT-42–46 |
| Worker + local restore pass payload unchanged                          | Both call `transactionalRestore(parsed.data.payload)`; `restoreBodySchema` keeps nested keys                                                       |
| GET `/api/practical-batches` + UI hydrate practical/hall               | AppContext reconstructs results after reload for publish                                                                                           |
| HTTP AuthZ integration tests                                           | `worker/src/authz.http.test.ts` — VIEWER/DATA_OPERATOR 403 paths                                                                                   |
| `npm run staging:preflight`                                            | routes + bindings report + typecheck + test + e2e + uat:local                                                                                      |
| GET `/api/backups/:id` download                                        | Streams stored JSON with checksum header (local file / R2)                                                                                         |
| Audit hydrate on boot                                                  | AppContext merges `GET /api/audit` into session trail                                                                                              |
| Offline `npm run verify:backup`                                        | Checksum + schema/ref validation without restore                                                                                                   |
| Persist decision reasons + conflicts                                   | `allocation_decision_reasons` via run POST; `GET …/reasons`; Validation UI                                                                         |
| Generate `date`/`duty` survive persist                                 | Schema accepts generate aliases; `validationFindingsFromRunBody` maps `date`→`examDate` and keeps `duty` on details (not as session); unmatched shortages do not inherit `results[0]` When; issue+conflict posts store one `RULE-CONFLICT-*` row; UAT-54 |
| Hall shortage `centreId` is not assignment identity                    | Persist matches findings only when `teacherId` is present; hall shortages stay unmatched (one row, blank Teacher/When) instead of attaching to every filled slot at that centre; read overlay also blanks validator rows without `details.teacherId`; UAT-55 |
| Same-message shortages stay one row per centre/requirement             | `mergeValidationFindings` still collapses generate issue+conflict (same rule/teacher/date/message). Distinct `centreId` / `requirementKey` no longer share that key, so hall/theory shortages persist separately with blank Teacher/When; same-day conflicts with different sessions are kept; UAT-56 |
| Practical/hall generate in-flight signal                               | Same `busy` / Generating… disable as theory so a hydrated Feasible + enabled button cannot look like this generate finished; smoke waits for Generating… and a pipeline run-id change; UAT-58 |
| Primary write in-flight disable                                        | Publish, import apply, clubbing, capacity, restore, archive, cycle status/amend, override, exemptions, and window save disable + busy label until persist settles; smoke waits for Applying…/Publishing…/Saving…/Archiving…/Creating…; UAT-59 |
| Settings + export in-flight disable                                    | Rule-version create/activate and report/duty-letter exports disable + busy label until persist settles; smoke waits for Creating…/Activating…/Exporting…; UAT-60 |
| Import apply waits for archive; `row_count` is file rows               | Upload is awaited (apply disabled while Uploading…); sample/FORM-01 clear `lastImportId`; `X-Row-Count` on POST `/api/imports`; apply writes file-row `row_count` not roster upsert; UAT-61 |
| Sample/JSON apply does not invent `imp_*`; audit file vs outcomes      | `applyImportPreview` no longer `createId("imp")`; history `sourceImportId` empty without an archive; textarea edits clear `lastImportId`; Audit lists file rows and drill-down caption is file rows vs outcomes (MISSING extra); UAT-62 |
| Export receipts are writes, not archived files                         | `POST /api/exports` requires `master.write` (VIEWER 403); GET stays `audit.read`. Reports surfaces receipt ok/fail and no longer claims the download is archived or always traceable. Audit lists receipts only. Local insert miss is 503 like Worker. UAT-63 |
| Worker `stored:false` backup/import receipts stay honest               | Worker already returns `stored` + inline `payload` when FILES is unbound. UI no longer calls that a server/file archive; encrypted download uses the inline canonical snapshot instead of the memory contingency. Local api:local still `stored: true`. UAT-65 |
| Unstored catalog rows cannot be loaded for restore                     | List uses `status`/`r2_key` (`RECORDED_NO_R2` is not a file even when `r2_key` is set). Load is disabled; GET `/api/backups/:id` is 404 without a snapshot body. `fetchBackupPayload` refuses error JSON. UAT-66 |
| Honest `/api/health` binding probe                                     | `ok`/`dbOk`/`r2Ok` (503 when D1 fails; local `r2Ok: null`); Settings/Dashboard surface                                                             |
| Worker ↔ local route inventory                                         | `worker/src/apiRoutes.ts` + `npm run check:routes`                                                                                                 |
| Teacher upsert employee_code collision-safe                            | Prefer natural key; no UNIQUE failure on dual keys                                                                                                 |
| Access email→role map (OQ-010 ready)                                   | `ACCESS_EMAIL_ROLE_MAP` JSON env; defaults VIEWER; no invented officers                                                                            |
| Local UAT evidence harness                                             | `npm run uat:local` → `.data/uat-local-latest.json`                                                                                                |
| Wrangler binding gate                                                  | `npm run check:bindings` fails on `REPLACE_ME` / commented **preview** D1                                                                          |
| `npm run staging:raise`                                                | Creates preview D1 + Pages preview from `CLOUDFLARE_API_TOKEN` (no invented ids)                                                                   |
| Pages env name is `preview` not `staging`                              | Root `wrangler.toml` `[env.preview]`; Pages ignores `[env.staging]`                                                                                |
| Import MIME allowlist (.xlsx OOXML / .json)                            | Worker + local API return 415 otherwise                                                                                                            |
| Wrangler preview/production env templates                              | `wrangler.toml` + `worker/wrangler.toml` (`[env.preview]` / `[env.production]`, `REPLACE_ME_*`)                                                    |
| CI UI smoke                                                            | `.github/workflows/ci.yml` starts API+UI and runs `smoke:ui`                                                                                       |
| Soft rate limits on import/backup/restore                              | `worker/src/rateLimit.ts` (429)                                                                                                                    |
| Prod builds omit `X-Dev-*` API headers                                 | `frontend/src/lib/api.ts` (`import.meta.env.DEV` only)                                                                                             |
| Encrypted backup + **transactional restore** (SQLite/D1 SQL)           | `worker/src/db/repos.ts` + restore tests                                                                                                           |
| Local D1-shaped API + remote migrate script                            | `api:local`, `db:migrate:remote` (needs CF login)                                                                                                  |
| Cloudflare Pages/Worker skeleton + security headers                    | `wrangler.toml`, `functions/api/[[path]].ts`, `_headers`                                                                                           |
| Prod/staging refuse `X-Dev-Role` spoof                                 | `worker/src/index.ts` `resolveAuth`                                                                                                                |
| Synthetic 5k / 350 load                                                | `npm run load:theory`                                                                                                                              |
| UI smoke + unit/adversarial + e2e                                      | `npm test`, `smoke:ui` (CI + local), `e2e:cycle`                                                                                                   |
| CI lint + typecheck + test + build + e2e + smoke                       | `.github/workflows/ci.yml`                                                                                                                         |
| Cloud Agent environment start                                          | `.cursor/environment.json` (`api:local` + `dev`)                                                                                                   |
| Override Why names the replacement teacher                             | Persist folds `MANUAL_OVERRIDE` onto `decision_trace_json`; hydrate remaps `teacherId`/`selectedBecause`; Why shows Selected {id} because …; decision reasons JOIN `COALESCE(final_teacher_id, teacher_id)`; UAT-74 |
| Override drops leftover INFO-SELECTED reasons                          | `recordManualOverride` deletes `INFO-SELECTED`; list omits it on `is_override` rows so Validation does not keep the generated pick; UAT-75 |
| Override does not attribute generate RULE-* to the replacement         | List hides generate RULE-*/WARN about the generated pick (`details.teacherId` missing or generated); COALESCE stays for MANUAL_OVERRIDE / Why; shortages stay; UAT-77 |
| Practical publish writes both examiners into duty history              | Persist now stores PRACTICAL_EXTERNAL result rows; `publishRunToHistory` also folds `practical_schedules` so already-persisted internal-only runs still publish the external; hydrate skips EXTERNAL rows so it does not invent a second schedule; UAT-78 uses an isolated demo restore (shared UAT sqlite is remastered by leftover-wipe checks) |
| Hall/practical review tables show every persisted slot                 | Hall/practical assignment tables no longer slice to 50/40 (pair memory no longer slices to 20). Persist+publish already write `HALL_INVIGILATOR` / `HALL_STANDBY` into `GET /api/history`; the review surface was dropping later slots while the session stat counted them. UAT-79 |
| Boot hydrate reconstructs every listed allocation run                  | `GET /api/allocation-runs` is already newest-first (limit 100). Hydrate no longer takes only the first 8, so nine newer theory runs cannot drop the latest hall/practical from the dashboard pipeline, review pages, or `crossModuleCalendar`. UAT-80 |
| Boot hydrate does not invent empty results on a per-run GET miss       | `allocationRunResultsFromFetch` distinguishes a results 503/timeout from authoritative `results: []`. A miss skips that run and marks `allocation_runs` failed so generate cannot treat an invented empty calendar as D1. UAT-81 |
| Boot hydrate does not invent empty reasons on a per-run GET miss       | `allocationRunReasonsFromFetch` distinguishes a reasons 503/timeout from authoritative `reasons: []`. A miss skips that run and marks `allocation_runs` failed so Validation/Why cannot treat an invented empty issue list as D1. UAT-82 |
| Allocation-run list keeps latest run per module beyond LIMIT 100       | Recency window stays 100 (no pager). `listAllocationRuns` unions the latest row per (cycle, module) so a theory burst cannot drop hall/practical from boot hydrate, dashboard pipeline, or `crossModuleCalendar`. Calendar picks `latestRunForModule` rather than first-in-list. UAT-83 |
| Publish / calendar / review scoped to the open exam cycle              | Session runs carry `examCycleId`. Publish, dashboard pipeline, review/export, Validation, and `crossModuleCalendar` use `latestRunForModuleInCycle`. A leftover INVALID sibling is omitted with copy (`publishableSiblingRun`) instead of aborting theory publish; late boot hydrate cannot re-append the previous cycle after `createAmendment`. UAT-84 |
| Boot hydrate session cycle after amendment reload                      | `pickHydrateExamCycle` prefers a mutable DRAFT/OPEN amendment over leftover published `ec_2027_hsc` so generate/publish after a full reload do not run on the frozen parent. Empty GET still keeps `INITIAL_CYCLE`. UAT-87 |

## Remaining inventable (not §107, no client answer required)

**None — hunts frozen.** Do not re-audit for a next gap. Dashboard activity
`slice(0, 8)` stays as titled Recent activity. Clubbing/capacity still use
audit sentinels (no archived file); batch-demand stays session-only.
Client-blocked items stay in the next section.

## Inventable work exhausted

Mechanical gaps that still look like holes were re-checked against consumers.
Nothing remaining can be shipped without inventing a rule or adding a route
with no reader. Closed leftover-row / empty-hydrate items stay in this table
so the next auditor does not re-open them.

| Candidate | Evidence | Why not inventable |
| --------- | -------- | ------------------ |
| GET `/api/duty-types` | Seed `duty_types` only; no UI, hydrate, backup, or engine list call | No consumer |
| GET `/api/users` / officer lists | `users` table is seed + OQ-010 Access map | Would invent officers |
| GET `/api/duty-assignments` | Publish writes the table; engines and boot hydrate use `GET /api/history` (`duty_assignment_history`) | List would have no UI/engine reader |
| Clubbing / capacity `source_import_rows` | Those apply paths do not create a `source_imports` parent (no archived file hash) | Inventing a parent would invent provenance |
| Practical / hall publish | Exam Cycle already POSTs each run id; practical now persists + publishes both examiners (schedules fold covers old internal-only results) | Closed — UAT-78 |
| Dual HTTP drift | `npm run check:routes` vs `worker/src/apiRoutes.ts`; AuthZ verbs match on both surfaces | Gate already exists |
| Empty GET lists vs demo seed | `pickAuthoritativeList` replaces demo when the source is `ok` or `empty` | Closed — was a silent demo fallback |
| Leftover subjects / rule_parameters after restore | Wipe when the backup key is present (canonical always includes them) | Closed — same pattern as provenance |
| Leftover exam_cycles / rule_versions after restore | Wipe when those keys are present; versions only with `rule_parameters` | Closed — UAT-28 |
| Empty `audit_logs` leftover wipe | Snapshot key present as `[]` or persisted `audit_id` rows deletes live audit | Closed — UAT-28/29 |
| Session-shaped `audit_logs` wipe | In-session `{id, detail}` is not the D1 table; restore leaves live rows | Closed — UAT-29 |
| Encrypted officer download omitted always-wiped tables | Download now encrypts `buildCanonicalBackup` when the API is up; memory fallback omits wipe-trigger keys including `teacher_exemptions` | Closed — UAT-31 |
| Leftover `teacher_exemptions` after same-DB restore | Wipe when `teacher_exemptions` / `exemptions` is present (empty or populated) | Closed — UAT-30/31 |
| Leftover `duty_assignment_history` when `includeHistory=true` | DELETE then reload; false still preserves published history | Closed — UAT-32 |
| School/designation/location history `if (length)` hydrate | Those lists start empty after `window.location.reload()` — no demo seed to keep | Not a demo fallback |
| `practicalBatchDemand` after restore reload | Import-session demand, not a D1 table; persisted batches hydrate into runs | Reconstructing demand from batches would invent a mapping |
| `examCycle.ruleVersionLabel` stuck at `2027.1` | Boot now labels from GET `/api/rule-versions` for the cycle's stored id | Closed this pass |
| Worker vs local `/api/restore` body | Both pass `parsed.data.payload` to `transactionalRestore` unchanged | Confirmed — validation test |
| Allocation runs still always-wiped when fallback omits them | Wipe when `allocation_runs` is present; omit + `includeHistory=false` leaves live rows; parent cycle/version wipe still clears children | Closed — UAT-33 |
| Hall UI slots after restore/hydrate | Persist stores `slotIndex` in `decision_trace_json`; hydrate now reads it (array index only for old rows without a slot) | Closed — UAT-34 |
| Theory Fallback / exception FALLBACK after restore | Persist folds `usedFallback` into `decision_trace_json`; hydrate reads it (old rows: `INFO-HM-FALLBACK` / `is_override`) | Closed — UAT-35 |
| Practical Role-switch column + CSV after restore | Persist wraps notes + `roleSwitchApplied`; hydrate matches the internal result row (old notes-array traces recovered) | Closed — UAT-35 |
| Hydrated Feasible stat from row count | Reads `summary_json.feasible` when present; row-count only if the flag was omitted | Closed — UAT-35 |
| Theory/hall shortage list after restore | Persist stores shortage objects on `summary_json` (and RULE-* details); hydrate reads them. A numeric count alone does not invent required/eligible | Closed — UAT-36 |
| Theory `requirementKey` after restore | Persist folds the live key onto `decision_trace_json`; hydrate reads it (old rows still derive centre-roleCode) | Closed — UAT-36 |
| Validation Errors/issues after hydrate | Reads persisted ERROR/WARNING reasons instead of hard-coding 0/[] | Closed — UAT-36 |
| Validation Valid after hydrate | Persist stores `valid` on `summary_json`; hydrate reads it (omitted stays blank — row count is not invented) | Closed — UAT-38 |
| Generate `date`/`duty` stripped on persist | Schema accepts both names; persist maps `date`→`examDate` and stores `duty` on details; unmatched findings do not inherit `results[0]` identity; conflict issues+array persist once | Closed — UAT-54 |
| Hall shortage Teacher/When from a filled slot | Persist no longer matches on `centreId` alone; overlay blanks validator findings without `details.teacherId` | Closed — UAT-55 |
| Same-message hall/theory shortages collapsed on persist | Dedupe key includes centreId / requirementKey; issue+conflict still store once | Closed — UAT-56 |
| Hydrated Feasible looks like generate finished | Practical/hall now disable + show Generating… while persist is in flight; smoke requires a pipeline run-id change | Closed — UAT-58 |
| Primary writes look idle / double-submit | Publish, import apply, clubbing, capacity, restore, archive, cycle status/amend, override, exemptions, window save disable + busy label until persist settles | Closed — UAT-59 |
| Settings / export writes look idle / double-submit | Rule-version create/activate and report/duty-letter exports disable + busy label until persist settles | Closed — UAT-60 |
| Apply before xlsx archive / `row_count` = roster upsert | Apply waits for upload; sample/FORM-01 drop `lastImportId`; D1 `row_count` is file rows | Closed — UAT-61 |
| Sample/JSON apply invents `imp_*` / stale textarea `lastImportId` | No `createId("imp")`; history source id empty without archive; textarea clears archive | Closed — UAT-62 |
| Audit drill-down count vs listed `row_count` | Listed is file rows; drill-down caption is file rows · outcomes (MISSING extra) | Closed — UAT-62 |
| Reports “archived” / always-traceable export vs receipt | Download is client-side; D1 stores type/cycle/run; VIEWER cannot POST; UI surfaces receipt fail | Closed — UAT-63 |
| Worker backup/import `stored:false` called an archive | Receipt `stored` + inline `payload` now drive copy and encrypted download | Closed — UAT-65 |
| Load for restore on `RECORDED_NO_R2` / missing `r2_key` | Catalog list disables Load; GET is 404 “payload was not stored”; error JSON is not a restore snapshot | Closed — UAT-66 |
| Encrypted restore / POST restore of non-snapshot JSON | Preview + `restoreApi` + `transactionalRestore` require teachers/schools/centres arrays (`isLoadableBackupPayload`); catalog receipt and object cores are 400, not empty-wipe | Closed — UAT-67 |
| Why panel after override still names the generated teacher | Persist folds override onto `decision_trace_json`; hydrate overlays `MANUAL_OVERRIDE` + `selectedBecause`; Why shows the replacement | Closed — UAT-74 |
| Validation INFO-SELECTED after override still names the generated pick | Persist deletes `INFO-SELECTED`; list omits leftovers on `is_override` / `final_teacher_id` rows | Closed — UAT-75 |
| Validation generate RULE-* after override names the replacement | List hides generate RULE-*/WARN about the generated pick; apply keeps generated actor when a teacher is still shown | Closed — UAT-77 |
| Practical publish history missing the external examiner | Persist writes PRACTICAL_EXTERNAL result rows; publish folds practical_schedules so GET /api/history matches the session publish claim | Closed — UAT-78 |
| Hall/practical tables hide slots after 50/40 | Review tables render the full persisted assignment/schedule/pair lists; hall publish still writes invigilator + standby history | Closed — UAT-79 |
| Hydrate `runs.slice(0, 8)` drops hall/practical | Boot iterates every listed run (`allocationRunsToHydrate`); nine newer theory rows no longer hide the latest hall/practical | Closed — UAT-80 |
| Hydrate `detail?.results ?? []` invents empty assignments | A results GET miss is failed (skip that run + `allocation_runs` failed); empty `results: []` still hydrates | Closed — UAT-81 |
| Hydrate `reasonsApi?.reasons ?? []` invents empty Validation issues | A reasons GET miss is failed (skip that run + `allocation_runs` failed); empty `reasons: []` still hydrates | Closed — UAT-82 |
| `listAllocationRuns` LIMIT 100 drops latest hall/practical | Recency window stays 100; list unions latest per (cycle, module); calendar uses `latestRunForModule` | Closed — UAT-83 |
| Leftover INVALID / published run from the previous cycle blocks publish or fills the amendment calendar | Session runs carry `examCycleId`; publish/calendar/review use `latestRunForModuleInCycle`; leftover INVALID siblings are omitted with copy; late hydrate cannot re-append the previous cycle after amendment | Closed — UAT-84 |
| Full reload after `createAmendment` sits on leftover published `ec_2027_hsc` | `pickHydrateExamCycle` prefers newest mutable cycle; empty list still keeps `INITIAL_CYCLE` | Closed — UAT-87 |
| Leftover practical UNK subject when schedule exists | Leftover `UNK` batch subject is skipped; persisted identity wins | Closed — UAT-38 |
| Second cycle reusing a school/subject pair cannot persist practical batches | `batch_id` (school\|subject\|index) was a global PRIMARY KEY, so the second cycle hit `UNIQUE constraint failed: practical_batches.batch_id` — run showed "Not persisted", pair memory never updated, publish had no schedules. Migration 003 rebuilds the identity as `(exam_cycle_id, batch_id)` and carries the cycle on `practical_schedules` | Closed — `npm run e2e:cycle` persists both cycles |
| Hydrate looked practical batches up by `batch_id` alone, for one guessed cycle | Boot fetched `/api/practical-batches` for the open cycle only and matched schedules by batch id, so with two cycles a run could show the other cycle's school/subject/student count or no batches at all. Hydration now fetches every PRACTICAL run's cycle and resolves through a `(exam_cycle_id, batch_id)` index | Closed — `frontend/src/lib/practicalHydration.test.ts` |
| Import provenance was never attributed to an exam cycle | `source_imports.exam_cycle_id` exists and `insertSourceImport` accepts it, but neither `POST /api/imports` handler set it and the client never sent it, so every upload receipt read "cycle not recorded". The upload now carries `X-Exam-Cycle-Id`, both servers record it, and an unknown id is a 400 rather than a foreign-key 500 | Closed — `worker/src/authz.http.test.ts` |
| Audit provenance did not say which cycle a receipt belonged to | Export receipts, import receipts and manual overrides are deliberately cross-cycle, but the page showed no cycle, so a cycle and its amendment were indistinguishable. All three now name the cycle | Closed — `npm run smoke:ui` asserts all three |
| Role switch picked an arbitrary pairing when two cycles share an academic year | An amendment carries its parent's academic year, so `examiner_pairs` holds two rows for one teacher pair; ordering by academic year alone let row arrival order decide, switching away from the superseded pairing. Rows now carry `recorded_at` (the cycle's `created_at`) and both the SQL order and `findPriorPair` break the tie on it | Closed — `allocation-engine/src/practical/schedule.test.ts` |
| D1 `teacher_exemptions` vs engines | Engines consume `exemptions` from GET `/api/exemptions`, not a `teacher.exemption` field on `listTeachers` | No divergence |
| GET duty history display | Boot hydrates GET `/api/history` into `dataset.history` (dashboard count + engines). No surface claims a D1 duty-history table it does not fetch | No unfetched consumer |
| HALL `duty_assignments` vs hall UI | Publish writes `duty_assignments`; hall UI reconstructs from `allocation_run_results` (no `hall_allocations` table) | Slot path was the displayed inconsistency |
| Empty D1 exam-cycles keep `INITIAL_CYCLE` placeholder | Session shell only; persist already 409s if the id is missing; local API upserts `ec_2027_hsc`; inventing a no-cycle workflow or academic-year policy is OQ-018 adjacent | Would invent UX / year policy |
| Empty D1 `rule_parameters` keep `DEFAULT_RULE_PARAMETERS` | Overlay onto documented interim defaults; `applyStoredRuleParameters([])` is the same object | OQ interim seed, not a demo master list |
| Leftover teachers/schools/blocks when `includeHistory=false` | Intentional upsert so published history teacher ids remain | By design |
| Backup omitting a table restore wipes | Key-present replace for every former always-wipe table; `exam_days`/`exam_sessions` still empty FK hygiene only (OQ-020) | Closed — omit leaves live rows |
| Location-history scoring | Hydrated for display only | OQ-001 / OQ-004 |
| `exam_days` / `exam_sessions` / `exam_subjects` writes | Tables exist, unwritten | OQ-020 |
| Auto-write `exam_cycles.rule_version_id` on activate | Activate flips `is_active` only | OQ-021 |
| Local `seedFromDemoIfEmpty` teachers-only emptiness | Seed now refuses when schools/centres/history/runs or a PUBLISHED/LOCKED/ARCHIVED cycle exist; OPEN bootstrap cycle still seeds | Closed — UAT-42 |
| Publish applied history + PUBLISHED in memory after API 409 | `publishLatestTheoryRun` waits for `/publish`; applies locally only when the API is down or at least one run is accepted | Closed — UAT-47 |
| Frozen override / window HTTP 400 vs sibling 409 | Both surfaces return 409 + `conflict` when the cycle/run is frozen; persist 409 body includes `accepted: false` | Closed — UAT-47 |
| Letterhead / officer named list | Reports use placeholders | OQ-016 / OQ-010 |
| Pages deploy silently dropping `functions/` + D1 | `pages:deploy:preview` passed a positional assets dir, which makes Wrangler ignore `wrangler.toml`; the api catch-all also exported `default` from an unresolvable path. Both fixed; `check:pages` gates the layout and `check:pages:dev` serves `/api/health` with `dbOk: true` through Miniflare | Closed — `.data/pages-dev-latest.json` |
| Product needing a browser + dev server to run | Ships as a standalone executable: Electron window over the same API server (which now serves the built SPA and takes data/asset roots from env), SQLite under the OS app-data dir, better-sqlite3 as an asar-unpacked N-API prebuild. `npm run desktop:dist`; `npm run app` for a browser on one port | Closed — offline install needs no Cloudflare |
| Autosave needing Cloudflare | Local SQLite is the live store; `POST /api/autosave` snapshots to `.data/autosave/` (latest + 12 pruned copies) and the shell saves after every change. Worker R2 variant answers `stored: false` when `FILES` is unbound | Closed — local-only deployments are first-class |

What remains is **§107** (live D1/R2, Access/IdP, staging UAT, client OQ answers,
human promote). Goal stays open. Do not mark complete.

## Blocking §107 / production acceptance

All four are client-supplied and cannot be invented here. One fill-in page
collects them: [`docs/client-inputs-checklist.md`](./client-inputs-checklist.md).

1. Client Cloudflare account: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (or a real preview D1 `database_id`). R2 optional.
2. Cloudflare Access / IdP role mapping (OQ-010) → `ACCESS_EMAIL_ROLE_MAP` secret
3. Staging UAT against bound D1 (+ R2 if used) + explicit human production promote — the pipeline itself is already proven locally by `npm run check:pages:dev`; verify the deployed URL with `STAGING_URL=… npm run uat:staging`
4. Client answers in `docs/open-questions.md` (letterhead, Access, rule finals)

## Staging once credentials exist

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
npm run staging:raise          # preview D1 + Pages preview; never production
# or:
npm run db:migrate:remote -- --env staging
npm run pages:deploy:preview
```

## Run locally

```bash
npm install && npm test   # shared, engine, validator, worker, frontend, scripts
npm run api:local           # http://127.0.0.1:43124
npm run dev                 # http://127.0.0.1:43123
npm run e2e:cycle && npm run smoke:ui
```
