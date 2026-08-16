# packages/eval

Evaluation suite (Milestone 1) â€” fixed cases, runner, assertions, token/cost helpers.

**Step A** of `docs/PACKAGE_REFACTOR.md`: moved out of `Orchestrator/src/eval`.

| Path | Role |
|------|------|
| `cases.json` | Fixed eval cases |
| `src/` | Types, assertions, cost helpers, suite runner |
| `Orchestrator/scripts/run-eval.ts` | CLI entry (unchanged command from Orchestrator cwd) |

**Imports:** Orchestrator depends on this package as `@workflows/eval` (`file:../packages/eval`) and imports cost via `@workflows/eval/cost` so Orchestrator `tsconfig` can keep `rootDir: "src"`. Scripts use relative paths + tsx.

```bash
cd packages/orchestrator
npm install
npx tsx scripts/run-eval.ts
npx tsx scripts/smoke-eval-assertions.ts
npx tsx scripts/smoke-eval-cost.ts
```

Runner still wires the Orchestrator package (same handle path as CLI).

Continuous Cognition adds a small JSON-compatible scenario/result shape for
provider/model/tool comparisons without subjective grading or adaptation. From
`packages/orchestrator`, `npm run test:cc` runs the existing WP1-WP7 acceptance
scripts as one suite and writes `data/eval-results/cc/<timestamp>.json`.
