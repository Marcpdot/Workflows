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
| **Evidence** | Canonical identity ↔ source with qualified stance (`supports`, `contradicts`, `test_evidence`) |
| **Observation** | Encounter or derivation involving an identity and event/source (`mentions`, `observes`, `independently_formulated`, `references`, `derived_from`) |
| **Project / artifact** | Optional anchors for work product |

Lifecycle status on claims/nodes is `proposed | accepted | disputed | rejected`.
Epistemic status is independent: `observed | supported | inferred |
hypothesized | assumed | established | unknown`.

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

**Status:** superseded by Knowledge Infrastructure v2 (2026-08)
**Evidence:** confirmed  
**Source:** M11 AGENTS + delivery  

SQLite tables alongside existing DBs. No new infrastructure required for M11–M18 shells.

**Reason:** Zero ops tax for a personal machine; schema can migrate later. Graph *objects* matter more than graph *engine* early.

**Rejected:** Neo4j/Graphiti as hard dependency for M11; one DB file per project as default (see M13 decision on workspaceId filters).

## Knowledge Infrastructure v2 storage boundaries

**Status:** active
**Evidence:** confirmed
**Source:** PR #32 implementation specification; foundational contracts and migration `0001_canonical_postgis.sql`
**Revisit when:** canonical PostgreSQL parity testing invalidates a domain mapping, or an auxiliary backend cannot be rebuilt from canonical state

**Decision:** `@workflows/knowledge` exposes storage-independent canonical,
graph, vector, and spatial repository contracts. PostgreSQL/PostGIS is the
authoritative structured/spatial store. Graph topology and pgvector similarity
are derived, reconstructable projections keyed by the same canonical UUIDs.
`KnowledgeStore` remains the storage-independent domain/service contract, while
`createKnowledgeStore()` now selects PostgreSQL as the sole canonical runtime.

Canonical writes retain the existing proposal/approval, provenance, workspace,
identity/alias/merge, contradiction, and supersession semantics. PostgreSQL
schema changes are ordered SQL migrations with checksums, an advisory lock, and
per-migration transactions. A canonical outbox records graph/vector projection
work so auxiliary failure cannot invalidate a successful truth-store write.
Normalized labels are indexed lookup signals rather than database identities.
Self-relations are permitted unless a specific relation's domain invariant
rejects them. The local PostgreSQL runtime loads PostGIS and pgvector together
and defaults to conflict-safe host port `55432`.

The PostgreSQL canonical adapter implements the existing storage-independent
domain contract rather than exposing SQL to orchestrator callers. Proposal
materialization and merge operations are transactional, and accepted writes
append retryable projection-outbox work without coupling canonical success to a
graph/vector backend. There is no SQLite canonical adapter/import/cutover path;
knowledge moves forward from PostgreSQL canonical truth.

The semantic projection uses pgvector `vector(1536)` with HNSW cosine indexing.
Each row retains a stable projection ID, canonical target UUID, optional
canonical source/chunk UUIDs, embedding model/version/dimension, filter metadata
and timestamps. It does not copy canonical text. Accepted nodes of any present
or future type are embeddable from type + label + optional description when an
explicit embedding provider is configured. Rebuild traverses the complete
accepted state through a keyset-paginated repeatable-read snapshot, generates
all embeddings, then atomically replaces only that model/version projection;
coexisting embedding spaces are preserved. Vector outbox failures remain
retryable and cannot invalidate canonical commits. Search is executed in
PostgreSQL, requires a matching model/version and returns candidates rather than
making identity decisions.

**HNSW rationale:** it supports incrementally updated projections without a
training phase and gives strong query-time recall/latency for the local semantic
index. Fixed dimension keeps the ANN operator class indexable and makes model
incompatibility fail explicitly; dimension changes use forward migrations.

