/**
 * Milestone 12 — knowledge tools for the shared Tool registry.
 * Closures capture KnowledgeStore; permanent writes only via accept.
 */

import type { Tool, ToolContext, ToolResult } from "@workflows/tools";
import { applyExtractionResult } from "./extract.js";
import { runFirstPrinciplesAnalysis } from "./firstPrinciples.js";
import { formatNeighborhood } from "./formatNeighborhood.js";
import { ingestFile, ingestText } from "./ingest.js";
import type {
  ExtractionResult,
  KnowledgeNodeType,
  KnowledgeStatus,
  KnowledgeStore,
} from "./types.js";

const OUTPUT_CAP = 12_000;

function cap(s: string, max = OUTPUT_CAP): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 20) + "\n…[truncated]";
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function ok(output: string, data?: unknown): ToolResult {
  return { ok: true, output: cap(output), data };
}

function fail(error: string, output = ""): ToolResult {
  return { ok: false, output: cap(output), error };
}

function parseJsonArray(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? p : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Create knowledge tools bound to a store.
 * Propose never auto-accepts.
 */
export function createKnowledgeTools(store: KnowledgeStore): Tool[] {
  const knowledge_find: Tool = {
    name: "knowledge_find",
    description:
      "Find accepted (or filtered) knowledge nodes by label/type/status.",
    parameters: [
      {
        name: "label",
        type: "string",
        description: "Label substring (case-insensitive)",
      },
      {
        name: "type",
        type: "string",
        description: "concept|claim|event|source|project|artifact",
      },
      {
        name: "status",
        type: "string",
        description: "proposed|accepted|disputed|rejected (default accepted)",
      },
      {
        name: "limit",
        type: "number",
        description: "Max results (default 20)",
      },
      {
        name: "workspaceId",
        type: "string",
        description: "Optional workspace filter (M13)",
      },
    ],
    async execute(args): Promise<ToolResult> {
      try {
        const nodes = await store.findNodes({
          label: str(args.label),
          type: str(args.type) as KnowledgeNodeType | undefined,
          status: (str(args.status) as KnowledgeStatus | undefined) ?? "accepted",
          limit: num(args.limit) ?? 20,
          workspaceId: str(args.workspaceId),
        });
        if (nodes.length === 0) {
          return fail("knowledge_find: no matching nodes", "No nodes found.");
        }
        const lines = nodes.map(
          (n) =>
            `${n.id}  ${n.type}  ${n.label}  (${n.status})${
              n.workspaceId ? ` ws=${n.workspaceId}` : ""
            }`
        );
        return ok(`Found ${nodes.length} node(s):\n${lines.join("\n")}`, {
          nodes,
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_get: Tool = {
    name: "knowledge_get",
    description: "Get a single knowledge node by id.",
    parameters: [
      {
        name: "nodeId",
        type: "string",
        description: "Node UUID",
        required: true,
      },
    ],
    async execute(args): Promise<ToolResult> {
      const nodeId = str(args.nodeId);
      if (!nodeId) return fail("knowledge_get: nodeId is required");
      try {
        const node = await store.getNode(nodeId);
        if (!node) return fail(`knowledge_get: unknown node ${nodeId}`);
        return ok(
          `${node.type} ${node.label} (${node.status})\n${node.description ?? ""}`.trim(),
          { node }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_neighborhood: Tool = {
    name: "knowledge_neighborhood",
    description:
      "Fetch 1–2 hop accepted subgraph around a node id (labels + edges).",
    parameters: [
      {
        name: "nodeId",
        type: "string",
        description: "Root node UUID",
        required: true,
      },
      {
        name: "hops",
        type: "number",
        description: "1 or 2 (default 1)",
      },
    ],
    async execute(args): Promise<ToolResult> {
      const nodeId = str(args.nodeId);
      if (!nodeId) return fail("knowledge_neighborhood: nodeId is required");
      const hopsRaw = num(args.hops) ?? 1;
      const hops = hopsRaw >= 2 ? 2 : 1;
      try {
        const neigh = await store.getNeighborhood(nodeId, {
          hops: hops as 1 | 2,
          status: "accepted",
        });
        if (neigh.nodes.length === 0) {
          return fail(
            `knowledge_neighborhood: no graph at ${nodeId}`,
            "Empty neighborhood."
          );
        }
        const text = formatNeighborhood({
          ...neigh,
          maxChars: OUTPUT_CAP,
          title: `Neighborhood root=${nodeId.slice(0, 8)}… hops=${hops}`,
        });
        return ok(text, neigh);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_list_proposals: Tool = {
    name: "knowledge_list_proposals",
    description: "List knowledge proposals (default status=pending).",
    parameters: [
      {
        name: "status",
        type: "string",
        description: "pending|accepted|rejected",
      },
    ],
    async execute(args): Promise<ToolResult> {
      const status = (str(args.status) as
        | "pending"
        | "accepted"
        | "rejected"
        | undefined) ?? "pending";
      try {
        const list = await store.listProposals({ status });
        if (list.length === 0) {
          return ok(`No proposals with status=${status}`, { proposals: [] });
        }
        const lines = list.map(
          (p) =>
            `${p.id}  ${p.kind}  ${JSON.stringify(p.payload).slice(0, 100)}`
        );
        return ok(
          `${list.length} proposal(s) status=${status}:\n${lines.join("\n")}`,
          { proposals: list }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_propose: Tool = {
    name: "knowledge_propose",
    description:
      "Create pending knowledge proposals only (event + proposals). Does NOT accept/commit. Call knowledge_accept to commit.",
    parameters: [
      {
        name: "text",
        type: "string",
        description: "Optional free text → heuristic extract when structured fields empty",
      },
      {
        name: "concepts",
        type: "string",
        description: 'JSON array of {label, description?} or leave empty',
      },
      {
        name: "claims",
        type: "string",
        description: "JSON array of {label, description?, confidence?}",
      },
      {
        name: "relations",
        type: "string",
        description: "JSON array of {from, relation, to, confidence?}",
      },
      {
        name: "sourceRef",
        type: "string",
        description: 'Source ref for the event (default "tool-propose")',
      },
    ],
    async execute(args): Promise<ToolResult> {
      try {
        let concepts =
          (parseJsonArray(args.concepts) as ExtractionResult["concepts"]) ??
          [];
        let claims =
          (parseJsonArray(args.claims) as ExtractionResult["claims"]) ?? [];
        let relations =
          (parseJsonArray(args.relations) as ExtractionResult["relations"]) ??
          [];

        // Also accept raw arrays if model passes objects (some loops)
        if (!concepts.length && Array.isArray(args.concepts)) {
          concepts = args.concepts as ExtractionResult["concepts"];
        }
        if (!claims.length && Array.isArray(args.claims)) {
          claims = args.claims as ExtractionResult["claims"];
        }
        if (!relations.length && Array.isArray(args.relations)) {
          relations = args.relations as ExtractionResult["relations"];
        }

        const text = str(args.text);
        if (
          concepts.length === 0 &&
          claims.length === 0 &&
          relations.length === 0
        ) {
          if (!text) {
            return fail(
              "knowledge_propose: provide concepts/claims/relations and/or text"
            );
          }
          // Heuristic shell (same idea as M11 CLI extract)
          const words = text
            .split(/[^a-zA-ZæøåÆØÅ0-9-]+/)
            .map((w) => w.trim())
            .filter((w) => w.length > 3);
          const unique = [
            ...new Set(words.map((w) => w.toLowerCase())),
          ].slice(0, 8);
          concepts = unique.map((label) => ({ label }));
          const sentences = text
            .split(/[.!?\n]+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 3);
          claims = sentences.slice(0, 5).map((label) => ({ label }));
          if (unique.length >= 2) {
            relations = [
              {
                from: unique[0]!,
                relation: "about",
                to: unique[1]!,
              },
            ];
          }
        }

        const extraction: ExtractionResult = {
          concepts,
          claims,
          relations,
        };
        const { eventId, proposals } = await applyExtractionResult(
          store,
          extraction,
          {
            sourceType: "manual",
            sourceRef: str(args.sourceRef) ?? "tool-propose",
            model: "tool",
            rawText: text,
          }
        );
        const ids = proposals.map((p) => p.id);
        return ok(
          `Created event ${eventId} with ${proposals.length} pending proposal(s). Call knowledge_accept to commit. ids: ${ids.join(", ")}`,
          { eventId, proposals, proposalIds: ids }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_accept: Tool = {
    name: "knowledge_accept",
    description:
      "Accept a pending proposal into the permanent knowledge graph (explicit commit).",
    parameters: [
      {
        name: "proposalId",
        type: "string",
        description: "Proposal UUID",
        required: true,
      },
      {
        name: "label",
        type: "string",
        description: "Optional label edit on accept",
      },
      {
        name: "description",
        type: "string",
        description: "Optional description edit",
      },
    ],
    async execute(args): Promise<ToolResult> {
      const proposalId = str(args.proposalId);
      if (!proposalId) {
        return fail("knowledge_accept: proposalId is required");
      }
      try {
        const edits: Record<string, unknown> = {};
        if (str(args.label)) edits.label = str(args.label);
        if (str(args.description)) edits.description = str(args.description);
        await store.acceptProposal(
          proposalId,
          Object.keys(edits).length ? edits : undefined
        );
        return ok(`Accepted proposal ${proposalId}`, { proposalId });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_reject: Tool = {
    name: "knowledge_reject",
    description: "Reject a pending knowledge proposal (does not add graph nodes).",
    parameters: [
      {
        name: "proposalId",
        type: "string",
        description: "Proposal UUID",
        required: true,
      },
    ],
    async execute(args): Promise<ToolResult> {
      const proposalId = str(args.proposalId);
      if (!proposalId) {
        return fail("knowledge_reject: proposalId is required");
      }
      try {
        await store.rejectProposal(proposalId);
        return ok(`Rejected proposal ${proposalId}`, { proposalId });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_ensure_project: Tool = {
    name: "knowledge_ensure_project",
    description:
      "Find or create an accepted project node by label. Use ensure_project then link_project after accepting relevant claims; use project_status for status questions.",
    parameters: [
      {
        name: "label",
        type: "string",
        description: "Project label (e.g. aktuator-v2)",
        required: true,
      },
      {
        name: "description",
        type: "string",
        description: "Optional project description",
      },
      {
        name: "workspaceId",
        type: "string",
        description: "Optional workspace id; else store default",
      },
    ],
    async execute(args): Promise<ToolResult> {
      const label = str(args.label);
      if (!label) return fail("knowledge_ensure_project: label is required");
      try {
        const project = await store.ensureProject({
          label,
          description: str(args.description),
          workspaceId: str(args.workspaceId),
          createAccepted: true,
        });
        return ok(
          `project ${project.label} id=${project.id} status=${project.status} workspace=${project.workspaceId ?? "none"}`,
          { project }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_link_project: Tool = {
    name: "knowledge_link_project",
    description:
      "Link a claim/concept/artifact node to a project (relation used_in|about|part_of, default used_in).",
    parameters: [
      {
        name: "nodeId",
        type: "string",
        description: "Source node UUID",
        required: true,
      },
      {
        name: "projectId",
        type: "string",
        description: "Project node UUID",
        required: true,
      },
      {
        name: "relation",
        type: "string",
        description: "used_in | about | part_of (default used_in)",
      },
    ],
    async execute(args): Promise<ToolResult> {
      const nodeId = str(args.nodeId);
      const projectId = str(args.projectId);
      if (!nodeId || !projectId) {
        return fail("knowledge_link_project: nodeId and projectId are required");
      }
      const rel = str(args.relation);
      const relation =
        rel === "about" || rel === "part_of" || rel === "used_in"
          ? rel
          : "used_in";
      try {
        const edge = await store.linkToProject({
          nodeId,
          projectId,
          relation,
        });
        return ok(
          `linked ${nodeId.slice(0, 8)}… -[${edge.relation}]-> ${projectId.slice(0, 8)}…`,
          { edge }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_unlink_project: Tool = {
    name: "knowledge_unlink_project",
    description: "Remove project-binding edges (used_in|about|part_of) between node and project.",
    parameters: [
      {
        name: "nodeId",
        type: "string",
        description: "Source node UUID",
        required: true,
      },
      {
        name: "projectId",
        type: "string",
        description: "Project node UUID",
        required: true,
      },
    ],
    async execute(args): Promise<ToolResult> {
      const nodeId = str(args.nodeId);
      const projectId = str(args.projectId);
      if (!nodeId || !projectId) {
        return fail(
          "knowledge_unlink_project: nodeId and projectId are required"
        );
      }
      try {
        const removed = await store.unlinkFromProject({ nodeId, projectId });
        return ok(
          removed
            ? `unlinked ${nodeId.slice(0, 8)}… from project ${projectId.slice(0, 8)}…`
            : "no project-link edges found",
          { removed }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_project_status: Tool = {
    name: "knowledge_project_status",
    description:
      "Summarize a project: linked claims/concepts/artifacts and edges. Prefer this for “what is status on <project>?” questions.",
    parameters: [
      {
        name: "label",
        type: "string",
        description: "Project label (if projectId omitted)",
      },
      {
        name: "projectId",
        type: "string",
        description: "Project node UUID (if label omitted)",
      },
      {
        name: "hops",
        type: "number",
        description: "1 or 2 (default 1)",
      },
      {
        name: "workspaceId",
        type: "string",
        description: "Optional workspace check",
      },
    ],
    async execute(args): Promise<ToolResult> {
      const label = str(args.label);
      const projectId = str(args.projectId);
      if (!label && !projectId) {
        return fail(
          "knowledge_project_status: provide label or projectId"
        );
      }
      const hopsRaw = num(args.hops) ?? 1;
      const hops = hopsRaw >= 2 ? 2 : 1;
      try {
        const status = await store.getProjectStatus({
          label,
          projectId,
          hops: hops as 1 | 2,
          workspaceId: str(args.workspaceId),
        });
        return ok(status.summaryLines.join("\n"), { status });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_ingest: Tool = {
    name: "knowledge_ingest",
    description:
      "Batch-ingest text or a workspace file into **pending** knowledge proposals only (never auto-accept). Dedupes node labels already accepted. Call knowledge_accept to commit.",
    parameters: [
      {
        name: "text",
        type: "string",
        description: "Free text / markdown segment to ingest",
      },
      {
        name: "path",
        type: "string",
        description: "Relative path under workspace root (alt to text)",
      },
      {
        name: "sourceRef",
        type: "string",
        description: 'Event source ref (default "tool-ingest")',
      },
      {
        name: "projectLabel",
        type: "string",
        description: "Optional project hint encoded in sourceRef (no auto-link)",
      },
      {
        name: "workspaceId",
        type: "string",
        description: "Optional workspaceId stamped on proposed nodes",
      },
    ],
    async execute(args, ctx: ToolContext): Promise<ToolResult> {
      const text = str(args.text);
      const path = str(args.path);
      if (!text && !path) {
        return fail("knowledge_ingest: provide text and/or path");
      }
      try {
        const common = {
          sourceRef: str(args.sourceRef) ?? "tool-ingest",
          projectLabel: str(args.projectLabel),
          workspaceId: str(args.workspaceId),
        };
        const result = path
          ? await ingestFile(store, {
              ...common,
              path,
              workspaceRoot: ctx.workspaceRoot,
              sourceType: "file",
            })
          : await ingestText(store, {
              ...common,
              text: text!,
              sourceType: "manual",
            });

        if (result.mode === "skipped" && result.proposals.length === 0) {
          return fail(
            `knowledge_ingest: ${result.reason ?? "skipped"}`,
            result.reason ?? "skipped"
          );
        }
        const ids = result.proposals.map((p) => p.id);
        return ok(
          `Ingested (${result.mode}) event=${result.eventId || "none"} proposals=${result.proposals.length} skippedDuplicateNodes=${result.skippedDuplicateNodes}. Pending only — call knowledge_accept to commit.${ids.length ? ` ids: ${ids.join(", ")}` : ""}`,
          {
            eventId: result.eventId,
            proposalIds: ids,
            proposals: result.proposals,
            skippedDuplicateNodes: result.skippedDuplicateNodes,
            mode: result.mode,
            sourceRef: result.sourceRef,
          }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_add_alias: Tool = {
    name: "knowledge_add_alias",
    description:
      "Map an alternate label to an existing canonical node (identity). Does not delete history.",
    parameters: [
      {
        name: "aliasLabel",
        type: "string",
        description: "Alternate label (normalized on store)",
        required: true,
      },
      {
        name: "canonicalNodeId",
        type: "string",
        description: "Canonical node UUID",
        required: true,
      },
    ],
    async execute(args): Promise<ToolResult> {
      const aliasLabel = str(args.aliasLabel);
      const canonicalNodeId = str(args.canonicalNodeId);
      if (!aliasLabel || !canonicalNodeId) {
        return fail(
          "knowledge_add_alias: aliasLabel and canonicalNodeId are required"
        );
      }
      try {
        const alias = await store.addAlias({ aliasLabel, canonicalNodeId });
        return ok(
          `alias "${alias.aliasLabel}" → ${alias.canonicalNodeId}`,
          { alias }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_merge: Tool = {
    name: "knowledge_merge",
    description:
      "Merge fromId into intoId: rewire edges/evidence, alias from label, mark from rejected. History kept (no hard delete).",
    parameters: [
      {
        name: "fromId",
        type: "string",
        description: "Node to absorb (becomes rejected)",
        required: true,
      },
      {
        name: "intoId",
        type: "string",
        description: "Canonical survivor node",
        required: true,
      },
    ],
    async execute(args): Promise<ToolResult> {
      const fromId = str(args.fromId);
      const intoId = str(args.intoId);
      if (!fromId || !intoId) {
        return fail("knowledge_merge: fromId and intoId are required");
      }
      try {
        const result = await store.mergeNodes({ fromId, intoId });
        return ok(
          `merged ${result.from.label} → ${result.into.label}; edgesRewired=${result.edgesRewired} aliasCreated=${result.aliasCreated}`,
          { result }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_find_contradictions: Tool = {
    name: "knowledge_find_contradictions",
    description:
      "List accepted contradicts edges (optional filter by nodeId). Flags only — no auto truth arbitration.",
    parameters: [
      {
        name: "nodeId",
        type: "string",
        description: "Optional node involved in contradiction",
      },
      {
        name: "limit",
        type: "number",
        description: "Max pairs (default 50)",
      },
    ],
    async execute(args): Promise<ToolResult> {
      try {
        const pairs = await store.findContradictions({
          nodeId: str(args.nodeId),
          limit: num(args.limit) ?? 50,
        });
        if (pairs.length === 0) {
          return ok("No accepted contradictions found.", { pairs: [] });
        }
        const lines = pairs.map((p) => p.summary);
        return ok(
          `${pairs.length} contradiction(s):\n${lines.join("\n")}`,
          { pairs }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_mark_contradiction: Tool = {
    name: "knowledge_mark_contradiction",
    description:
      "Explicitly mark two nodes as contradicts (accepted edge). Does not auto-resolve truth.",
    parameters: [
      {
        name: "fromId",
        type: "string",
        description: "First node UUID",
        required: true,
      },
      {
        name: "toId",
        type: "string",
        description: "Second node UUID",
        required: true,
      },
    ],
    async execute(args): Promise<ToolResult> {
      const fromId = str(args.fromId);
      const toId = str(args.toId);
      if (!fromId || !toId) {
        return fail(
          "knowledge_mark_contradiction: fromId and toId are required"
        );
      }
      try {
        const edge = await store.markContradiction({ fromId, toId });
        return ok(
          `contradicts ${fromId.slice(0, 8)}… ↔ ${toId.slice(0, 8)}…`,
          { edge }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_supersede: Tool = {
    name: "knowledge_supersede",
    description:
      "Mark newClaim as superseding oldClaim (edge supersedes; old kept, default disputed). No delete.",
    parameters: [
      {
        name: "oldClaimId",
        type: "string",
        description: "Older claim UUID",
        required: true,
      },
      {
        name: "newClaimId",
        type: "string",
        description: "Newer claim UUID",
        required: true,
      },
    ],
    async execute(args): Promise<ToolResult> {
      const oldClaimId = str(args.oldClaimId);
      const newClaimId = str(args.newClaimId);
      if (!oldClaimId || !newClaimId) {
        return fail(
          "knowledge_supersede: oldClaimId and newClaimId are required"
        );
      }
      try {
        const edge = await store.supersedeClaim({ oldClaimId, newClaimId });
        return ok(
          `supersedes edge ${edge.fromNodeId.slice(0, 8)}… → ${edge.toNodeId.slice(0, 8)}…`,
          { edge }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  const knowledge_first_principles: Tool = {
    name: "knowledge_first_principles",
    description:
      "Run a first-principles analysis template on a topic → pending knowledge proposals only (goal, laws, limits, bottlenecks, relations, next actions). Does NOT accept. One workflow on the general knowledge layer, not the sole purpose of knowledge.",
    parameters: [
      {
        name: "topic",
        type: "string",
        description: "System or problem under study",
        required: true,
      },
      {
        name: "goal",
        type: "string",
        description: "Optional goal hint",
      },
      {
        name: "projectLabel",
        type: "string",
        description: "Optional M13 project to ensure + used_in edge proposals",
      },
    ],
    async execute(args): Promise<ToolResult> {
      const topic = str(args.topic);
      if (!topic) {
        return fail("knowledge_first_principles: topic is required");
      }
      try {
        // Tool path is offline/heuristic unless orchestrator injects complete later
        const out = await runFirstPrinciplesAnalysis({
          store,
          topic,
          goal: str(args.goal),
          projectLabel: str(args.projectLabel),
        });
        const ids = out.proposals.map((p) => p.id);
        const relTypes = [
          ...new Set(
            out.proposals
              .filter((p) => p.kind === "edge")
              .map((p) => String(p.payload.relation ?? ""))
          ),
        ].filter(Boolean);
        return ok(
          `FP analysis (${out.mode}) topic="${topic}" event=${out.eventId} proposals=${out.proposals.length} relations=${relTypes.join(",") || "none"}. Pending only — call knowledge_accept to commit.`,
          {
            eventId: out.eventId,
            proposalIds: ids,
            proposals: out.proposals,
            analysis: out.analysis,
            mode: out.mode,
            projectId: out.projectId,
            relationTypes: relTypes,
          }
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  };

  return [
    knowledge_find,
    knowledge_get,
    knowledge_neighborhood,
    knowledge_list_proposals,
    knowledge_propose,
    knowledge_accept,
    knowledge_reject,
    knowledge_ensure_project,
    knowledge_link_project,
    knowledge_unlink_project,
    knowledge_project_status,
    knowledge_ingest,
    knowledge_add_alias,
    knowledge_merge,
    knowledge_find_contradictions,
    knowledge_mark_contradiction,
    knowledge_supersede,
    knowledge_first_principles,
  ];
}
