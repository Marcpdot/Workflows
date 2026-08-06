# Knowledge (semantic world model)

## Vision: first-principles world model over plain facts

**Status:** active (direction)  
**Evidence:** confirmed  
**Source:** design conversation 2026-08-02 (first-principles graphs + voice use); M11–M18 shells delivered through `6f11d1f`  
**Revisit when:** daily use shows representation or approval-loop gaps

Workflows already has short-term session memory and long-term `MemoryFact`
(content + tags + optional key). That is necessary but not sufficient for
the intended Jarvis-like use: continuous first-principles analysis, project
state queries, and voice-driven reasoning over *understanding*, not only
retrieved text.

The next layer is a **semantic knowledge model**:

- Explicit **concepts** (what exists)
- Explicit **claims** (what is asserted, with status and confidence)
- Explicit **relations** (how they connect: requires, limits, causes, increases, …)
- **Events** (learning/analysis moments that produced claims)
- **Sources / provenance** (conversation span, file, experiment)
- **Projects / artifacts** (what the claim affects)

Goal in one sentence:

> Continuously transform conversations, analyses, and project activity into
> a reliable, machine-readable model of what is known, believed, and being
> built — so both human and models can navigate and extend it (including via voice).

**Reason:** Text memory can recall a sentence. It cannot represent
`strøm → øker → kobbertap → produserer → varme → begrenser → kontinuerlig moment`
with provenance, hypothesis status, and project linkage. First-principles
work and “what is the status of actuator-v2?” need that structure. Those are
**usage patterns**, not a limit on the model’s domain.

**Rejected alternatives:**

- **Only richer MemoryFact text** — still no explicit graph or claim identity.
- **Jump straight to Neo4j / Graphiti as core** — define *our* objects and
  approval loop first; storage can change later.
- **Auto-write every chat turn into the permanent graph** — pollutes the
  model; proposals + human (or strict) approval are required early.
- **Separate “JARVIS knowledge” repo** — Workflows already owns memory,
  structured output, tools, workspaces, observability; extend here.

## Core objects (M11 minimum)

**Status:** active  
**Evidence:** confirmed (implemented shell in `packages/knowledge`)  

| Object | Role |
|--------|------|
| **Concept** | Named entity/topic (motor, heat, workspace, …) |
| **Claim** | Subject–relation–object style assertion, or labelled statement |
| **Relation / edge** | Typed link between nodes (`requires`, `limits`, `causes`, `increases`, `reduces`, `measures`, `controls`, `supports`, `contradicts`, `used_in`, …) |
| **Event** | Extraction or analysis event (source type + ref) |
| **Source** | Conversation id + excerpt, file path, measurement |
| **Evidence** | Claim ↔ source with stance (supports / contradicts / mentions) |
| **Project / artifact** | Optional anchors for work product |

Status on claims/nodes: `proposed | accepted | disputed | rejected`.

Invariants that must survive any implementation:

1. **Provenance** — machine-created claims trace to origin.
2. **Identity** — same concept should not explode into near-duplicates.
3. **Context + time** — claims can be hypothesis, formerly true, or scoped.
4. **Uncertainty** — confidence / status explicit.
5. **Reversibility** — proposals and commits can be undone without graph rot.

## Extraction loop (not direct write)

**Status:** active  
**Evidence:** confirmed (design constraint)

```
Raw activity (chat / markdown / project)
  → ExtractionEvent (structured output)
  → Proposals (concepts, claims, edges)
  → Identity / duplicate check
  → Human (or policy) approve / edit / reject
  → Commit to knowledge store
  → Retrieval / neighborhood for next turn
```

AI **proposes**; it does not silently own the permanent model. M10 structured
output is the right engine for the extraction step.

## Relation to existing memory

**Status:** active  
**Evidence:** confirmed

| Layer | Responsibility |
|-------|----------------|
| `packages/memory` short-term | Session turns, continuity across model switch |
| `packages/memory` long-term | Simple durable facts, preferences, keywords + optional vectors |
| **knowledge (new)** | Explicit concepts, claims, relations, events, provenance |

Not everything said in chat belongs in the world model. LTM remains useful
for “user prefers X”. Knowledge is for *structure of understanding*.

## Implementation specs (per milestone)

