# Architecture

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Allocation compute | Browser Web Worker (`allocation-engine` + `validator`) |
| API | Cloudflare Pages Functions / Workers |
| Database | Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 |
| Hosting | Cloudflare Pages |
| Auth | Managed access (Cloudflare Access / Zero Trust preferred); roles enforced in Worker |

## Why client-side allocation

Cloudflare Workers Free has a **10 ms CPU-time** limit per invocation. The main optimization engine must **not** run on the Worker. The Worker persists runs, snapshots, audits, and serves master/history data needed by the client engine.

## Request paths

```text
Browser (React)
  ├─ CRUD / import / audit / publish  →  Pages Function / Worker  →  D1
  ├─ File upload/download             →  Worker  →  R2
  └─ Generate allocation              →  Web Worker (local)
         ├─ allocation-engine
         └─ validator
              → persist run + results via Worker API
```

## Repository layout

```text
exam-duty-allotment/
├── frontend/           # Vite React admin UI
├── worker/             # Cloudflare Pages Functions / API
├── allocation-engine/  # Pure TS deterministic engines
├── validator/          # Independent validators
├── shared/             # Types, schemas, geo, constants
├── database/           # migrations, seeds, schema
├── tests/              # cross-package / e2e / adversarial
├── scripts/            # seed generators, backup helpers
├── docs/
└── package.json        # workspace root
```

## Solver abstraction

```ts
interface SolverAdapter {
  solve(input: AllocationInput): AllocationOutput;
}
```

UI/backend do not depend on whether the implementation is custom deterministic code, a constraint solver, or WASM. Current implementation: custom deterministic greedy/priority allocator with explicit scoring. Rule parameters used by the engines are the cycle's stored `rule_parameters` rows (hydrated on boot); unknown keys are ignored rather than interpreted. Boot hydrate treats a successful empty list as authoritative (`pickAuthoritativeList`) — the synthetic demo seed is kept only when that source failed. Session `examCycle` after a full reload prefers a mutable DRAFT/OPEN amendment over leftover published `ec_2027_hsc` (`pickHydrateExamCycle`); an empty exam-cycle GET still keeps the first-boot placeholder. Canonical restore wipes leftover `exam_cycles` / `rule_versions` when those snapshot keys are present so GET `/api/exam-cycles` after DR is a point-in-time replace. The same key-present replace applies to `teacher_exemptions`, `teacher_*_history`, allocation runs/results/snapshots, practical batches/schedules, `examiner_pairs`, overrides, `duty_assignments`, and centre↔school relationships so a local-built contingency cannot drop live GET `/api/exemptions` or GET `/api/allocation-runs`. Session-shaped `audit_logs` (in-browser trail) do not wipe persisted GET `/api/audit` rows; encrypted officer download uses the canonical archive when the API is up. Boot hydrate sets `examCycle.ruleVersionLabel` from GET `/api/rule-versions` for the cycle's stored `rule_version_id` (activate still does not write that column — OQ-021).

## Environments

| Env | Purpose |
|-----|---------|
| development | Local Vite + local D1/miniflare or mock API |
| staging | Cloudflare preview / staging project |
| production | Promoted only after explicit human approval |

Never develop against production.

## Data integrity

- Soft-delete / deactivate only; no hard-delete of allotment history
- Published runs locked; amendments create new versions
- Every generate → new `allocation_runs` row + `input_snapshot`
- Imports preview → confirm → apply with history rows

## Zero-cost design constraints

- Static frontend
- Low server request volume
- Modest D1 footprint
- Client-side solver
- No paid geocoding / AI in production
- Document free-tier limits used; re-check periodically (policies can change)

## Security architecture

See `docs/security.md`. Browser never talks to D1 directly.

## Deployment

See `docs/deployment.md`. Domain starts as `*.pages.dev`; custom domain later without app rewrite.
