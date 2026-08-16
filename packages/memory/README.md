# packages/memory

Durable raw experience + short-term SQLite session history + long-term facts API
(optional semantic recall via an injected embedder/store).

**Step C** of `docs/PACKAGE_REFACTOR.md`: moved out of `Orchestrator/src/memory`.

| Path | Role |
|------|------|
| `src/memory.ts` / `store.ts` | Durable experiences and compatible session history (`createMemory`) |
| `src/longterm/` | LTM API (`createLongTermMemory`, `resolveLongTermDbPath`) |

`createMemory()` implements both the existing `Memory` API and the narrower
`ExperienceStore` contract. Chat messages are atomically retained as exact
experience records and as the existing history projection. Other inputs can use
`recordExperience()` directly, including tool activity, human corrections, and
external observations whose payload lives behind `payloadRef`.

Orchestrator depends on `file:../packages/memory` as `@workflows/memory`.

```bash
cd packages/orchestrator
npm install
npx tsx scripts/smoke-memory.ts
npx tsx scripts/smoke-experience.ts
npx tsx scripts/smoke-longterm.ts
```
