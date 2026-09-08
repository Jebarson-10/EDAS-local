# Erode Examination Duty Allotment System

Production-oriented historical decision engine for theory, practical, and hall examination duty allotment (Erode CEO Office).

**Correctness, auditability, and historical integrity take priority over UI polish.**

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
same API server and SQLite database, with no Cloudflare, no browser setup, and no
network access at all.

```bash
npm install
npm run desktop:dev               # run the packaged app from source
npm run desktop:dist              # Linux AppImage → release/
npm run desktop:dist:win:portable # Windows portable zip — builds on any OS
npm run desktop:dist:win          # Windows installer — needs Windows or wine
npm run desktop:dist:mac          # macOS dmg — needs macOS
```

The portable Windows zip is the artifact to hand over when you are not building on
Windows: unzip it anywhere and run `Erode Exam Duty.exe`, no install and no admin
rights. The NSIS installer additionally needs wine when built from Linux.

The build is a single file in `release/` (about 117 MB) and needs nothing installed on
the operator's machine. On first launch it creates its database, applies the SQL
migrations and seeds the synthetic dataset under the OS app-data directory — on Linux
`~/.config/exam-duty-allotment/data/`, on Windows `%APPDATA%\exam-duty-allotment\data\`.
File → Open data folder reveals it, and copying that folder is a full backup. The window
binds a free loopback port; nothing is exposed to the network.

Since there is no identity provider on a desktop install, the header role switcher is
the identity for that machine. Hosted deployments still refuse those headers and require
Cloudflare Access claims (OQ-010).

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
store, and the admin shell autosaves a JSON snapshot to `.data/autosave/` after every
change — the header badge shows the last save time and saves on click. The last twelve
snapshots are kept alongside `latest.json`, so a crash costs at most the current edit.
Restore any of them from Backups → Restore.

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