The dedicated topology projection uses Neo4j 5 Community behind the
storage-independent `GraphRepository`. Neo4j is appropriate because
variable-depth expansion and directed shortest paths execute natively in
Cypher; PostgreSQL remains authoritative and no graph transaction participates
in a canonical commit. Graph nodes and relationships retain canonical node and
edge UUIDs. A stable `CanonicalNode` / `CANONICAL_RELATION` shape stores exact
canonical type/relation values as properties, so future vocabulary and
self-relations require no second ontology or graph-schema redesign.

Full reconciliation reads all accepted nodes and edges from one keyset-
paginated repeatable-read PostgreSQL snapshot and replaces Neo4j topology in one
Neo4j transaction. Pending/rejected records and edges with non-accepted
endpoints are excluded. Incremental outbox jobs support node/edge upsert, delete
and rebuild; merge uses rebuild when local rewiring is unsafe. Failures remain
retryable and never invalidate canonical PostgreSQL writes.

Canonical accepted-to-non-accepted transitions are projection invalidations,
not ordinary metadata updates. Supersession atomically records its edge and
disputed status while enqueueing graph reconciliation and vector deletion.
Merge similarly rebuilds graph topology and deletes the retired vector identity;
direct canonical edge deletion enqueues graph deletion. These outbox writes are
part of the canonical PostgreSQL transaction, while execution remains decoupled.

Hybrid retrieval is a storage-independent domain service over these layers, not
an agent planner. It composes only the strategies requested: exact canonical
resolution, Neo4j expansion, pgvector similarity and optional spatial candidate
narrowing. Graph/project/explicit candidate sets can constrain semantic search;
semantic discovery can request bounded graph enrichment. All candidates are
rehydrated and status-checked in PostgreSQL before return.

Fusion is deterministic and inspectable: exact/project identity, explicit
candidate membership and graph/spatial membership are structural signals, while
cosine similarity is an additive ranking signal and never an identity decision.
Results retain discovery origins, canonical edges, evidence, observations,
source nodes and source events within hard per-layer and context-unit budgets.
Strategy metadata reports ran/skipped/unavailable/degraded. Missing projections
degrade independently, but failure of a requested narrowing scope never widens
semantic retrieval silently. The retrieval service itself contains no LLM
planning or autonomous strategy selection.

The explicit Knowledge Agent now consumes that deterministic substrate through
controlled domain tools. Its Navigator capability resolves, retrieves,
traverses and inspects provenance without mutation. Its Curator capability
inspects duplicate/conflict/structure candidates and creates pending proposals;
it has no accept tool and cannot directly merge, supersede, or arbitrate truth.
Merge and supersession are durable proposal kinds whose execution occurs only
through the separate canonical approval boundary.

Model reasoning is behind a vendor-independent adapter and receives bounded,
structured tool results rather than repositories or raw SQL/Cypher. Hard run
limits cover tool calls, context characters, graph hops, result count and
proposal count. Privacy-preserving audit events retain run/mode, tool names,
canonical IDs, strategy degradation, proposal IDs, counts and outcome without
logging full prompt/content by default. Navigator and Curator share an initial
runtime but keep separate policy and tool allowlists so they may split later.

**Reason:** The shell proved the domain, but SQLite tables and application-side
indexes do not provide the integrity, spatial capability, traversal ceiling, or
indexed semantic retrieval required for a knowledge system expected to outgrow
direct inspection. Separating contracts from adapters prevents database vendors
from redefining the ontology and permits incremental, reversible cutover.

**Rejected alternatives:** destructive big-bang replacement; PostgreSQL/graph
types leaking into orchestrator callers; graph or vector stores as competing
truth; fragile cross-database pseudo-transactions; retaining startup schema
strings as the long-term migration mechanism; preserving obsolete SQLite
knowledge data at the cost of a permanent dual-backend surface.

### Universal canonical identity

**Decision:** Every independently referable thing may have one stable canonical
UUID, regardless of whether today's ontology calls it a concept, claim, source,
project, physical component, CAD version, test, idea or observation. PostgreSQL,
PostGIS, future graph/vector projections, source references, agents and tools use
that same ID. The current node vocabulary is an initial ontology, not a closed
identity universe.

