# Officer guide (synthetic / staging)

Desktop-first admin UI for examination duty allotment. Allocation compute runs in the browser; the API persists runs, history, imports, and audits.

## Typical cycle

1. Confirm exam cycle is **OPEN** (Exam cycle page).
2. Review master data (teachers / schools / centres). Imports never delete published history.
3. **Theory** → Generate theory allocation → review Why? traces → optional manual override with reason.
4. Practical / Hall → generate schedules for the loaded dataset (provisional OQ parameters apply).
5. Validation page must not show ERROR before publish.
6. Exam cycle → **Publish latest theory run** (blocked if INVALID). Creates history rows + archival backup marker.
7. Corrections after publish require an **amendment** cycle with reason.

## Roles

| Role | Typical use |
|------|-------------|
| OFFICER | Generate, override, approve/publish |
| DATA_OPERATOR | Imports and master updates |
| VIEWER | Read reports / allocations / audit provenance (imports, exports, overrides) |
| ADMIN | Restore, users/rules (when Access mapped — OQ-010) |

## Reports

Excel and PDF exports omit home coordinates. Letterhead/language remain open (OQ-016).

## Open questions

Do not invent business rules. See **Open questions** in the UI and `docs/open-questions.md`.
