# Open Questions

**Rule:** Do not invent answers. Implementation must treat these as configurable placeholders or refuse to hard-code final behaviour until confirmed by the client / CEO office.

Ambiguities are listed with **impact**, **interim engineering stance**, and **needed decision**.

---

## OQ-001 — Location eligibility formula

**Spec suggestion:** eligible if `home→centre <= 10 km` OR `school→centre <= 10 km`.  
**Question:** Is OR correct? Is 10 km final? Are both distances always required fields? What if home coordinates are missing?  
**Impact:** Hard constraint for theory/hall (and possibly practical external).  
**Interim:** Parameterized `maximum_distance_km` + policy mode `HOME_OR_SCHOOL` as default suggestion; missing coordinates → ineligible with reason `MISSING_COORDINATES` (conservative).  
**Needed:** Official confirmation of formula and missing-coordinate policy.

## OQ-002 — Fairness window (“recently”)

**Question:** Exact period for recent-duty deprioritization (days/years/cycles)? Separate windows per module?  
**Impact:** Soft scoring only.  
**Interim:** `fairness_window` parameter (days) with documented default in seed rule version; no UI claim of official period.  
**Needed:** Official definition of “recently.”

## OQ-003 — Designation taxonomy and priority

**Question:** Exact designation codes (HM, Principal, Senior PG, PG, …)? Ordered priority list? Mapping Principal vs HM vs CHIEF_EXAMINATION?  
**Impact:** Theory role eligibility and HM shortage fallback.  
**Interim:** Configurable `designation_priority_order` JSON in rule version; seed uses synthetic labels only.  
**Sample evidence (not resolution):** Client seniority workbook sheets include `HM`, `PG`, `BT`, `BT NON`, `SGT`, `SPL`, `NON TEACHING` (FORM-01 columns).  
**Needed:** Official designation list and priority.

## OQ-004 — Own-school and clubbed-school conflict definitions

**Question:** Does own-school mean teacher’s current school is the centre’s host school, any clubbed school, or school equals centre building? Do historical school assignments during the exam dates matter?  
**Impact:** Hard constraints.  
**Interim:** Current school ∈ centre’s active clubbed/host set → conflict; historical school conflict not applied unless configured.  
**Needed:** Precise legal/operational definition.

## OQ-005 — Repeat-centre lookback scope

**Question:** Exactly 2 academic years? Calendar years? Only theory? All duty types at that centre?  
**Impact:** Hard exclusion.  
**Interim:** `repeat_years` integer; applies to same duty module assignments at centre unless configured broader.  
**Needed:** Official lookback definition.

## OQ-006 — Practical batch balancing

**Question:** For 120 students and size 50, is preferred split 40/40/40, 50/50/20, or other?  
**Impact:** Practical schedules.  
**Interim:** Balance toward equal batches near target size (no silent 50+remainder assumption).  
**Needed:** Official balancing rule.

## OQ-007 — Practical completion days

**Question:** Is maximum 2 or 3 days? Per school, per subject, or whole centre?  
**Impact:** Feasibility.  
**Interim:** `practical_completion_days` parameter; enforced as hard.  
**Needed:** Official window.

## OQ-008 — Examiner role-switch hardness

**Question:** Is annual internal/external switch mandatory (hard) or preferred (soft)? What if only one of the pair is available?  
**Impact:** Practical pairing.  
**Interim:** Prefer switch as soft score bonus/penalty; do not fail allocation solely for non-switch unless configured.  
**Needed:** Official hardness.

**Follow-up (pair memory scope).** Pairs are now persisted in `examiner_pairs`
and fed back into the next cycle, but two sub-questions surfaced while wiring
that up and are **not** interpreted here:

1. _Scope._ A stored pair is keyed on one school + subject, and the engine only
   swaps when both teachers are eligible for both roles **at that school**.
   Under the strict reading (internal from the host school, external from
   elsewhere) that is never true, so a stored pair can never actually swap. If
   the intended meaning is "the two schools exchange host/visitor roles next
   year", the memory must be matched across the pair's two schools instead.
2. _Cycle granularity._ The rule says the switch applies to the _next cycle_, so
   pairs written by the cycle being generated are excluded from its own input.
   Whether an amendment cycle (same academic year, new cycle id) should count as
   the same cycle or the next one is unconfirmed.