Identity means sameness of referent. Labels, workspace, provenance, repeated
observation and semantic similarity are evidence for resolution, not identity
keys. The same referent observed in another source normally keeps its canonical
ID while adding evidence/provenance/state/relationships. Two different motors
may share `Motor`; two claims may share wording while differing in assumptions,
conditions or temporal validity. One identity can participate in multiple
project/workspace contexts without being duplicated solely for context.

Explicit canonical IDs and aliases provide confident reuse. Label discovery may
offer candidates, but ambiguous candidates remain separate/reviewable. Explicit
merge transactionally consolidates IDs only after sameness is established,
retains the retired record/history, rewires its references and cleans only
conflicts created by that merge.

**Reason:** Treating identity as label dedupe collapses distinct referents and
confuses observations/context with things. Treating every mention as new identity
fragments provenance and makes cross-store references unstable. A universal ID
with conservative domain resolution supports both precision and later Curator
assistance without SQL uniqueness guessing ontology.

### Identity, provenance and context

**Decision:** Identity records what the referent is. Provenance records how,
where and when that same referent was encountered or learned. Context records
how it participates in projects, relationships, time and space. These concerns
do not manufacture identities for one another.

`knowledge_observations` binds a canonical target to an extraction event and
optional source identity with occurrence kind, timestamp and metadata. Accepting
a meaningful node proposal records an observation, including explicit
`canonicalId` or alias reuse; reads and lookups do not. `mentions` is an
occurrence. Qualified `supports`, `contradicts` and `test_evidence` remain in
`knowledge_evidence`, whose generic target can be an idea, claim, artifact or
future canonical type. Claim-labelled extraction is a validated convenience,
not a restriction on generic evidence.

**Reason:** Encounters must remain distinguishable by event, source and time
without duplicating their referent or treating every mention as support. Merge
retargets evidence and observation history to the surviving canonical UUID.

### Contextual representation gaps

**Status:** active
**Evidence:** confirmed
**Source:** Continuous Cognition WP5 implementation contract; migration `0011_representation_gaps.sql`
**Revisit when:** contextual resolution must survive conflicting defaults across callers that cannot provide a stable source/context key

**Decision:** Material identity/referent ambiguity is retained as a narrow
`representation_gap` proposal under an ordinary knowledge event. The proposal
UUID is the stable gap identity; pending/accepted/rejected maps to unresolved,
resolved, or obsolete. Its event points to the exact input/tool/clarification
experiences, while the payload retains the unresolved term, bounded canonical
candidates, ambiguity and eventual contextual resolution. No parallel gap
table, identity store, or manager is introduced.

Resolution uses strong source metadata and canonical IDs/aliases first, then
accepted world-model relations, one explicitly bounded inspection tool,
constrained inference, and finally one discriminating human question. A human
answer is a new durable experience and event. Resolving the gap records a direct
`references` observation on the chosen existing canonical identity; it does not
merge nodes, create a global alias from an ambiguous label, or upgrade an
interpretation into established truth. Later reuse requires the same exact
normalized referent and contextual key, and only proceeds when prior resolved
gaps agree on one canonical target. Conflicting learned resolutions restore
ambiguity rather than selecting the newest or most similar candidate.

**Reason:** Gaps need persistence and provenance so a clarification improves
later cognition, but they are operation/context knowledge—not a second ontology.
Reusing the proposal/event lifecycle preserves history and keeps PostgreSQL
canonical. Contextual bindings avoid turning one clarification into an unsafe
global alias, while exact agreement makes repeated questions unnecessary.

**Rejected alternatives:** a representation/gap manager or new database;
embedding similarity as an identity key; global alias creation from an
ambiguous human phrase; ephemeral clarification state in model/session context;
automatic merge or canonical truth promotion during acquisition.

### Epistemic status and transformation lineage

**Status:** active
**Evidence:** confirmed
**Source:** Continuous Cognition WP2 implementation contract; migration `0009_epistemic_lineage.sql`
**Revisit when:** lineage must represent transformations whose inputs are not canonical nodes/events, or automated belief revision is deliberately introduced

