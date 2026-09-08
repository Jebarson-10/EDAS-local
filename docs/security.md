# Security

## Threat model (summary)

Unauthorized allotment changes, data exfiltration of teacher PII/coordinates, tampering with published history, injection via Excel import, CSRF on state-changing APIs, privilege escalation via UI-only checks.

## Controls

| Control | Implementation intent |
|---------|----------------------|
| Transport | HTTPS (Pages) |
| Auth | Managed (Cloudflare Access preferred); no custom weak password DB |
| AuthZ | Role checks on every Worker handler; Access role via `ACCESS_EMAIL_ROLE_MAP` (OQ-010) or claim header — never invented in code |
| SQL | Parameterized queries only |
| Input | Schema validation on imports (Zod in shared); Worker bodies type-checked at boundary |
| Output | Encode in UI; careful file exports |
| Headers | Security headers on Pages (`_headers`) + API JSON responses |
| CSRF | N/A for Access JWT / header auth (no cookie session); Vite proxy is same-origin locally |
| Headers | `_headers` includes CSP, frame deny, nosniff; API JSON sets cache-control no-store |
| Rate limit | Soft in-memory limits on import apply/upload, backup, restore (`worker/src/rateLimit.ts`); pair with Cloudflare Access / WAF in staging |
| Secrets | Wrangler secrets / env; never in Git |
| Audit | All sensitive actions logged |
| Session | Expiry via managed access policies |
| Least privilege | Role matrix |

## Roles

ADMIN, OFFICER, DATA_OPERATOR, VIEWER — see product spec.

## Location privacy

Prefer showing eligibility + distance in UI/reports over raw home coordinates unless explicitly required.

## Real data

Development and CI use **synthetic** data only. No real employee numbers, addresses, or credentials in fixtures.

## Database exposure

```text
Browser → Worker API → D1
```

D1 is never exposed to the browser.

## Production AI

No OpenAI/Claude/Gemini/etc. dependency for normal production operation.
