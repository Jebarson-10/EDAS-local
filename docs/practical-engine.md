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

Target batch size is 50. Uneven populations are split into balanced batches
so the whole subject strength is covered (for example 70 becomes 35 + 35).

## Sessions

Represent DAY + MORNING | AFTERNOON; allow parallel subjects across schools where conflict rules permit.

Different subjects of the **same** school may also run in parallel. A subject's
own batches remain sequential (for example, 100 Physics students become a
50-student morning batch and a 50-student afternoon batch), while Physics,
Chemistry, Biology, Computer Science and Vocational batches may share that
morning or afternoon when they have distinct eligible examiner pairs. This
lets multiple subject groups complete within the configured 2–3-day window;
the conflict engine still prevents an examiner from appearing twice in one
date/session.

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

Eligibility is determined from the teacher's current school. Pair history is
kept for the annual role switch where both teachers remain eligible for their
respective current-school roles.

## Outputs

- batches
- schedules
- decision traces
- infeasibility report if any
