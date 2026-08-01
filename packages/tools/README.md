# packages/tools

Tool registry, builtins, path safety, parseToolCalls, runToolLoop.

**Step D** of `docs/PACKAGE_REFACTOR.md`: moved out of `Orchestrator/src/tools`.

Orchestrator depends on `file:../packages/tools` as `@workflows/tools`.

```bash
cd Orchestrator
npm install
npx tsx scripts/smoke-tools.ts
npx tsx scripts/smoke-tools-phase-c.ts
npx tsx scripts/smoke-tool-loop.ts
```
