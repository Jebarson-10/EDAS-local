# Deployment

## Target

```text
GitHub → Cloudflare Pages build → Preview
                     ↓ (explicit approval)
                Production Pages
                     + Worker/Functions
                     + D1
                     + R2
```

Hostname initially: Cloudflare Pages `*.pages.dev` (e.g. `erode-exam-duty.pages.dev`). Custom domain later without rewrite.

## Environments

| Name | Binding strategy |
|------|------------------|
| desktop | Standalone executable (`npm run desktop:dist`) — Electron + the same API server + SQLite in the OS app-data dir; fully offline, no Cloudflare |
| development | Local Vite; `npm run api:local`; `npm run check:pages:dev` runs the real Pages pipeline (functions + D1) under Miniflare |
| staging (UAT) | Pages **`[env.preview]`** — product ENVIRONMENT stays `staging`. Set `REPLACE_ME_STAGING` D1 id or run `npm run staging:raise`. R2 optional. |
| production | `[env.production]` — set `REPLACE_ME_PRODUCTION`; promote only after UAT + human approval |

Cloudflare Pages only applies `[env.preview]` and `[env.production]`. Do not use `[env.staging]` in the root Pages `wrangler.toml`.

Root and `worker/wrangler.toml` both define preview/production `ENVIRONMENT` vars. Uncomment the preview D1 block and replace placeholder ids before `db:migrate:remote` / Pages deploy, or let `staging:raise` do that from an API token.

## Free-tier awareness

Documented limits at design time (re-check periodically — policies change):

- Workers CPU time (Free): 10 ms / invocation → **solver stays client-side**
- D1 Free: size and daily read/write limits
- R2 Free: storage + Class A/B ops; free egress
- Pages Free: build count limits

## Local D1-shaped persistence

```bash
npm run db:migrate:local   # apply SQL migrations to .data/erode-exam-duty.sqlite
npm run api:local          # http://127.0.0.1:43124 (same repos as Worker)
npm run e2e:cycle          # restore → allocate → persist → publish
```

Transactional restore uses `DbClient.batch` (atomic on D1 and local SQLite). Published `duty_assignment_history` is preserved unless `includeHistory` is explicitly set.

This path is complete on its own: no Cloudflare account, network, or binding is
needed to run the product locally. `POST /api/autosave` writes a canonical snapshot to
`.data/autosave/latest.json` plus a pruned ring of twelve timestamped copies, and the
admin shell calls it automatically after each change. The hosted Worker exposes the
same route backed by R2 and answers `stored: false` when `FILES` is unbound, which is
the honest state for a local-only deployment.

## Remote D1 / Pages (client Cloudflare account required)

Fast path (creates preview D1, migrates, deploys Pages preview — never production):

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
# optional: ACCESS_EMAIL_ROLE_MAP='{"you@domain":"ADMIN"}'   # OQ-010; do not invent officers
npm run staging:raise
```

Manual path:

1. Uncomment and set a real `database_id` under `[env.preview]` in root `wrangler.toml` and `worker/wrangler.toml`.
2. `npx wrangler login` as the client org.
3. `npm run db:migrate:remote -- --env staging`
4. `npm run pages:deploy:preview` — **never** promote production without explicit human approval.

`pages:deploy:preview` deliberately passes no assets directory: a positional path makes
Wrangler ignore `wrangler.toml`, silently dropping `functions/` and the D1 binding while
still reporting a successful deploy. `pages_build_output_dir` supplies the directory
instead, and `npm run check:pages` fails if that regresses.

After a deploy, confirm the API and D1 really shipped:

```bash
STAGING_URL=https://<deployment>.pages.dev npm run uat:staging
```

An HTML response means the SPA answered `/api/health` and the functions were not
deployed; `dbOk: false` means D1 is not bound to the preview environment.

`ENVIRONMENT=staging|production` refuses `X-Dev-Role` spoof headers; Access email required. Role comes from `ACCESS_EMAIL_ROLE_MAP` (OQ-010 client map) or `X-Access-Role` claim — otherwise VIEWER.

Before remote migrate/deploy:

```bash
npm run check:bindings -- --env staging    # fails until preview D1 is uncommented with a real id
npm run check:pages                        # deploy would serve /api, not the SPA shell
npm run check:pages:dev                    # same pipeline + D1 under Miniflare, no account needed
npm run uat:local                          # synthetic evidence pack
```

## Release process

```text
feature branch → PR → automated tests → preview → UAT → approval → production
```

**Never** auto-deploy to production from agent workflows without explicit human instruction.

## Secrets

Set via Cloudflare dashboard / `wrangler secret`. Examples: auth config, backup encryption keys. Never commit `.dev.vars` with real secrets.

## Client ownership

Production Cloudflare account and GitHub repo should belong to the client organization for continuity — see `docs/client-handover.md`.
