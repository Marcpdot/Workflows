# packages/eval

Evaluation suite (Milestone 1) — fixed cases, runner, assertions, token/cost helpers.

**Step A** of `docs/PACKAGE_REFACTOR.md`: moved out of `Orchestrator/src/eval`.

| Path | Role |
|------|------|
| `cases.json` | Fixed eval cases |
| `src/` | Types, assertions, cost helpers, suite runner |
| `Orchestrator/scripts/run-eval.ts` | CLI entry (unchanged command from Orchestrator cwd) |

```bash
cd Orchestrator
npx tsx scripts/run-eval.ts
npx tsx scripts/smoke-eval-assertions.ts
npx tsx scripts/smoke-eval-cost.ts
```

Runner still wires the Orchestrator package (same handle path as CLI). Cost helpers are imported by orchestrator/policy for token estimates.