| # | Spec |
|---|------|
| M11 | [`AGENTS.md`](../packages/knowledge/src/AGENTS.md) |
| M12 | [`AGENTS-M12.md`](../packages/knowledge/src/AGENTS-M12.md) |
| M13 | [`AGENTS-M13.md`](../packages/knowledge/src/AGENTS-M13.md) |
| M14 | [`AGENTS-M14.md`](../packages/knowledge/src/AGENTS-M14.md) |
| M15 | [`AGENTS-M15.md`](../packages/knowledge/src/AGENTS-M15.md) |
| M16 | [`AGENTS-M16.md`](../packages/knowledge/src/AGENTS-M16.md) |
| M17 | [`AGENTS-M17.md`](../packages/knowledge/src/AGENTS-M17.md) |
| M18 | [`AGENTS-M18.md`](../packages/knowledge/src/AGENTS-M18.md) |

## Voice / natural-language use (intent)

**Status:** active (product intent; M18 shell delivered optional)  
**Evidence:** confirmed  
**Source:** M18 `@workflows/voice`  

Speech I/O was deferred until the graph and tools existed (M11–M17). M18 is
**interface only**: STT → same `handle()` / knowledge tools → optional TTS.
See decision log below and [interface.md](interface.md).

## Storage choice for first shell

**Status:** active  
**Evidence:** confirmed  
**Source:** M11 AGENTS + delivery  

SQLite tables alongside existing DBs. No new infrastructure required for M11–M18 shells.

**Reason:** Zero ops tax for a personal machine; schema can migrate later. Graph *objects* matter more than graph *engine* early.

**Rejected:** Neo4j/Graphiti as hard dependency for M11; one DB file per project as default (see M13 decision on workspaceId filters).

## Knowledge milestone roadmap (M11–M18)

**Status:** active (shell track complete; deepen with use)  
**Evidence:** confirmed  
**Source:** design conversation 2026-08-02; delivery commits through M18 `6f11d1f`  
**Revisit when:** daily use shows a shell is too thin, or a band needs hardening before the next

| # | Focus | Delivers | Status |
|---|--------|----------|--------|
| **M11** | Semantic knowledge shell | Store, proposals, neighborhood | **shell delivered** |
| **M12** | Knowledge tools + wire | Models use graph via tools | **shell delivered** |
| **M13** | Project & workspace binding | Project nodes, links, `getProjectStatus`, workspaceId defaults | **shell delivered** |
| **M14** | Continuous / batch ingest | `ingestText`/`ingestFile`, light dedupe, tool+CLI, auto-chat opt-in (proposals only) | **shell delivered** |
| **M15** | Identity, merge & contradiction | Aliases, merge rewire, contradicts list, supersede (no silent delete) | **shell delivered** |
| **M16** | First-principles workflow | Template analysis → structured proposals (not sole purpose of knowledge) | **shell delivered** |
| **M17** | Read surface | Reader helpers, renderers, CLI `--json`, optional HTTP + minimal HTML | **shell delivered** |
| **M18** | Voice / multimodal I/O (optional) | STT/TTS adapters → same `handle()` / tools; default off | **shell delivered (optional)** |

**Capability bands**

- **M11–M13** — make structured use *possible*
- **M14–M16** — make growth and analysis *robust*
- **M17–M18** — improve *interface*

**Explicitly out of early roadmap (still rejected):** Neo4j-as-required, fully autonomous permanent writes, 3D UI, complete self-model of Workflows on day one.

## Interaction mode + continuous knowledge capture (post-M18)

**Status:** active  
**Evidence:** confirmed  
**Source:** design [`docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md`](../docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md); structured capture [`docs/STRUCTURED_CAPTURE_AND_NETWORK_VIZ.md`](../docs/STRUCTURED_CAPTURE_AND_NETWORK_VIZ.md); foundation `04415a5`; iteration `7d474bb`  
**Revisit when:** daily multi-hour sessions show extract quality, queue noise, or sparring tone still wrong

### Product decision

**Decision:** Free-form reasoning sessions use a first-class session **`interactionMode`** (`active` | `neutral`, default **active**). In active mode the system continuously extracts **pending** knowledge proposals from the conversation; the human accepts/rejects. Explicit `/capture` works in any mode. Web UI is a working surface (mode + proposals queue), not a bare chat shell. Same orchestrator/knowledge brain — no parallel system.

**Reason:** Capture friction must be near-zero or the graph stays empty; mode must be remembered so deep sessions feel natural; FP and other analysis remain usage patterns on the general graph.

**Rejected:** Auto-accept; FP-only core node types; treating UI as afterthought; a second capture brain; every-turn extract without caps/mode.

### Delivery (what is live)

