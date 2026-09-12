# Erode Examination Duty Allotment System

Production-oriented historical decision engine for theory, practical, and hall examination duty allotment (Erode CEO Office).

**Correctness, auditability, and historical integrity take priority over UI polish.**

## What this application does

This is an offline-first application for 12th-standard public-examination duty
allotment across Erode blocks and centres. It lets the CEO office maintain the
master lists, generate deterministic theory/practical/hall allotments, review
shortages and reasons, approve auditable changes, and export school-wise and
teacher-wise outputs.

- **Theory:** prevents own/clubbed-school and recent-centre conflicts; uses a
  straight-line 10 km home-or-current-school radius; chooses HM/Principal first
  and Senior PG fallback block-first, then district-wide.
- **Practical:** creates balanced 50-student batches, supports distinct
  subjects in parallel, records internal/external examiners and retains annual
  role-switch history.
- **Hall:** calculates one invigilator per 20 students plus 10% standby and
  rotates eligible staff across dates/sessions.
- **Fairness:** recent theory, practical and hall duties are a soft preference;
  a shortage is reported rather than hidden or force-assigned.

The remaining official inputs that are deliberately not guessed are the
Department Officer staffing table by student strength and the formal report
sign-off layout. See [`docs/open-questions.md`](docs/open-questions.md).

**Local slice is frozen.** This HEAD is the in-repo product: deterministic engines, validators, admin UI, local SQLite API, and gated UAT. Do not hunt more inventable honesty bugs unless a named defect is reported. Cloudflare D1/R2, Access/IdP, staging UAT, open-question answers, and production promote stay on the client checklist — [`docs/client-inputs-checklist.md`](docs/client-inputs-checklist.md). Those items cannot be invented; filling `REPLACE_ME` or inventing officers is not progress.

## Stack

- Frontend: React + TypeScript + Vite + Tailwind — bento-grid admin UI, responsive to mobile
- Allocation: deterministic packages in `allocation-engine/` + independent `validator/` (browser Web Worker)
- API: Cloudflare Pages Functions / Workers (`worker/`) — persistence & authZ only
- Data: local SQLite is the default live store and needs no Cloudflare; D1 + R2 bindings are only for hosted staging/production and run the same SQL

## Absolute rules

See [`AGENTS.md`](./AGENTS.md). Never invent business rules; unresolved items live in [`docs/open-questions.md`](docs/open-questions.md).

## Standalone desktop app

The product also ships as a single offline executable: an Electron window around the
same API server and SQLite database, with no Cloudflare or browser setup. It works
without internet; the only optional network action is checking GitHub Releases for
an application update after it has been installed.

```bash
npm install
npm run desktop:dev               # run the packaged app from source
npm run desktop:dist              # Linux AppImage → release/
npm run desktop:dist:win:portable # Windows portable ZIP → release/
npm run desktop:dist:win          # Windows installer
npm run desktop:dist:mac          # macOS dmg — needs macOS
```

For automatic updates, install the Windows `Erode-Exam-Duty-Setup-<version>.exe`
from GitHub Releases. The portable ZIP can still be used without installation, but
portable copies cannot update themselves.

