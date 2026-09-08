# Staging preparation checklist

## Before staging deploy

1. Create Cloudflare account owned/shared with the client organization.
2. Create D1 database (`erode-exam-duty-preview` or `npm run staging:raise`); apply all files under `database/migrations/` (incl. `002_exam_cycle_amendments.sql`) then `database/seeds/001_reference_data.sql` (`npm run db:migrate:remote -- --env staging` once bindings exist).
3. Create R2 bucket for source files, reports, backups.
4. Configure Pages project from GitHub; set preview = staging.
5. Bind D1 (R2 optional) to Pages Functions (`wrangler.toml` `[env.preview]`). Confirm with `npm run check:bindings -- --env staging`.
6. Enable Cloudflare Access (or chosen IdP) — set `ACCESS_EMAIL_ROLE_MAP` from OQ-010 answers (do not invent officer emails).
7. Confirm no production secrets in repository.
8. Run CI (lint/test/build/`uat:local`) on PR; use preview URL for UAT with **synthetic** data first.
9. Do **not** promote to production without explicit human approval.

## Free-tier reminders

- Allocation compute stays in the browser (Worker CPU limits).
- Re-check Cloudflare Free limits periodically; document any change in `docs/deployment.md`.

## Open questions blocking final UAT with real rules

See `docs/open-questions.md` — especially OQ-001 through OQ-012.
