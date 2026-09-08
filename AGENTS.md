# AGENTS.md — Erode Examination Duty Allotment System

## Role

You are part of the engineering team for a production-grade government examination duty allotment system for the Erode Chief Educational Officer (CEO) Office.

This is **not** a prototype. Correctness, auditability, and historical integrity take priority over speed and UI polish.

**Do not hunt inventable gaps.** The local slice is frozen at current HEAD. Successor agents must not start restore/hydrate/AuthZ/catalog-miss hunts unless the user names a defect. Remaining work is client-supplied only: `docs/client-inputs-checklist.md` (Cloudflare D1/R2, Access/OQ-010, staging UAT, open-question answers, human promote). Do not invent those. Do not mark §107 complete without that evidence. When the client provides `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, run `npm run staging:raise` (Pages `[env.preview]`). Do not invent officer emails for `ACCESS_EMAIL_ROLE_MAP`.

## Absolute rules (never violate)

1. Never invent a business rule.
2. Never silently interpret an ambiguous business rule — document it in `docs/open-questions.md`.
3. Never delete historical allotment records.
4. Never overwrite a published historical allocation.
5. Never use an LLM as the final allocation decision maker.
6. The allocation engine must be deterministic.
7. The validator must be logically independent from the allocation engine.
8. Current Excel uploads update current master data only; they must never replace historical records.
9. Historical data must automatically participate in all future allotment calculations.
10. Manual overrides must always be audited.
11. Rule changes must be versioned.
12. Every allocation generation must create a versioned allocation run.
13. Published allocations must be immutable.
14. Production deployment must require explicit human approval.
15. Never put secrets, credentials, or real government data into source control.
16. Use synthetic data for development and testing.
17. Every business rule implemented must have automated tests.
18. Any ambiguity must go to `docs/open-questions.md`.
19. Do not prematurely optimize the UI at the expense of correctness.
20. Correctness of allocation takes priority over speed.

## Architecture principles

- Authoritative truth = current master data + historical data + exam config + rule version + exemptions.
- Allocation computation runs **client-side** (Web Worker), not on Cloudflare Workers (10 ms CPU limit).
- Browser → Worker API → D1. Never expose D1 to the browser.
- Hard constraints and soft preferences are explicit and versioned; never conflate them.
- Insufficient staff → return `NO FEASIBLE ALLOCATION` with explanations; never force-assign.

## Development phases

Execute in controlled phases (see master spec §123). At every phase:

1. Write tests
2. Run tests
3. Run lint
4. Run build
5. Review git diff
6. Update docs when architecture changes
7. Never delete historical data
8. Never invent missing business rules
9. Never deploy to production without explicit instruction
10. Stop and document blockers instead of silently making unsafe assumptions

## Package boundaries

| Package | Responsibility | Must not |
|---------|----------------|----------|
| `allocation-engine/` | Deterministic eligibility, scoring, assignment | Depend on React; call LLM |
| `validator/` | Independent re-validation of allocations | Import allocator internals for rule checks |
| `shared/` | Types, schemas, constants, Haversine | Business allocation logic |
| `worker/` | AuthZ, CRUD, import, audit, persistence | Run main optimization |
| `frontend/` | Admin UI, Web Worker host | Enforce permissions alone |

## Security

- Roles: `ADMIN`, `OFFICER`, `DATA_OPERATOR`, `VIEWER`
- Permissions enforced on the backend
- Synthetic data only in fixtures
- Home coordinates are sensitive — prefer distance/eligibility display over raw coords in reports

## Commits

Small, meaningful commits. Prefer `feat:`, `test:`, `fix:`, `docs:` prefixes. No giant “complete application” commits.
