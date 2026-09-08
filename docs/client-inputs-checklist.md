# Client Inputs Checklist (§107 unblock)

This is the **only remaining work** after the local-slice freeze. In-repo hunts
are stopped. Everything on this page is **client-supplied**. The engineering
work that can be done without it is finished and gated by
`npm run staging:preflight`. Nothing below may be invented by the engineering
team (`AGENTS.md` rules 1, 2, 18).

Fill in the values, hand them back, and staging can be raised in one pass.

---

## 1. Cloudflare bindings

Needed to replace every `REPLACE_ME_*` in `wrangler.toml` and
`worker/wrangler.toml`. Staging UAT bindings live in **`[env.preview]`**
(Cloudflare Pages only has preview + production). `npm run check:bindings -- --env staging`
fails until preview D1 is real, so nothing can be deployed against placeholder ids by accident.

**Fast path** — paste the token, not the UUIDs:

```bash
export CLOUDFLARE_API_TOKEN=...          # D1 edit + Pages edit
export CLOUDFLARE_ACCOUNT_ID=...
# optional: ACCESS_EMAIL_ROLE_MAP='{"officer@your.domain":"ADMIN"}'
npm run staging:raise
```

That creates `erode-exam-duty-preview` D1, migrates it, restores the canonical
snapshot (`npm run staging:restore`), and deploys Pages `--branch preview`
without a positional assets directory (so `functions/` and D1 actually ship).
R2 is optional; omit it and backups report `stored: false`. Production is not deployed.

Without those secrets, `npm run staging:temporary` still raises a **60-minute**
Cloudflare Worker + D1 on a claimable temporary account (Pages is not available
there). That is live-D1 evidence, not client staging, Access, or production.
`npm run staging:temporary:seed` loads the synthetic demo into that D1 (VIEWER-only
on workers.dev until OQ-010).

**GitHub Actions** — same raise, once secrets exist on the repo:

1. Repo Settings → Secrets and variables → Actions
2. Add `CLOUDFLARE_API_TOKEN` (D1 edit + Pages edit) and `CLOUDFLARE_ACCOUNT_ID`
3. Optional: `ACCESS_EMAIL_ROLE_MAP` only with real OQ-010 officer emails
4. Actions → **Staging raise** → Run workflow
5. `STAGING_URL=https://<preview>.pages.dev npm run uat:staging`

The workflow fails closed if those secrets are missing. It never deploys production.

| Item | Where it goes | Value |
|------|---------------|-------|
| Cloudflare account id | `CLOUDFLARE_ACCOUNT_ID` | |
| API token (D1 + Pages) | `CLOUDFLARE_API_TOKEN` | |
| D1 database name (staging) | `[[env.preview.d1_databases]] database_name` | (raise default: `erode-exam-duty-preview`) |
| D1 `database_id` (staging) | `[[env.preview.d1_databases]] database_id` | (filled by `staging:raise`) |
| D1 database name (production) | `[[env.production.d1_databases]]` | |
| D1 `database_id` (production) | `[[env.production.d1_databases]]` | |
| R2 bucket (staging) | `FILES` binding — optional | |
| R2 bucket (production) | `FILES` binding — optional | |
| Pages project name | `pages:deploy:*` / `CF_PAGES_PROJECT` | default `erode-exam-duty` |
| Allowed browser origins | `ALLOWED_ORIGINS` (comma separated) | |

After these land (if not using `staging:raise`):

```bash
npx wrangler login
npm run check:bindings -- --env staging   # must exit 0
npm run db:migrate:remote -- --env staging
npm run pages:deploy:preview              # staging only
```

Production deploy stays manual and requires explicit written approval
(`AGENTS.md` rule 14).

## 2. Authentication and roles (OQ-010)

The app never invents an officer list. Without a map, every Cloudflare Access
user is `VIEWER`.

- Identity provider: Cloudflare Access with which IdP? (Google Workspace, Entra, OTP…)
- Email domain(s) allowed through the Access policy:
- Named users and their role, using only `ADMIN`, `OFFICER`, `DATA_OPERATOR`, `VIEWER`:

Supply as the `ACCESS_EMAIL_ROLE_MAP` secret — one JSON object, emails lowercased:

```json
{
  "ceo.erode@example.gov.in": "ADMIN",
  "officer1@example.gov.in": "OFFICER",
  "dataentry1@example.gov.in": "DATA_OPERATOR",
  "audit@example.gov.in": "VIEWER"
}
```

Set it as a Worker secret (never commit it):

```bash
npx wrangler pages secret put ACCESS_EMAIL_ROLE_MAP --project-name erode-exam-duty
```

Verify after deploy: `/api/health` reports `accessRoleMapConfigured` and
`accessRoleMapEntries`, and the Settings page shows the same probe.

## 3. Business rule answers

Each open question in [`docs/open-questions.md`](./open-questions.md) has an
**interim** engineering stance that is parameterised, not hard-coded. Confirm or
correct each one; a confirmation is as valuable as a change.

| Id | Decision needed | Answer |
|----|-----------------|--------|
| OQ-001 | Distance formula (`HOME_OR_SCHOOL`?), km limit, missing-coordinate policy | |
| OQ-002 | Fairness window definition of "recently" | |
| OQ-003 | Official designation list and priority order | |
| OQ-004 | Own-school / clubbed-school conflict definition | |
| OQ-005 | Repeat-centre lookback scope | |
| OQ-006 | Practical batch balancing rule | |
| OQ-007 | Practical completion window (days, per what) | |
| OQ-008 | Examiner role-switch: hard or soft | |
| OQ-009 | Any permitted simultaneous duties | |
| OQ-010 | Auth provider + role map (section 2 above) | |
| OQ-011 | Department Officer eligibility | |
| OQ-012 | Hall designation allow-list | |
| OQ-013 | May unverified history drive hard exclusions | |
| OQ-014 | Import default for teachers missing from a file | |
| OQ-015 | Backup passphrase custody | |
| OQ-016 | Letterhead / bilingual templates (files) | |
| OQ-017 | Who may enable relaxation mode | |
| OQ-018 | Academic vs calendar year boundary | |
| OQ-019 | Is question-paper labelling in scope | |

Rule changes are applied as a **new cloned rule version** (Settings → Rule
versions), never by editing the active one.

## 4. Staging UAT sign-off

Run through [`docs/uat-plan.md`](./uat-plan.md) on staging with real officers and
record, per the plan: cycle name, rule version, run ids, officer name, date,
defects, and the accept/reject decision.

The synthetic pre-check that already passes locally is evidence of readiness, not
of acceptance:

```bash
npm run uat:local        # 27/27 synthetic checks → .data/uat-local-latest.json
npm run staging:preflight
```

## 5. Production promotion

A human must explicitly authorise production deploy. Record who approved, when,
and against which staging run ids in [`docs/production-promote.md`](./production-promote.md).
No agent or CI job may promote.

---

## What is already done

See [`docs/implementation-status.md`](./implementation-status.md). Local gates
that must stay green: `npm run typecheck`, `npm test`, `npm run check:routes`,
`npm run e2e:cycle`, `npm run uat:local`, `npm run smoke:ui`,
`npm run check:responsive`.
