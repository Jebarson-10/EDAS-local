# Practical Engine

See also `docs/allocation-engine.md` and `docs/rules.md`.

## Problem type

Scheduling + pairing, not only single-role assignment.

## Inputs

- school, subject, student_count
- available dates; morning / afternoon sessions
- internal / external examiner pools
- historical examiner pairings
- teacher availability
- completion window (`practical_completion_days`)
- rule version parameters

## Batching

Target batch size from rule parameter (default suggestion: 50).  
Uneven populations use a **balancing** function — do not assume `50 + remainder` unless officially confirmed (OPEN).

## Sessions

Represent DAY + MORNING | AFTERNOON; allow parallel subjects across schools where conflict rules permit.

## Examiners

Every batch stores:

- `internal_examiner_id`
- `external_examiner_id`

Never infer roles from list order.

## Completion window

Entire practical requirement for a school must complete within configured days.  
If impossible → `NO VALID SCHEDULE` with explanation. Never silently violate.

## Pair history / annual switch

Persisted in `examiner_pairs`. Next cycle prefers role swap when both eligible.

Write path: `persistPracticalBatches` records one row per scheduled batch —
the teacher pair (stored order-independently), subject, school, the cycle's
academic year and who held each role. Only the current cycle's rows are
rewritten on a re-run, so earlier cycles keep their memory. The rows travel in
the canonical backup and are reloaded by `transactionalRestore`.

Read path: `GET /api/examiner-pairs` → the Practical page maps persisted
subject codes back onto the demand's subject ids and passes them as
`dataset.pairHistory`. Rows written by the cycle being generated are excluded,
because the documented rule switches on the *next* cycle.

Known limitation (OQ-008): pair memory is keyed on one school, and the switch
only fires when both teachers are eligible for both roles at that school. Under
the strict "internal from the host school, external from elsewhere" reading no
stored pair can ever swap, so the persisted memory is currently inert in
practice. Whether the switch is meant to be cross-school is a client question —
see `docs/open-questions.md`.

## Outputs

- batches
- schedules
- decision traces
- infeasibility report if any
