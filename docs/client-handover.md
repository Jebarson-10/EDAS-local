# Client Handover

## Inputs we still need from the client

[`docs/client-inputs-checklist.md`](./client-inputs-checklist.md) is the single
fill-in-the-blanks page for Cloudflare bindings, the Access role map (OQ-010),
open-question answers, staging UAT sign-off, and the production promote
authorisation. Engineering cannot invent any of these.

## Deliverables

- GitHub repository (client-owned)  
- Cloudflare account ownership transfer / client billing profile  
- Production URL (`*.pages.dev` or custom domain)  
- Staging URL  
- Backup procedure (`docs/disaster-recovery.md`)  
- Restore procedure  
- User guide (officer workflows) — `docs/officer-guide.md`  
- Admin guide (users, rules, restore) — `docs/admin-guide.md`  
- Technical architecture (`docs/architecture.md`)  
- Rules documentation (`docs/rules.md`)  
- Data dictionary (`docs/data-dictionary.md`)  
- Open questions status  

## Continuity requirement

Do not leave production access solely under an individual developer account.

```text
Developer leaves → client must retain cloud + repo access
```

## Credentials

Hand over Access policies, Wrangler deploy rights, R2/D1 bindings documentation — never commit secrets to the repo.
