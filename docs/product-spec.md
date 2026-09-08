# Product Specification — Erode Examination Duty Allotment System

**Client:** Erode Chief Educational Officer (CEO) Office  
**Primary users:** Authorized examination / duty-allotment officers  
**Scale:** ~12–15 blocks, ~350 examination centres, several thousand teachers  
**Modules:** Theory Examination Duty, Practical Examination Duty, Hall Invigilation  

## 1. Business objective

A secure, browser-based system that lets authorized officers maintain master data, import Excel updates, generate theory / practical / hall duties using historical institutional memory, validate results independently, apply audited manual overrides, approve and publish immutable allocations, generate reports, and backup/restore — without mandatory monthly infrastructure cost within current Cloudflare free-tier limits.

## 2. Fundamental principle

The system is a **historical decision engine**. The current Excel file is **not** the source of truth.

```text
CURRENT MASTER DATA
+ HISTORICAL DATA
+ CURRENT EXAMINATION DATA
+ CURRENT RULE VERSION
+ CURRENT EXEMPTIONS
+ CENTRE/SCHOOL RELATIONSHIPS
+ TEACHER LOCATION HISTORY
+ PREVIOUS DUTY HISTORY
+ PREVIOUS ALLOTMENT HISTORY
+ CURRENT AVAILABILITY
= ELIGIBILITY DATASET
```

## 3. Core user flow

```text
LOGIN → DASHBOARD → SELECT EXAM CYCLE
→ LOAD MASTER + HISTORY + RULES
→ PREPROCESS → ELIGIBILITY MATRIX
→ ALLOCATION ENGINE → INDEPENDENT VALIDATOR
→ REVIEW → OPTIONAL OVERRIDE → REVALIDATE
→ APPROVE → PUBLISH → LOCK
→ REPORTS → ARCHIVE → BACKUP
→ becomes historical input to future cycles
```

## 4. Modules (summary)

| Module | Purpose |
|--------|---------|
| Master data | Blocks, schools, centres, teachers, subjects, relationships |
| Imports | Excel upload with preview, history preservation, R2 archive |
| Exam cycles | Lifecycle from DRAFT through ARCHIVED |
| Theory duty | Role-based centre assignment with hard/soft rules |
| Practical duty | Batching, scheduling, internal/external examiners |
| Hall invigilation | Halls + standby calculation and assignment |
| Validation | Independent PASS / WARNING / ERROR |
| Overrides | Audited manual changes with revalidation |
| Reports | Teacher / school / centre / exception; Excel + PDF |
| Backup/restore | D1 + R2 + downloadable encrypted backup |
| Audit | Immutable action log |

## 5. Exam cycle statuses

`DRAFT` → `OPEN` → `ALLOCATION_GENERATED` → `UNDER_REVIEW` → `APPROVED` → `PUBLISHED` → `LOCKED` → `ARCHIVED`

Published allocations are immutable. Corrections create a new versioned amendment with full audit.

## 6. Roles

| Role | Intent |
|------|--------|
| ADMIN | Users, rules, restore, system config |
| OFFICER | Generate, override, approve, publish |
| DATA_OPERATOR | Master data CRUD, imports |
| VIEWER | Read-only reports and allocations |

Backend enforces permissions; UI hiding is not sufficient.

## 7. Non-goals (this product)

- LLM-driven allocation decisions
- Custom insecure password stores when managed auth is available
- Automatic production deploy
- Paid third-party geocoding / AI APIs for normal operation
- Real government PII in source control or synthetic fixtures

## 8. Acceptance (high level)

See master specification §107. Production readiness requires historical retention, versioned rules/runs, independent validators, tested engines, conflict detection, import/export, backup/restore, authZ, synthetic load test, UAT, and handover documentation.

## 9. Related documents

- `docs/rules.md` — hard/soft rules as configured
- `docs/architecture.md` — technical design
- `docs/data-dictionary.md` — entities and fields
- `docs/allocation-engine.md` — engines and solvers
- `docs/open-questions.md` — unresolved business ambiguities
- `docs/client-sample-formats.md` — anonymized layouts from client manual samples