| Layer | Commit | Notes |
|-------|--------|--------|
| Foundation | `04415a5` | `session_state` in memory; slash `/mode` `/proposals` `/capture` `/accept` `/reject`; continuous capture→pending; extended chat response; basic panel |
| Iteration | `7d474bb` | Conversation-optimised extract; pending+accepted dedupe + ranking; `limitKind` as property (not new types); full session queue API/UI; active vs neutral sparring prompts; rate-limit; capture failures never break reply |
| Structured quality | 2026-08-05 implementation | Strict schema model extract; normalise/filter; resolvable typed edges; accepted+pending identity; heuristic fallback |

### Iteration decisions (why of `7d474bb`)

**Conversation extract over bag-of-words**  
Generic word-bag ingest produced noise unsuitable for deep reasoning. The primary path is now a separate schema-constrained completion that returns clean concepts, declarative claims, assumptions, and canonical typed edges. Questions are omitted from default proposals. The earlier conversation heuristic remains the offline/degraded fallback and passes through the same quality boundary.

The extraction model is separately configurable with `KNOWLEDGE_CAPTURE_TIER` and `KNOWLEDGE_CAPTURE_MODEL`, but capture is deliberately **local-only**: it uses the configured Ollama client/model and never calls frontier or mid APIs. `heuristic` remains an explicit degraded/offline option. Chat reply routing remains independent.

**Rejected:** Frontier/mid extraction, because capture must work without remote API access and must not send captured conversation segments remotely; heuristic regex as the primary quality path; silently use a weak model as if output quality were equivalent; couple extraction model choice to the chat reply; invent FP-only graph types for limits.

**Quality before proposals**  
Normalisation collapses whitespace and canonicalises relation aliases. The filter removes pure questions, process chatter, repeated-token stutter, pseudo-edge syntax, invalid relations, and edges whose endpoints cannot resolve to this extract or the accepted graph. `limitKind` is retained only when the extract explicitly supplies it. Model/schema failure is visible in the capture reason and falls back without breaking the reply.

**Rejected:** Store first and clean later; accept unresolved edge endpoints; turn open questions into permanent-looking claims by default; fail the main conversation when extraction is unavailable.

**`limitKind` as property, not node type**  
Classification `fundamental | technological | industrial | economic | regulatory` is stored on claim/concept description (e.g. `limitKind=technological`), keeping the graph general.

**Rejected:** Separate node types per limit class (would specialise the core model toward FP).

**Dedupe against accepted *and* pending**  
Continuous capture re-sees the same claims across turns. Skipping only accepted nodes still floods the queue with near-duplicates already pending.

**Rejected:** Accept-only identity (M14 light dedupe alone).

**Session queue, not last-turn list**  
The proposals panel (and `pendingProposalCount`) are scoped by `sourceRef` prefix `conversation:<sessionId>` via `listPendingForSession` / `GET /v1/knowledge/proposals?sessionId=`.

**Rejected:** Drive the panel only from the last chat response payload.

**Active changes reply style, not only capture**  
Active = sparring system prompt (challenge assumptions, classify limits, next bottleneck). Neutral = brief, non-coaching; capture only on explicit `/capture`.

**Rejected:** Mode as a pure capture gate with identical model tone.

**Rate-limit auto-extract**  
Default min interval between auto captures (`KNOWLEDGE_CAPTURE_MIN_INTERVAL_MS`, 8s); `/capture` bypasses. Substance heuristic still skips short/process talk.

**Rejected:** Extract on every turn regardless of length or recency.

**See also:** [interface.md](interface.md); [memory.md](memory.md) (session_state); design + iteration docs under `docs/`.

## Decisions delivered with M11–M18 shells

**Status:** active  
**Evidence:** confirmed  
**Source:** milestone AGENTS specs + implementation sessions 2026-08-02–03; commits `430ce65`…`6f11d1f` (knowledge track)  
**Revisit when:** a shell is replaced by a hardened path or an invariant is deliberately broken

Cross-cutting choices that apply across the whole track:

### Propose → accept is the only permanent write path

**Decision:** Extraction, tools, ingest, FP workflow, and chat auto-ingest create **pending proposals** only. Permanent graph nodes/edges require explicit `accept` (CLI/tool). Rejected alternatives stay out of the accepted graph.

**Reason:** Weak local models and noisy chat would rot a permanent world model if every turn wrote facts. Approval is the reliability gate.

**Rejected:** Auto-accept on high confidence; silent permanent write from chat; separate “shadow graph” without a human path.

### Shell-first verticals, not production-hardening per row

**Decision:** Each M11–M18 row is a stoppable vertical (types + API + wire + smoke + env gates). Deep calibration (entity resolution NLP, full cloud STT SDK, rich SPA) is deferred.

