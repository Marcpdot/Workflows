# Interaction mode + continuous knowledge proposals

## Goal

Enable free-form reasoning sessions (especially first-principles style) where the human drives the analysis, AI can actively spar, and the system continuously proposes structured knowledge entries that land in the general knowledge graph via the existing propose → accept gate.

This is **not** automatic full analysis generation. The human (with optional AI sparring) produces the reasoning. The system captures and structures it.

## Core requirements

1. **Interaction mode** per session: `active` | `neutral`
   - Default: `active`
   - Persisted with session so it survives restart
   - `active`: AI sparring + continuous proposal generation
   - `neutral`: minimal replies + proposals only on explicit request

2. **Continuous proposals** (active mode only)
   - After substantial user turns, run a light extract → `addProposals`
   - Always pending; never auto-accept
   - Dedupe against existing accepted + pending
   - Cap per turn (default 6–8)

3. **Explicit controls** via slash commands and/or natural language
4. **Web UI** shows mode indicator + pending proposals panel with accept/reject
5. Graph remains general. This is a usage pattern on top of existing knowledge packages.

## Out of scope

- Auto-accept of any proposals
- Making the knowledge graph FP-specific
- Full automatic FP analysis generation as primary path
- Heavy new UI framework / SPA rewrite
- Ambient voice / always-listening

## Session state extension

```ts
export type InteractionMode = "active" | "neutral";

// Add to existing SessionState
interface SessionState {
  // ... existing
  interactionMode: InteractionMode; // default "active"
  proposalsEnabled?: boolean;       // default true when active
}
```

Persist with the same mechanism already used for session data.

## Chat API contract

### Request (existing + optional override)

```ts
interface ChatRequest {
  prompt: string;
  sessionId?: string;
  workspaceRoot?: string;
  options?: {
    toolsEnabled?: boolean;
    interactionMode?: InteractionMode; // optional one-shot override
  };
}
```

Mode is primarily changed via slash commands inside `prompt`.

### Response extension

```ts
interface ChatResponse {
  reply: string;
  sessionId: string;
  // ... existing fields (provider, model, routing, latencyMs, toolSteps, suggestions, ...)

  interactionMode: InteractionMode;
  proposals?: KnowledgeProposalSummary[];
  proposalCount?: number; // total pending for session/workspace (optional)
}

interface KnowledgeProposalSummary {
  id: string;
  kind: "node" | "edge" | "evidence";
  label: string;
  relation?: string;
  confidence?: number;
  sourceRef?: string;
  createdAt: number;
}
```

## Slash commands (early parse in handle)

| Command              | Effect |
|----------------------|--------|
| `/mode`              | Show current mode |
| `/mode active`       | Set interactionMode = "active" |
| `/mode neutral`      | Set interactionMode = "neutral" |
| `/proposals`         | List pending (or point to UI) |
| `/proposals off`     | Temporarily disable continuous extract |
| `/proposals on`      | Re-enable |
| `/capture`           | Force extract on last user turn (works in both modes) |
| `/accept <id>`       | Accept proposal (reuse knowledge tool path) |
| `/reject <id>`       | Reject proposal |

Natural language fallbacks are nice-to-have, not required for the shell.

## Continuous extract (active mode)

Trigger after a substantial user turn when:
- `interactionMode === "active"`
- `proposalsEnabled !== false`
- Message is not a pure acknowledgement

Flow:
1. Take recent turns (last user message + light context)
2. Run structured extraction (reuse `@workflows/structured` + knowledge extract helpers)
3. `createEvent({ sourceType: "conversation", sourceRef: `${sessionId}:${turn}` })`
4. `addProposals(...)`
5. Return summaries in `ChatResponse.proposals`

Reuse existing identity / light dedupe. Never write accepted nodes automatically.

## Knowledge side

Minimal changes. Prefer existing `listProposals`, `acceptProposal`, `rejectProposal`.

If needed for clean UI filtering, allow filtering proposals by session via `sourceRef` or a lightweight metadata field. Do not invent a second proposal store.

## Web UI changes (minimum viable)

Current shell is minimal (chat + sidebar metadata). Extend with:

1. **Mode badge** — always visible (`Active` / `Neutral`). Click or `/mode` to change.
2. **Proposals panel** — list of pending proposals for the session with:
   - kind, short label, relation (if edge), confidence
   - Accept / Reject actions per item
   - Optional batch accept/reject with confirmation
3. When `proposals` arrive in a response, refresh the panel.
4. Accept/Reject can be implemented by sending `/accept <id>` / `/reject <id>` as prompts, or by thin dedicated endpoints that wrap the knowledge store. Slash path is acceptable for the first vertical.

Do not turn the UI into a full product. Keep it a shell over the same orchestrator path.

## Implementation order (recommended)

1. SessionState + persistence of `interactionMode`
2. Early slash parsing for `/mode`, `/proposals on|off`, `/capture`
3. Continuous extract hook + `ChatResponse.proposals`
4. Wire accept/reject (slash or thin API)
5. Web UI: mode badge + proposals panel
6. Smoke: mode switch persists, active produces proposals, neutral does not, accept works, UI reflects state

## Env / flags

- No new required env for basic function.
- Optional: `KNOWLEDGE_CONTINUOUS_PROPOSALS=true` (default on when mode active) for global kill-switch if desired.
- Keep existing `KNOWLEDGE_TOOLS_ENABLED` / inject flags unchanged.

## Done when

- [ ] Session remembers `interactionMode` across process restarts
- [ ] `/mode active|neutral` works and is reflected in every chat response
- [ ] In active mode, substantial turns produce pending proposals (capped, deduped)
- [ ] In neutral mode, continuous proposals are off; `/capture` still works
- [ ] Accept/reject works and removes/updates pending list
- [ ] Web UI shows mode + pending proposals with basic accept/reject
- [ ] Offline/smoke coverage for the above paths
- [ ] No auto-accept; graph write path remains propose → human accept

## Design rationale (Keep the Why)

- Human stays in the driver’s seat for first-principles and deep reasoning.
- Continuous proposals lower the friction of capture without polluting the permanent graph.
- Mode persistence removes repeated setup cost.
- Reuses existing knowledge propose/accept, structured extract, session, and UI shell — no parallel brain.
