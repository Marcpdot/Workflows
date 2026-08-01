# packages/memory

Short-term SQLite session history + long-term facts API (optional semantic via injected embedder/store).

**Step C** of `docs/PACKAGE_REFACTOR.md`: moved out of `Orchestrator/src/memory`.

| Path | Role |
|------|------|
| `src/memory.ts` / `store.ts` | Session history (`createMemory`) |
| `src/longterm/` | LTM API (`createLongTermMemory`, `resolveLongTermDbPath`) |

Orchestrator depends on `file:../packages/memory` as `@workflows/memory`.

```bash
cd Orchestrator
npm install
npx tsx scripts/smoke-memory.ts
npx tsx scripts/smoke-longterm.ts
```