**Reason:** Same as overall milestones policy — complete surface compounds better than polishing one layer without use.

**Rejected:** Production-harden M11 before M12; skip rows that need a strong model.

### Defaults-off for costly / side-effecting knowledge paths

**Decision:** Tools, inject, auto-chat-ingest, knowledge HTTP read, and voice are **off** until env flags are set. Chat + routing remain usable without them.

**Reason:** Personal stack must not burn tokens, open a mic, or inject graph noise by surprise.

**Rejected:** Knowledge tools always registered; inject always on; ambient voice always listening.

### One knowledge.db + metadata filters (not multi-DB per project)

**Decision:** Single SQLite knowledge DB; isolation via `workspaceId` on nodes and project edges — same *idea* as M9 session namespace in one memory.db.

**Reason:** Cheap filter, one backup story, no circular “which DB?” for early shells.

**Rejected:** One SQLite file per project/workspace as the default; Neo4j as hard dependency for M11.

### Knowledge is a package; orchestrator only wires

**Decision:** `@workflows/knowledge` owns store, extract, tools, ingest, identity, FP, read. Orchestrator registers tools, CLI, optional HTTP, inject. Voice is a **separate** `@workflows/voice` package (I/O only).

**Reason:** Same packaging rule as other layers; voice is interface, not graph truth — keep it out of knowledge’s domain model.

**Rejected:** All knowledge code inside orchestrator; voice package owning propose/accept; second HTTP “knowledge brain”.

### Tools over bespoke handle branches

**Decision:** Models and future UIs use the shared tool registry (`knowledge_*`). Handle gains optional inject and optional auto-ingest hooks, not a parallel knowledge API for the model.

**Reason:** One extension mechanism; CLI, tool loop, HTTP, and voice all converge on the same store + tools.

**Rejected:** Model-only hidden knowledge path; separate REST write API for agents.

---

### M11 — representation + approval loop first

**Decision:** Ship concepts/claims/edges/events/proposals/neighborhood in SQLite with fixture/heuristic extract before rich model extraction.

**Reason:** Proves the objects and the propose→accept loop exist offline; live extract can improve without redoing storage.

**Rejected:** Wait for perfect extraction quality; start with only embeddings over free text.

### M12 — tools + optional inject, not auto-brain

**Decision:** Register `knowledge_*` when `KNOWLEDGE_TOOLS_ENABLED`; optional neighborhood inject when `KNOWLEDGE_INJECT_ENABLED`. Propose never accepts.

**Reason:** Models should *use* the graph when tools are on; inject is a separate, cheaper, noisier path and stays gated.

**Rejected:** Always inject full graph; force tools on by default.

### M13 — project is a node; status is a query

**Decision:** `type: "project"` node + binding edges (`used_in` | `about` | `part_of`); `getProjectStatus` summarizes linked accepted subgraph. `defaultWorkspaceId` stamps accept materialize when payload omits workspace. Inject prefers project-status when the prompt matches a project label.

**Reason:** Project-state questions (“status on aktuator-v2?”) need a stable anchor without a second membership system. Edges reuse neighborhood machinery.

**Rejected:** Separate project membership table; multi-DB per project; auto-bind every node in a workspace to a git repo project without an explicit project node.

### M14 — grow the graph from work without silent commit

**Decision:** `ingestText` / `ingestFile` / `knowledge_ingest` → proposals; light dedupe skips node proposals that already exist accepted (type+label / resolve). Auto chat segment only if `KNOWLEDGE_INGEST_AUTO_ON_CHAT` (still proposals only).

**Reason:** Daily markdown/chat should feed the model, but permanent pollution stays blocked. Dedupe at propose time reduces M15 work load.

**Rejected:** Continuous every-turn silent extract as default; auto-accept after ingest.

### M15 — identity and contradiction as explicit maintenance

**Decision:** Alias table + `normalizeLabel` (trim/case/diacritics); `mergeNodes` rewires edges/evidence, aliases from-label, marks from **rejected** (no hard delete); `contradicts` and `supersedes` are explicit flags — no auto truth arbitration.

**Reason:** Volume without identity explodes labels; merge must keep provenance. Systems flag conflicts; humans/policy resolve.

**Rejected:** Embedding-only identity as sole engine; silent delete on merge; auto-pick winning claim on contradiction.

### M16 — first-principles is a workflow, not the whole layer