**Decision:** Proposal acceptance and epistemic certainty are orthogonal.
Accepting a machine-derived claim makes it part of canonical state but does not
promote it from `hypothesized`, `assumed`, or `inferred` to `established`.
Canonical nodes expose the existing confidence and temporal-validity fields
alongside an explicit epistemic status.

Transformation lineage reuses `knowledge_observations`: `derived_from` connects
a derived canonical target to its source event and, when relevant, canonical
source claims/assumptions. Its metadata records method/model, assumptions,
uncertainty, representation scope, confidence/validity, and explicit
information loss. For experienced input, `knowledge_events` retain stable
experience UUIDs, source references, and event-level transformation metadata;
the durable experience records remain the authoritative raw source. Event
`source_content` is only a subordinate fallback snapshot when no durable
experience backing exists, such as direct/legacy file or manual ingestion. The
repository and database reject simultaneous fallback content and non-empty
experience IDs, preventing normally written events from diverging. Events may
be explicitly invalidated without deleting their history. Bounded domain read
helpers traverse lineage in both directions so a claim can explain its origin
and a disputed/superseded assumption or invalidated event can expose dependent
claims for reconsideration.

**Reason:** Lifecycle approval answers whether a representation may enter the
canonical model; it does not prove the represented proposition. Reusing generic
provenance preserves one canonical truth model, lets merge/supersession retain
history, and keeps every derived claim traceable to durable experiences even
after repeated summarization. Storing representation scope and information loss
makes lossy transformations explicit instead of letting shorter restatements
silently acquire stronger meaning.

**Rejected alternatives:** equating `accepted` with confirmed truth; encoding
assumptions in description strings; a parallel lineage/representation database;
using vector similarity or graph proximity as epistemic evidence; automatic
truth arbitration or cascading mutation when a source becomes disputed;
copying durable experience payloads into knowledge events for convenience; or
forcing unrelated file/manual ingestion through memory solely to remove the
fallback column.

Explicit natural-language corrections may extract a `supersedes` proposal that
refers to the old and revised claim labels. It remains pending until the normal
approval boundary accepts the revised claim and supersession. Acceptance keeps
the old claim as disputed history, records the supersession edge against the
correction event, and lets accepted-only retrieval prefer the revision. The
exact extraction-model output is itself a durable experience and joins the
knowledge event's source experience IDs before proposals are created.

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

> Superseded 2026-08 by **Knowledge Infrastructure v2 storage boundaries** above. The workspace-filtering rationale remains active; the single SQLite file does not.

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

**Decision:** `npm run ui` explicitly mounts the existing M17 read catalog on its own origin and presents accepted nodes, stable DTO details, and 1–2-hop neighborhoods in the main web shell. The ordinary integration server keeps the existing `KNOWLEDGE_HTTP_READ` gate; UI startup opts in through a server option. Reads continue through `createKnowledgeReader` and the canonical PostgreSQL repository.

Network clients use the stable `getSubgraph` / `GET /v1/knowledge/subgraph` envelope rather than stitching many neighborhood calls together. It supports a root with 1–2 hops, an explicit node-ID set, or a capped accepted-node window; returned edges are induced by the returned nodes. The default cap is 250 nodes (hard maximum 1000), and truncation is explicit.

**Reason:** Accepted knowledge must be visible where capture decisions are made, and the one-process UI should work without a second env switch. An explicit server option preserves the integration server's prior opt-in boundary while avoiding duplicate routes or query logic.

**Rejected alternatives:** require UI users to remember `KNOWLEDGE_HTTP_READ=true`; query storage directly from UI-specific code; create a second knowledge HTTP service; make the network issue one request per node; return dangling edges whose endpoints are outside the node envelope; merge pending and accepted data into one truth view.

## First-principles root question (kept)

> How can continuous conversations, analyses, and projects be transformed
> into a durable, reliable model that both I and AI can understand, navigate,
> and extend — without the structure collapsing under duplicates, ambiguity,
> and error?

Branches: Information → Representation → Transformation → Use.
