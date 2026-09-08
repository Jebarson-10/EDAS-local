# Allocation Engine

## Principles

1. Deterministic given same input snapshot + rule version + algorithm version + seed.
2. No LLM in the decision path.
3. Hard filters before scoring.
4. Independent validator recalculates rules; does not trust solver output.
5. Runs in a browser Web Worker via `SolverAdapter`.

## Package layout

```text
allocation-engine/
├── eligibility/
├── theory/
├── practical/
├── hall/
├── fairness/
├── history/
├── scoring/
├── constraints/
└── solver/
```

## Pipeline (theory)

```text
Requirements
 → Eligibility
 → Candidate generation
 → Hard constraint filtering
 → Candidate scoring
 → Allocation
 → (external) Validation
```

## SolverAdapter

```ts
export interface SolverAdapter {
  readonly algorithmVersion: string;
  solve(input: AllocationInput): AllocationOutput;
}
```

`AllocationOutput` includes assignments, shortages, decision traces, and infeasibility reports.

## Candidate matrix

Precompute `teacher × centre` (or duty requirement) with:

- eligible (bool)
- distance_home_km / distance_school_km
- hard exclusion reasons
- designation suitability
- fairness components
- score

## Theory strategy (current)

1. Build requirements per centre/role/session from exam cycle config.
2. Build eligibility matrix using history + clubbing + exemptions + distance + repeat-centre.
3. Sort requirements by scarcity (fewest eligible first) for deterministic allocation order.
4. For each requirement, select lowest score among eligible remaining teachers; tie-break by employee_code.
5. Emit decision trace per assignment.
6. If shortage: emit `NO FEASIBLE ALLOCATION` fragment with required/eligible/shortage and exclusion tallies — do not force.

**HM shortage:** Explicit fallback to senior PG only when configured; surface counts in output metadata.

## Practical strategy (current)

1. Batch students with balancing function toward `practical_batch_size`.
2. Enumerate feasible (date, session) slots within `practical_completion_days`; batches of the same subject are sequential, while different subjects may use a slot in parallel with distinct examiner pairs.
3. Match internal/external with eligibility + pair history role switch preference (soft/hard per config — OPEN).
4. If no schedule finishes in window → `NO VALID SCHEDULE` with explanation.

## Hall strategy (current)

1. Compute required halls and standby from parameters.
2. Generate candidates with shared eligibility helpers.
3. Assign with fairness scoring and a cross-module conflict set. A teacher may be considered again on another date/session, but recent history and current-cycle workload are penalized so eligible colleagues are selected first.

## Fairness / scoring

Weights from rule parameters. Prefer lower score. Document formula in rule version notes when weights change.

## Progress events (Web Worker)

```text
Preparing data...
Calculating eligibility...
Applying constraints...
Optimizing...
Validating...
Finalizing...
```

## Algorithm versioning

Bump `algorithmVersion` string on any logic change that can alter results for the same inputs.