**Decision:** Fixed template (goal, laws, absolute/contingent limits, bottlenecks, scaling, next action) → structured `FirstPrinciplesResult` → same proposal machinery. Optional `projectLabel` ensures project + `used_in` proposals. Offline heuristic + fixture for smoke; live `complete` optional.

**Reason:** FP analysis is a primary *usage pattern* for this personal stack, but the graph must stay domain-general. Encoding FP only as free text loses typed limits/relations.

**Rejected:** Restrict knowledge package to FP-only types; require live frontier model for the shell.

### M17 — read without a second frontend product

**Decision:** `createKnowledgeReader` stable JSON envelopes + text/table/markdown renderers; CLI `--json` / `--table`; optional `KNOWLEDGE_HTTP_READ` on **existing** integration server (`GET /v1/knowledge/*`, minimal `/knowledge` HTML). No write UI.

**Reason:** Navigability for CLI, agents, and a thin browser — without React graph editors or 3D. Same token gate as M5 HTTP.

**Rejected:** Full SPA graph editor; 3D “Stark” viz as M17; separate knowledge HTTP service.

### M18 — voice is I/O only, default off

**Decision:** `@workflows/voice` STT/TTS adapters → string → existing `handle()` / tools. Mock path for offline smoke; local command templates for real Whisper-class CLI; cloud stubs refuse unless `VOICE_ALLOW_REMOTE_AUDIO`. TTS default **off**. CLI `--voice-once --transcript`; REPL `/voice`.

**Reason:** Speech must not fork a second brain or surprise the mic. Prefer local STT for privacy; document when audio leaves the machine.

**Rejected:** Always-on ambient agent without wake policy; voice-owned knowledge store; cloud STT default; bundling heavy cloud SDKs in the shell.

## Implementation notes (shell how, not why)

Compact pointers to what exists in code (detail lives in AGENTS-M* specs):

| Milestone | Code anchors |
|-----------|----------------|
| **M11** | `packages/knowledge` store + extract + CLI smoke |
| **M12** | `createKnowledgeTools`, inject, `KNOWLEDGE_*` flags |
| **M13** | `ensureProject` / `linkToProject` / `getProjectStatus`, workspace defaults |
| **M14** | `ingest.ts`, auto-chat opt-in |
| **M15** | `identity.ts`, aliases, merge, contradictions, supersede |
| **M16** | `firstPrinciples.ts`, `knowledge_first_principles`, `--knowledge fp` |
| **M17** | `read.ts`, `render.ts`, `/v1/knowledge/*` |
| **M18** | `packages/voice`, `--voice-once`, `smoke-voice` |

## Accepted graph explore after M17

**Status:** active
**Evidence:** confirmed
**Source:** [`docs/KNOWLEDGE_EXPLORE_UI.md`](../docs/KNOWLEDGE_EXPLORE_UI.md); [`docs/STRUCTURED_CAPTURE_AND_NETWORK_VIZ.md`](../docs/STRUCTURED_CAPTURE_AND_NETWORK_VIZ.md); `packages/orchestrator/src/ui/web/`
**Revisit when:** more than 50 matching nodes is a normal browse case, or graph edits beyond proposal accept/reject are required

**Decision:** `npm run ui` explicitly mounts the existing M17 read catalog on its own origin and presents accepted nodes, stable DTO details, and 1–2-hop neighborhoods in the main web shell. The ordinary integration server keeps the existing `KNOWLEDGE_HTTP_READ` gate; UI startup opts in through a server option. Reads continue through `createKnowledgeReader` and the same SQLite store.

Network clients use the stable `getSubgraph` / `GET /v1/knowledge/subgraph` envelope rather than stitching many neighborhood calls together. It supports a root with 1–2 hops, an explicit node-ID set, or a capped accepted-node window; returned edges are induced by the returned nodes. The default cap is 250 nodes (hard maximum 1000), and truncation is explicit.

**Reason:** Accepted knowledge must be visible where capture decisions are made, and the one-process UI should work without a second env switch. An explicit server option preserves the integration server's prior opt-in boundary while avoiding duplicate routes or query logic.

**Rejected alternatives:** require UI users to remember `KNOWLEDGE_HTTP_READ=true`; query SQLite directly from UI-specific code; create a second knowledge HTTP service; make the network issue one request per node; return dangling edges whose endpoints are outside the node envelope; merge pending and accepted data into one truth view.

## First-principles root question (kept)

> How can continuous conversations, analyses, and projects be transformed
> into a durable, reliable model that both I and AI can understand, navigate,
> and extend — without the structure collapsing under duplicates, ambiguity,
> and error?

Branches: Information → Representation → Transformation → Use.
