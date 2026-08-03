# Interaction Mode + Continuous Capture — Iteration

## Status of foundation (04415a5)

Delivered and accepted as foundation:

- Session-persisted `interactionMode` (`active` | `neutral`) and `proposalsEnabled`
- Slash commands: `/mode`, `/proposals on|off`, `/capture`, `/accept`, `/reject`
- Continuous capture path → pending proposals only (propose → accept gate intact)
- Extended chat response (`interactionMode`, `proposals`, `pendingProposalCount`, `capture`)
- Web UI: mode toggle + proposals panel + basic accept/reject
- Smoke for mode persistence, capture → pending, accept, substance skip

This is **not** complete relative to the original design (`docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md`). The gaps below are the next required work.

## Goal of this iteration

Raise the foundation to the standard required for daily free-form reasoning:

1. Continuous capture produces proposals worth accepting (especially from first-principles style dialogue).
2. The proposals panel is a reliable session-scoped queue, not just “new this turn”.
3. Active mode changes AI behaviour (sparring), not only whether capture runs.
4. Long sessions remain stable and low-noise.

Graph stays general. No FP-specific node types. Human still controls permanent writes.

---

## 1. Capture quality (highest priority)

### Problem
Generic extraction on conversation turns produces too much noise and too few high-value structural claims/relations for deep reasoning sessions.

### Requirements

**Conversation-optimised extract profile**
- Dedicated prompt / extract path when `sourceType === "conversation"` (or equivalent continuous-capture path).
- Optimised to surface:
  - Causal chains (A causes / requires / limits B)
  - Limits with classification as **properties** on claims/nodes: `fundamental | technological | industrial | economic | regulatory`
  - Next-bottleneck structure (“if X is solved → Y becomes the constraint”)
  - Explicit assumptions and open questions
  - Scaling consequences where stated
- Prefer typed edges already in the vocabulary (`requires`, `limits`, `causes`, `increases`, `reduces`, `supports`, `contradicts`, `part_of`, `about`, …). Do not invent FP-only types.

**Dedupe and ranking**
- Stronger identity check against both **accepted** and **pending** before creating new proposals (reuse/extend M15 resolve/alias logic).
- Rank or filter so the most structural proposals surface first; hard cap per turn remains (default ≤ 8).
- Substance heuristic stays; improve it so short acknowledgements and pure process talk do not trigger extract.

**Provenance**
- Every proposal must retain clear `sourceRef` back to session + turn so the UI can link later.

### Done when
A realistic 10–15 minute free-form first-principles (or equivalent deep) dialogue produces a majority of proposals the user would actually accept, with correct relation types and useful limit classification as properties.

---

## 2. Proposals panel as real session queue

### Problem
Panel is driven mainly by `proposals` from the last response. It is not a trustworthy view of all pending work for the session.

### Requirements

- Always load and display **all pending** proposals scoped to current session / workspace (query knowledge store, not only last response payload).
- Refresh button (and session change) re-fetches from store.
- Each card shows: kind, label, relation (if edge), confidence if present, and source (turn / sourceRef).
- Where sourceRef allows, provide a way to jump back to the relevant conversation turn.
- Accept / reject (single and batch) update the full queue immediately.
- Clear distinction between “no pending in store” vs “failed to load”.

### Done when
Switching session or reopening the UI restores the correct pending set. Accepting items removes them from the full queue. Source links work for proposals created in the current session.

---

## 3. Active mode = sparring behaviour

### Problem
`interactionMode` currently gates capture only. Reply style is the same in active and neutral.

### Requirements

- When `interactionMode === "active"`, the system prompt / turn instructions must direct the model to:
  - Challenge assumptions
  - Ask whether a limit is fundamental vs contingent (or the broader classification)
  - Suggest missing branches or the next bottleneck question
  - Help the user formulate clearer claims **without taking over the analysis**
- When `neutral`, replies stay minimal and non-challenging; capture only on explicit `/capture` or equivalent.
- Mode change takes effect on the **next** model turn (not only as a flag in metadata).

### Done when
Side-by-side use of active vs neutral on the same topic produces clearly different conversational behaviour, while capture rules remain as designed.

---

## 4. Robustness for long sessions

### Requirements

- Rate-limit / backoff continuous extract (do not extract on every short or low-substance turn).
- `capture` metadata in response always present when the path was considered: `{ ran, reason?, mode? }`.
- Extract failures must not break or replace the main reply.
- `pendingProposalCount` is consistently session/workspace-scoped and matches what the panel shows.
- No regression in existing smoke for mode, force capture, accept, and substance skip.

### Done when
Long sessions (30+ turns) stay responsive, do not flood pending with junk, and recover cleanly after extract errors.

---

## 5. Context and design traceability

### Requirements

- Update `context/knowledge.md` and `context/interface.md` with:
  - Foundation delivered (04415a5)
  - This iteration’s three primary open gaps (capture quality, panel as queue, active sparring)
- Add a short **Implementation status** section to `docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md` pointing at this iteration doc and the foundation commit.

### Done when
A reader of context/ can see what is live, what is next, and where the authoritative design lives.

---

## Implementation order

1. Capture quality (conversation extract profile + dedupe/ranking)
2. Proposals panel as full session queue
3. Active-mode sparring instructions
4. Robustness + context updates

Ship as one coherent iteration if possible; otherwise land 1 → 2 first so the capture path is already useful before UI polish.

## Explicit non-goals (unchanged)

- Auto-accept under any confidence
- FP-specific core node types
- Automatic full first-principles analysis generation as the primary path
- Replacing the general graph model
- A second brain or parallel knowledge system

## Success criteria for the iteration

- Free-form deep reasoning sessions produce pending proposals the user regularly accepts.
- The proposals panel is the place you trust for “what is waiting from this session”.
- Active vs neutral feels different in conversation, not only in metadata.
- The path remains propose → human accept, general graph, same orchestrator.
