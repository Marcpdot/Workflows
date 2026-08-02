/**
 * Compact text formatting for knowledge subgraphs (prompts + tool output).
 */

import type { KnowledgeEdge, KnowledgeNode } from "./types.js";

/**
 * Stable, boring format for model context and tool `output`.
 * Hard-caps by maxChars (default 2000).
 */
export function formatNeighborhood(input: {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  maxChars?: number;
  title?: string;
}): string {
  const maxChars =
    input.maxChars && input.maxChars > 0 ? Math.floor(input.maxChars) : 2000;
  const lines: string[] = [];
  if (input.title) {
    lines.push(input.title);
  } else {
    lines.push("Knowledge neighborhood:");
  }

  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  for (const n of input.nodes) {
    lines.push(
      `- [${n.type}] ${n.label} (id=${n.id.slice(0, 8)}… status=${n.status})`
    );
  }
  if (input.edges.length > 0) {
    lines.push("Edges:");
    for (const e of input.edges) {
      const from = byId.get(e.fromNodeId)?.label ?? e.fromNodeId.slice(0, 8);
      const to = byId.get(e.toNodeId)?.label ?? e.toNodeId.slice(0, 8);
      lines.push(`  ${from} -[${e.relation}]-> ${to}`);
    }
  }

  let text = lines.join("\n");
  if (text.length > maxChars) {
    text =
      text.slice(0, Math.max(0, maxChars - 20)) +
      `\n…[truncated ${text.length} chars]`;
  }
  return text;
}

/** Tokenize a user prompt for simple inject matching (no NLP). */
export function simpleQueryTokens(text: string, max = 8): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9æøåäöü_./:-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