## OQ-009 — Simultaneous duty exceptions

**Question:** Are any dual duties in the same session ever permitted (e.g. standby + something)?  
**Impact:** Cross-module conflict engine.  
**Interim:** Default hard block all same date+session overlaps.  
**Needed:** Exception list if any.

**Follow-up (what feeds the block).** Each module now allocates against a duty
calendar built from the _other_ modules' latest runs in the same exam cycle, so
a chief examiner is no longer also picked as an invigilator in that session
(`shared/src/dutyCalendar.ts`, proven by `uat:local` UAT-16). Two choices made
there are mechanical, not rules, and can be revisited: re-running a module
replaces its own previous assignments rather than competing with them, and
already-published duty history is _not_ folded into the block (it would make a
post-publish amendment infeasible, since every teacher would block themselves).

## OQ-010 — Authentication provider

**Question:** Cloudflare Access with client email domain? Another IdP? How many named officers?  
**Impact:** Security architecture.  
**Interim:** Abstract `AuthAdapter`; Access email required in staging/production; role from client-supplied `ACCESS_EMAIL_ROLE_MAP` JSON (email→ADMIN|OFFICER|DATA_OPERATOR|VIEWER) or optional `X-Access-Role` claim header; without either, Access users are VIEWER (never invent officer lists). Local/dev uses `X-Dev-*` only.  
**Needed:** Client IT decision (provider + named officers / group→role map to populate `ACCESS_EMAIL_ROLE_MAP`).

## OQ-011 — Department Officer eligibility

**Question:** Who may be DEPARTMENT_OFFICER? Separate seniority list?  
**Impact:** Theory roles.  
**Interim:** Configurable eligibility designation set + seniority mode.  
**Needed:** Official criteria.

## OQ-012 — Hall designation restrictions

**Question:** Which designations are eligible/ineligible for hall invigilation and standby?  
**Impact:** Hall hard filters.  
**Interim:** Configurable allow-list; empty allow-list means all active non-exempt (documented as provisional).  
**Needed:** Official list.

## OQ-013 — Data quality and unverified history

**Question:** May Unverified historical centre assignments still exclude a teacher (repeat-centre)?  
**Impact:** Hard exclusions based on weak data.  
**Interim:** Apply exclusions but flag WARNING `UNVERIFIED_HISTORY_USED` on affected assignments.  
**Needed:** Policy confirmation.

## OQ-014 — Import of missing teachers

**Question:** If Excel omits a teacher present in DB, auto-deactivate, mark inactive candidate, or leave unchanged until officer decides?  
**Impact:** Import apply semantics.  
**Interim:** Preview as “Missing from file”; require explicit officer action (deactivate vs ignore). Never silent delete.  
**Needed:** Official default.

## OQ-015 — Backup encryption

**Question:** Who holds encryption keys for downloadable backups? Client-managed passphrase?  
**Impact:** DR handover.  
**Interim:** Support passphrase-based encryption for downloads; keys never in Git.  
**Needed:** Client key custody policy.

## OQ-016 — PDF/Excel bilingual / official letterhead

**Question:** Tamil/English? Official letterhead/signatures blocks?  
**Impact:** Reporting.  
**Interim:** English synthetic templates matching Duty-In / Duty-Out **layouts** from client samples; footer uses configurable “Chief Educational Officer / District” placeholders. Tamil booklet abstract observed in samples — not hard-coded as final.  
**Needed:** Official template / letterhead files.

## OQ-017 — Relaxation mode approval

**Question:** Who may enable Controlled Relaxation Mode? Which soft rules are approvable?  
**Impact:** Governance.  
**Interim:** ADMIN/OFFICER only; each relaxation logged; hard rules never relaxable.  
**Needed:** Written policy.

## OQ-018 — Academic year vs calendar year for history

**Question:** How are “2025” / “2026” boundaries defined for pair switch and repeat-centre?  
**Impact:** History queries.  
**Interim:** Use `exam_cycles.academic_year` on historical published runs.  
**Needed:** Confirmation.

## OQ-019 — Question paper allotment / label slips

