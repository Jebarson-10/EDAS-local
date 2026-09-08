# Rules Catalogue

Rules are stored as **versioned parameters** (`rule_versions` + `rule_parameters`).  
This document describes the **intended rule set** from the product specification.  
Items marked **OPEN** must not be hard-coded as final until confirmed — see `docs/open-questions.md`.

## Rule versioning

- Each allocation run references exactly one `rule_version_id`.
- Changing any configuration parameter creates a **new** rule version.
- Old published results remain reproducible against their original rule version + input snapshot + algorithm version.

## Hard vs soft

| Class | Effect |
|-------|--------|
| HARD | Violation → assignment INVALID; cannot publish |
| SOFT | Affects score / preference only |

Never convert soft → hard without explicit configuration/versioning.

---

## Theory — hard constraints

Candidate must not:

| Code | Rule |
|------|------|
| RULE-THEORY-INACTIVE | Be inactive |
| RULE-THEORY-EXEMPT | Be exempted (within effective window) |
| RULE-THEORY-UNAVAIL | Be unavailable |
| RULE-THEORY-CONFLICT | Have a conflicting duty (same date+session) |
| RULE-THEORY-OWN-SCHOOL | Violate own-school conflict |
| RULE-THEORY-CLUBBED | Violate clubbed-school conflict |
| RULE-THEORY-REPEAT-CENTRE | Violate previous-centre restriction (lookback years) |
| RULE-THEORY-DISTANCE | Exceed allowed location distance policy |
| RULE-THEORY-ROLE | Be assigned to an incompatible role |
| RULE-THEORY-EXAM-RESTRICT | Violate any configured examination restriction |

## Theory — priority / roles

Suggested default designation priority (configurable, not multi-hardcoded):

```text
HM → Senior PG → Other approved fallback category
```

| Role code | Preference |
|-----------|------------|
| CHIEF_EXAMINATION | Preferred: Principal; fallback: senior-most eligible PG |
| DEPARTMENT_OFFICER | Eligibility and seniority separately configurable |

**HM shortage:** When HMs insufficient, use eligible senior PG teachers. UI must show requirement / eligible / shortage / fallback count — never silent substitution.

## Seniority modes (configurable)

- `district`
- `block`
- `school`

Active mode is a rule-version parameter.

## Repeat-centre restriction

Look back configured years (example: 2). Exclude centres assigned in that window from historical DB — not from current Excel alone.

## Location policy (OPEN confirmation)

Default interpretation pending official confirmation:

```text
eligible if distance_home_to_centre <= max_km
         OR distance_school_to_centre <= max_km
```

Default `max_km` suggestion from spec: `10`. Distance = Haversine; no road routing unless client requires it.

## Fairness (soft)

Compute from history:

- last_duty_date / last_theory / last_practical / last_hall
- duty counts (current cycle, previous cycle, recent period)

Recently assigned teachers are **deprioritized** (soft).  
“Recently” has no fixed meaning until `fairness_window` is officially configured.

## Fairness score (deterministic)

Concept:

```text
score =
  recent_duty_penalty
  + repeated_duty_penalty
  + distance_penalty
  + workload_penalty
  + role_balance_penalty
  + other configured preferences
```

Weights live in the rule version. Prefer deterministic tie-breakers (e.g. employee_code ascending). Any randomness uses an explicitly stored seed.

---

## Practical

| Parameter | Default suggestion | Notes |
|-----------|-------------------|-------|
| practical_batch_size | 50 | Balancing function for uneven counts — OPEN |
| practical_completion_days | configured (e.g. 2–3) | Entire school practical within window or `NO VALID SCHEDULE` |
| subjects | Physics, Chemistry, Biology, CS, Vocational | Extensible without schema redesign |

Every batch stores explicit `internal_examiner_id` and `external_examiner_id`.

### Examiner pair annual switch

If A+B paired previously with A=Internal, B=External, then next applicable cycle prefer A=External, B=Internal when both remain eligible. Detected from historical assignments.

---

## Hall invigilation

```text
required_halls = ceil(total_students / students_per_hall)
standby = ceil(required_halls * standby_percentage / 100)
```

Defaults (configurable): `students_per_hall = 20`, `standby_percentage = 10`.

Eligibility applies location, repeat-centre, exemption, fairness, availability, simultaneous conflict, designation restrictions.

---

## Cross-module

Central conflict engine normalizes every assignment to:

```text
teacher_id, date, session, duty_type, location, role
```

Same teacher + same date + same session + different duties = HARD conflict unless a rule explicitly permits.

---

## Insufficient staff

Do not force assignment. Return:

```text
NO FEASIBLE ALLOCATION
required / eligible / shortage
+ exclusion reasons for missing candidates
```

## Relaxation mode

- **Strict:** hard rules never violated
- **Controlled relaxation:** only explicitly approved soft rules may be relaxed; hard never auto-bypassed

---

## Configuration parameters (rule version)

```text
maximum_distance_km
repeat_years
students_per_hall
standby_percentage
practical_batch_size
practical_completion_days
fairness_window
seniority_mode
block_priority_mode
designation_priority_order
scoring_weights
```