On first launch the application creates its database and applies the SQL
migrations under the OS app-data directory — on Linux
`~/.config/exam-duty-allotment/data/`, on Windows `%APPDATA%\exam-duty-allotment\data\`.
File → Open data folder reveals it, and copying that folder is a full backup. The window
binds a free loopback port; nothing is exposed to the network.

The installed desktop app starts with no sample blocks, schools, centres,
teachers, duty history or exports. Enter or import only the official records
you intend to use. Reference subjects and configurable rule settings are kept
so the entry forms and allocator can operate.

### Timetable and fairness

In **Exam cycle → Exam timetable**, add each official date, morning/afternoon
session and subject/paper. Mark whether that session needs Chief duty and/or
Hall duty. Theory and Hall allocation use those exact marked sessions; they do
not invent a placeholder date.

The Master data teacher table shows each teacher's latest recorded duty date.
When otherwise eligible teachers are compared, the one whose last duty is
older is considered first; normal seniority is used only as a deterministic
tie-breaker. The configured fairness window controls how long a recent duty
affects this preference.

### Tamil display

Choose **தமிழ்** in the header to use Tamil navigation labels. Tamil names,
schools, subjects and timetable text can be entered directly as Unicode Tamil.
The font selector supports Unicode Tamil (recommended) and optional Bamini,
Vanavil and TACE16 fonts when those fonts are installed on the PC. Legacy font
encodings are not converted automatically; keep official data in Unicode where
possible so it is searchable and exports consistently.

When internet is available, an installed app checks GitHub Releases shortly after
opening. If a newer version exists, it asks before downloading it and asks again
before installing and restarting. It never downloads or replaces the application
silently, and the SQLite data folder is kept during the update.

### Publishing an update

Every push to `main` runs **Release Windows desktop app**. The workflow verifies
the source, assigns the next automatic version, builds an NSIS installer plus its
update manifest and block map, and publishes them as a GitHub Release. A manual
run may provide a version such as `0.1.25`. The installer, `latest.yml`, and
block map must remain together in the release; they are what enables in-app
updates. Builds are unsigned until a Windows code-signing certificate is
configured as a GitHub secret.

### Operator workflow

1. Start in **Master data**. Add/update blocks, then schools and centres, then
   teachers. The teacher form filters schools by the chosen block. Coordinates,
   capacity/student strength, designation, subject and seniority are required so
   incomplete records do not silently enter the allocator.
2. Import any current spreadsheet data if available; inspect the preview and
   correct issues. Imports update current master data only — never prior duty
   history.
3. Create/select an exam cycle and rule version, then generate Theory,
   Practical and Hall allocations. Read all shortage and rule-reason output.
4. Record authorised manual exemptions/overrides as an administrator; every one
   is audited. Publish only after validation succeeds.
5. Export the school-wise and teacher-wise reports, and keep the automatic local
   backup snapshots.

The desktop edition is a single-user local application and always opens with full
operator access. Hosted deployments still require Cloudflare Access claims
(OQ-010).

If you would rather use a browser than a desktop window:

```bash
npm run app              # builds, then serves UI + API on http://127.0.0.1:43126
```

## Quick start (local development)

```bash
npm install
npm run seed:synthetic   # large synthetic JSON + consistent UI demo slice
npm test
npm run api:local        # http://127.0.0.1:43124 — SQLite at .data/erode-exam-duty.sqlite
npm run dev              # http://127.0.0.1:43123 (proxies /api → 43124)
# or both:
npm run dev:full
```

Allocation runs entirely in the browser. The local API (and Cloudflare Worker when D1/R2 are bound) persists runs, publish → history, imports, backups, and transactional restore.

Nothing here needs a Cloudflare account. `.data/erode-exam-duty.sqlite` is the live
development store, and the admin shell autosaves a JSON snapshot after every change.
The desktop application keeps `latest.json` plus the last twelve rotating snapshots,
so a crash costs at most the current edit. Restore them from **Backups → Restore**.

```bash
npm run e2e:cycle        # restore → allocate → persist → publish against SQLite
npm run uat:local        # synthetic UAT evidence pack (.data/uat-local-latest.json)
npm run staging:preflight # inventable staging gate (bindings still client-blocked until REPLACE_ME filled)
npm run check:routes     # Worker ↔ local API route inventory parity
npm run check:bindings   # reports REPLACE_ME; `-- --env staging` fails until preview D1 is set
npm run check:pages      # a Pages deploy would really serve /api (functions + wrangler.toml)
npm run check:pages:dev  # runs the Pages pipeline + D1 under Miniflare — no Cloudflare account
npm run check:app        # standalone install gate: fresh SQLite, SPA deep links, no traversal
npm run staging:raise    # live Pages preview + D1 when CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are set
npm run uat:staging      # STAGING_URL=… probe of the deployed /api/health for dbOk
npm run smoke:ui         # headless walkthrough: import → allocate → publish → reports
npm run check:responsive # dashboard renders at 420 / 820 / 1440 px
npm run load:theory      # 5k teachers / 350 centres
```

`smoke:ui` and `check:responsive` need `npm run dev` already listening on 43123;
`staging:preflight` skips them when it is not.

## Workspaces

| Path | Purpose |
|------|---------|
| `frontend/` | Officer admin UI |
| `allocation-engine/` | Deterministic theory/practical/hall solvers |
| `validator/` | Independent validation + conflict engine |
| `shared/` | Types, geo, import preview |
| `worker/` | Cloudflare API + shared SQL repos |
| `database/` | SQL migrations & seeds |
| `docs/` | Product & engineering documentation |

## Environments

`development` → `staging` → `production`. **Never deploy to production without explicit human approval.**

## Synthetic data only

Fixtures and seeds contain no real teacher PII or government credentials.

## Offline OpenStreetMap coordinate lookup

`frontend/public/offline-geocode-index.json` is a compact Erode-area search
index derived from OpenStreetMap data. In **Master data**, enter a school name,
locality or address and choose a suggested coordinate; the operator must verify
the suggestion before saving. It works without internet after installation.

The raw GeoPackage is intentionally not committed. To refresh the index from a
new OpenStreetMap GeoPackage extract:

```bash
npm run maps:build-index -- path/to/erode.osm.gpkg
```

Contains OpenStreetMap data © OpenStreetMap contributors, available under the
Open Database Licence (ODbL).

## Verification

```bash
npm run typecheck
npm test
npm run desktop:dist:win:portable
```

The test suite covers rule parameters, history, deterministic theory/practical/hall
allocation, independent validation, authorization and SQLite persistence.
# Schools, teachers and app updates

- Add blocks, then schools, then teachers in **Schools & teachers**.
- **Centre code is the school code.** Leave it blank for a school that is not an exam centre. A coded school automatically creates its centre and host-school link. Names, locations and blocks stay in sync.
- To stop using a school as a centre, select the school for editing and clear its centre code. The centre becomes inactive; earlier duty records remain available. Enter actual student counts for hall allotment.
- Employee codes are not required. Select a teacher by name to edit them. The app keeps private identifiers so identical names do not overwrite each other.
- The teacher Excel template uses **School name** and optional **Centre code**, with no employee-code column. Add the schools first. Imports match a teacher's name and school; duplicate names at the same school must be entered or edited individually. For a transfer or name change, edit the existing teacher rather than importing them as a new person. Older files containing employee codes remain supported.
- The **Activity log** records changes, imported files, teacher replacements and downloaded reports. **Help & guide** explains each section. Developer diagnostics and sample-data entry controls are not shown.
- Every push to `main` runs tests and builds a Windows installer. A successful release includes the installer, `latest.yml`, a block map and SHA-256 checksum. Installed apps check for a newer release when opened and ask before downloading and restarting to install it. A failed build does not replace the previous release.

Developer compatibility note: existing database identities and duty history are retained. Uncoded schools use private `__school_` storage keys; these are returned as blank centre codes in the app. Backup restore recreates those private keys for blank-code schools. Migration `004_school_centres` aligns existing school codes with centres without deleting old records. Desktop packaging uses `--publish never`; the release workflow publishes all completed update assets together.
