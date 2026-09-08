# Admin guide (staging / production prep)

## Environments

`desktop` (standalone executable, offline) and `development` (local SQLite API) →
`staging` (Cloudflare preview + D1/R2) → `production` (explicit human promote only).

## Desktop install (offline)

`npm run desktop:dist` produces one executable in `release/` (AppImage on Linux). For
Windows, `npm run desktop:dist:win:portable` builds a portable zip from any OS — unzip
and run `Erode Exam Duty.exe`, no install and no admin rights; the NSIS installer
(`desktop:dist:win`) needs Windows or wine, and the macOS dmg needs macOS. Hand the
operator that single artifact — nothing else is needed and the machine never has to
reach the internet.

The database, uploaded source files and autosave snapshots live under the OS app-data
directory (`~/.config/exam-duty-allotment/data/` on Linux,
`%APPDATA%\\exam-duty-allotment\\data\\` on Windows), reachable from File → Open data
folder. Copy that folder for an offline backup, or use Backups → Download for an
encrypted archive. Only one window runs per install, because two shells on one SQLite
file would race.

A desktop install has no identity provider, so the header role switcher is the identity
for that machine and the app listens only on loopback. Do not treat it as an authority
boundary — that is what Cloudflare Access provides for hosted deployments (OQ-010).

## Local

```bash
npm install
npm run api:local    # :43124 SQLite
npm run dev          # :43123 UI
npm test && npm run e2e:cycle
```

## Cloudflare staging (client account)

Fast path: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` then `npm run staging:raise`.

1. Preview D1 lives in `[env.preview]` (Pages does not apply `[env.staging]`).
2. `npx wrangler login` as the **client** org, or use the token path above.
3. `npm run db:migrate:remote -- --env staging`
4. Configure Cloudflare Access; map groups to ADMIN/OFFICER/DATA_OPERATOR/VIEWER (OQ-010 — do not invent emails).
5. `npm run pages:deploy:preview`
6. `ENVIRONMENT=staging|production` refuses `X-Dev-Role` spoof headers.

## Autosave

The header badge next to the API status shows when the last snapshot was written and
saves immediately when clicked. Snapshots land in `.data/autosave/` (`latest.json` plus
the twelve most recent timestamped copies). An autosave whose payload matches the last
one reuses that slot instead of rotating the history, so reloads cannot evict real edits.
VIEWER sees the badge as read-only because autosave is a `master.write` action.

Autosave writes no audit entry: `audit_logs` are part of the snapshot, so auditing the
write would make every following snapshot differ, and the trail exists to explain
allotment decisions rather than machine copies. Autosave is a crash copy, not the
archive — use an encrypted Backups download for handover.

## Restore

Backup page: decrypt preview → ADMIN confirm → transactional restore → reload from D1. Encrypted download uses the server-canonical snapshot when the API is up. The memory fallback omits wipe-trigger keys (`teacher_exemptions`, teacher history, `exam_cycles`, `audit_logs`, `allocation_runs`, `examiner_pairs`, …) so restoring that file cannot drop those live tables. Published `duty_assignment_history` is preserved unless `includeHistory` is explicitly requested.

## Rules

Changing parameters requires a **new rule version** — never silent edits to the active version.

## Handover

See `docs/client-handover.md`. Do not leave cloud ownership solely under an individual developer.
