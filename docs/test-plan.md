# Test Plan

## Levels

| Level | Scope |
|-------|-------|
| Unit | eligibility, distance, batching, scoring, constraints, import row validation |
| Integration | API authZ (VIEWER GET imports / cannot apply), import apply + history, run persistence, override + revalidate |
| Engine | theory / practical / hall full pipelines with fixtures |
| Validator | independent checks vs known good/bad allocations |
| Adversarial | cases in master spec §99 |
| Load | synthetic ~15 blocks, 350 centres, 5k teachers |
| E2E | full exam-cycle simulation in UI/API |
| Security | authZ negative tests, injection on import |

## Absolute test requirements

- Every implemented business rule has automated tests.
- Determinism: same snapshot + rules + algorithm + seed → identical output.
- Validator rejects hard violations; publish blocked when INVALID.
- History never deleted by import tests.
- Synthetic data only.

## Adversarial cases (must handle explicitly)

1. No HM available  
2. Insufficient PG teachers  
3. Every nearby centre prohibited  
4. Teacher worked all nearby centres in lookback  
5. All candidates exempted  
6. Three schools share one centre  
7. Teacher transferred between schools  
8. Teacher has different historical school  
9. Teacher already has duty same session  
10. Practical cannot finish within completion days  
11. Annual role switching for pair  
12. Import duplicates  
13. Import changes teacher school  
14. DB has data absent from Excel  
15. Historical data contradicts current input (transfer semantics)

## CI

PR runs: lint, typecheck, unit/integration/engine tests, build.  
Production promote only after human approval post-UAT.
