/**
 * Milestone 12 — knowledge tools for the shared Tool registry.
 * Closures capture KnowledgeStore; permanent writes only via accept.
 */

import type { Tool, ToolResult } from "@workflows/tools";
import { applyExtractionResult } from "./extract.js";
import { formatNeighborhood } from "./formatNeighborhood.js";
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
    ],
    async execute(args): Promise<ToolResult> {
      try {
        const nodes = await store.findNodes({
          label: str(args.label),
          type: str(args.type) as KnowledgeNodeType | undefined,
          status: (str(args.status) as KnowledgeStatus | undefined) ?? "accepted",
          limit: num(args.limit) ?? 20,
        });
        if (nodes.length === 0) {
          return fail("knowledge_find: no matching nodes", "No nodes found.");
        }
        const lines = nodes.map(
          (n) => `${n.id}  ${n.type}  ${n.label}  (${n.status})`
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

  return [
    knowledge_find,
    knowledge_get,
    knowledge_neighborhood,
    knowledge_list_proposals,
    knowledge_propose,
    knowledge_accept,
    knowledge_reject,
  ];
}
