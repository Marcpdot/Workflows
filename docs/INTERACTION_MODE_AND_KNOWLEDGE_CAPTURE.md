# Interaction Mode + Continuous Knowledge Capture

## Purpose

Enable free-form, high-quality reasoning sessions (including first-principles analysis) where the human drives the thinking, AI can actively spar and challenge, and every valuable piece of structure is continuously captured into the general knowledge graph with full provenance, typed relations, and an explicit accept gate.

This is a core capability of the system, not a thin add-on. The interface, session model, proposal engine, and knowledge integration are designed together so that deep reasoning becomes the natural way of working with the system.

## Implementation status

| Milestone | Commit / doc | State |
|-----------|--------------|--------|
| Foundation | `04415a5` | Delivered — mode, slash cmds, continuous capture→pending, response fields, basic panel |
| Iteration (quality, queue, sparring, robustness) | [`INTERACTION_CAPTURE_ITERATION.md`](./INTERACTION_CAPTURE_ITERATION.md) | Delivered as shell — conversation extract, session queue API/UI, dual prompts, rate-limit |

Authoritative product design remains this document; iteration doc tracks gaps closed after foundation.

## Design principles

- The knowledge graph stays **general**. First-principles (and any other deep analysis) is a usage pattern, not a specialisation of the core model.
- The human remains in control of what becomes permanent knowledge. AI proposes; the human accepts.
- Capture friction must be extremely low, otherwise the graph stays empty and the system fails its purpose.
- Mode (active vs neutral) is a first-class, persistent property of the session.
- The web interface is a real working surface for this workflow, not a minimal chat shell with a couple of extra widgets.
- Everything routes through the existing orchestrator, model routing, tools, and knowledge packages. No parallel brain.

## Target experience

You open the web UI (or continue a previous session). The system is in **active** mode by default.

You reason freely about a domain, a system, a bottleneck, a scaling question, or anything else. You can ask simple questions, explore branches, challenge assumptions, or work through a full first-principles tree.

While you work:
- The AI sparring partner challenges, asks the hard questions, points out missing links, and helps you formulate clearer claims.
- In the background (and visible in the UI), the system continuously extracts structured proposals (concepts, claims, relations, evidence) from the conversation and puts them in a pending queue tied to the session.
- You review, edit, accept or reject proposals as you go, or in batches.
- At any time you can switch to **neutral** mode (system becomes quiet, only stores when explicitly asked). The mode is remembered for the next time you open the same session.

The result is that high-quality reasoning is automatically turned into a durable, queryable, relational knowledge base without forcing you into rigid forms or requiring you to manually structure everything yourself.

## Architecture

### 1. Session model (first-class)

```ts
export type InteractionMode = "active" | "neutral";

interface SessionState {
  // existing fields...
  interactionMode: InteractionMode;     // default "active", persisted
  proposalsEnabled: boolean;            // default true when active
  lastExtractTurnId?: string;           // for rate limiting / continuity
  knowledgeCaptureConfig?: {
    maxProposalsPerTurn: number;        // default 8
    minUserMessageLength: number;       // simple substance heuristic
    autoExtract: boolean;               // tied to mode + proposalsEnabled
  };
}
```

Mode and capture settings survive process restarts and are restored when the session is resumed.

### 2. Proposal engine (continuous + explicit)

Two paths, same destination:

**Continuous (active mode)**  
After every substantial user turn the orchestrator runs a structured extraction pass over the recent context. Output becomes pending proposals via the existing knowledge store (`createEvent` + `addProposals`). Light deduplication against accepted + pending nodes/edges is required. Hard cap per turn.

**Explicit**  
`/capture`, “lagre dette”, or UI action forces an extract on the current/last segment regardless of mode.

All proposals carry full provenance back to the session and turn. Never auto-accept.

### 3. Orchestrator integration

- Early command parsing for mode and capture controls before normal routing.
- After the main reply is produced, if conditions are met, run the extract pass and attach results to the response.
- The reply itself can reference the new proposals (“I have proposed 5 new relations from this branch — see the panel”) when it improves the conversation, but the AI should not become a proposal-spam bot.

### 4. API contract

**Chat response (extended)**

```ts
interface ChatResponse {
  reply: string;
  sessionId: string;
  // existing: provider, model, routing, latency, tools, suggestions...

  interactionMode: InteractionMode;
  proposals?: KnowledgeProposalSummary[];   // newly created this turn
  pendingProposalCount?: number;            // total open for this session/workspace
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

**Commands (primary control surface)**

- `/mode` / `/mode active` / `/mode neutral`
- `/proposals` / `/proposals on` / `/proposals off`
- `/capture`
- `/accept <id>` / `/reject <id>` (and batch variants)

Accept/reject can also be exposed as thin dedicated endpoints for a cleaner UI, but the slash path must work so CLI and agents stay consistent.

### 5. Web interface (full working surface for this workflow)

The current M6 chat shell is insufficient. The interface must support the reasoning + capture loop as a primary activity.

Required capabilities:

- Persistent mode indicator (always visible, one-click or command to toggle).
- Dedicated, always-available **proposals panel** (or dock) showing pending items for the current session/workspace, with:
  - Kind, label, relation, confidence, source turn
  - Inline accept / reject / light edit
  - Batch actions
  - Clear empty state and count
- Ability to jump from a proposal back to the conversation turn that generated it (when sourceRef allows).
- Session selector that restores mode and pending proposals correctly.
- Visual distinction between active sparring replies and pure capture/system messages.
- The composer and conversation remain free-form; no forced multi-step wizard.

The UI is still “just” a client of the orchestrator. All intelligence stays in the backend. But the client must be good enough that the workflow is actually usable for serious reasoning sessions lasting tens of minutes to hours.

### 6. Knowledge layer usage

No changes to the core node/edge/claim model. The power comes from:

- High-quality continuous extraction into the existing general types and relations.
- Tight provenance (`sourceType: "conversation"`, session + turn references).
- Identity and light dedupe so the graph does not explode with near-duplicates during long sessions.
- Project/workspace binding so captured reasoning can be attached to the work it belongs to.

First-principles style output (goals, laws, absolute vs contingent limits, bottlenecks, next-bottleneck chains, open questions, scaling consequences) is expressed using the general vocabulary. The capture engine and prompts are responsible for producing good structure; the graph itself stays domain-general.

## Implementation priorities

1. Session model + persistent `interactionMode` + command handling
2. Continuous + explicit proposal generation path with provenance and caps
3. Extended chat response + accept/reject paths
4. Web UI that makes the mode + proposals panel a first-class part of the experience
5. Robustness: dedupe, rate limiting, substance heuristics, recovery of pending proposals on session resume

## Success criteria

- You can start a free-form reasoning session and have valuable structure appear as pending proposals without leaving the conversation flow.
- Switching mode is instant and remembered.
- Accepting proposals actually grows a clean, queryable graph with correct relations and provenance.
- The web interface is good enough that you prefer it for this kind of work over pure CLI.
- The whole path uses the existing orchestrator, routing, tools and knowledge packages — no second system.

## Explicit non-goals for this design

- Automatic generation of complete first-principles analyses as the primary mode
- Special node types that make the graph FP-only
- Auto-accept under any confidence threshold
- Treating the UI as an afterthought or “minimum viable shell”