**Question:** Does this product own practical **question-paper packing** and label slips (Physics/Chemistry/… allotment sheets; Bio Botany / Zoology / 12th practical labels), or only examiner duty allotment?  
**Impact:** Scope of Reports / Practical modules.  
**Interim:** Layout documented in `docs/client-sample-formats.md`; not generated by the duty engine until confirmed.  
**Needed:** Scope decision from CEO office.

## OQ-020 — Exam day / session / subject timetable

**Question:** Who supplies the day-by-day examination timetable, in what form
(Excel sheet, DGE circular, manual entry), and what does the system do with it?
Specifically: which subjects sit in which day+session, and how many duties does
one centre need per day — one chief for the whole cycle, one per exam day, or
one per session?

**Impact:** `exam_days`, `exam_sessions`, `exam_subjects` and the requirement
count for every module. Requirement cardinality is the difference between a
handful of duties and several thousand.

**Interim:** Only the **window** is modelled — `exam_cycles.start_date` /
`end_date`, set by an officer on the Exam Cycle page and stored through
`POST /api/exam-cycles/:id/window`. Duty dates are bounded by that window
(`shared/src/examWindow.ts`); when it is unset the modules fall back to the
previous synthetic placeholder dates and say so in the UI. The three normalized
timetable tables are intentionally left unwritten: filling them would require
choosing the requirement rule above, which is exactly what rule 1 forbids.
Requirement cardinality is therefore unchanged from before (one chief duty per
centre, one hall demand per centre, practical days capped by
`practical_completion_days`).

**Needed:** The official timetable source and the per-day/per-session duty
requirement rule.

## OQ-021 — Activating a rule version vs the open cycle

**Question:** Does activating a rule version retarget the currently open exam
cycle's `rule_version_id`, or only the global `rule_versions.is_active` flag
(so only new cycles pick it up)?

**Impact:** After reload, the open cycle hydrates its stored version while
Settings may show a different globally-active version. Allocation persist
stamps `examCycle.ruleVersionId` from the UI.

**Interim:** `POST /api/rule-versions/activate` flips `is_active` only (existing
API). Generate uses the cycle's own `rule_version_id`. The Settings activate
button updates the in-session cycle label and hydrates that version's
parameters for the rest of the session, but does **not** write
`exam_cycles.rule_version_id` — that would silently retarget the cycle.

**Needed:** Official binding of "the active version" to an in-progress cycle.

---

## Client decisions received (2026-09-08)

The following decisions supersede any earlier interim wording on the same
topic. They are recorded here until the related rule-version and report
configuration screens have received the remaining formal inputs.

| Topic | Confirmed decision |
|---|---|
| Location eligibility | Use a straight-line 10 km radius (Haversine). A teacher is eligible if either current-school or home distance qualifies. Missing coordinates must be requested/corrected; they are not silently assumed. |
| Repeat-centre history | The lookback period is user-defined. An approved manual exception is permitted, but requires administrator approval and an audit record. |
| Chief designation | Principal and HM are equivalent for Chief of Examination priority. Eligible Senior PG is the fallback when this pool is short. |
| Senior PG fallback | Use candidates from the centre's block first; only then consider district-wide candidates. |
| Exemptions | The administrator decides physical-disability/other manual exemptions and records them. |
| Practical batches | Determine batch count from student strength, target 50 students, and split remainders equally. Different subjects may run in parallel where distinct examiner pairs are available. |
| Practical examiner eligibility | Use the teacher's current school. Where two teachers cover one subject, rotate internal/external roles each year when they remain eligible. |
| Fairness | Include other recent duties. It remains a preference: a teacher may be selected when a shortage remains after other eligible teachers have been considered. |

## Still required before a final official allocation

1. The student-strength-to-Department-Officer staffing table and confirmation
   of Chief count per centre/day/session.
2. The approved school-wise and teacher-wise report columns, grouping,
   signatures and letterhead layout.

## Timetable decision received (2026-09-09)

The operator enters the official timetable directly: date, morning/afternoon
session and subject/paper. Each session explicitly states whether Chief duty
and Hall duty are required. Theory and Hall allocation create duties only for
the marked sessions, across the entered active centres. This removes the
placeholder-date behaviour formerly described in OQ-020; it does not decide
the separate Department Officer staffing table.
