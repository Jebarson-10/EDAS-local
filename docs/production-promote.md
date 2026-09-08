# Production promote record

Production deploy is forbidden until a human fills this file. Agents and CI
must not promote. Do not invent an approver.

| Field | Value |
|-------|-------|
| Approver name | |
| Approver role | |
| Date (ISO) | |
| Staging Pages URL | |
| Staging UAT evidence (`.data/uat-staging-latest.json` checksum or path) | |
| Theory run id | |
| Practical run id | |
| Hall run id | |
| Decision | pending / approved / rejected |
| Notes | |

After approval, deploy is still a **manual** `wrangler pages deploy` to
production by that human — not `staging:raise`, not GitHub Actions `staging.yml`.
