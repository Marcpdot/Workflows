# Work surface

HTTP client of `http://127.0.0.1:8787` only. No second brain.

## Invariants

1. All cognition stays in orchestrator `handle()` / knowledge.
2. One persistent room — pull objects in; do not add scene-switching product UX.
3. System presence first: boot `health` → `status` → `/v1/events`.
4. Default `sessionId` is `surface-main`.
5. English UI copy.
6. Do not implement `POST /v1/voice/turn` until that route is LIVE.
7. Do not copy the M6 chat-app shell as the product.

Contract: `packages/orchestrator/src/integration/surface-contract.md`.
