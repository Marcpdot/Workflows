/**
 * Optional knowledge neighborhood inject into model context (M12).
 * Default off — orchestrator only calls when KNOWLEDGE_INJECT_ENABLED.
 */

import { formatNeighborhood, simpleQueryTokens } from "./formatNeighborhood.js";
import type { KnowledgeStore } from "./types.js";

/**
 * Build a compact context block from accepted graph hits for a user prompt.
 * Returns null when nothing useful is found.
 */
export async function buildKnowledgeInjectBlock(
  store: KnowledgeStore,
  userPrompt: string,
  options?: {
    maxChars?: number;
    hops?: 1 | 2;
    maxSeeds?: number;
  }
): Promise<string | null> {
  const maxChars = options?.maxChars ?? 2000;
  const hops = options?.hops === 2 ? 2 : 1;
  const maxSeeds = options?.maxSeeds ?? 3;
  const tokens = simpleQueryTokens(userPrompt, 10);
  if (tokens.length === 0) return null;

  const seedIds: string[] = [];
  for (const t of tokens) {
    if (seedIds.length >= maxSeeds) break;
    const hits = await store.findNodes({
      label: t,
      status: "accepted",
      limit: 2,
    });
    for (const h of hits) {
      if (!seedIds.includes(h.id)) seedIds.push(h.id);
      if (seedIds.length >= maxSeeds) break;
    }
  }
  if (seedIds.length === 0) return null;

  const nodeMap = new Map<
    string,
    Awaited<ReturnType<KnowledgeStore["getNode"]>>
  >();
  const edgeMap = new Map<
    string,
    Awaited<ReturnType<KnowledgeStore["getNeighborhood"]>>["edges"][0]
  >();

  for (const id of seedIds) {
    const neigh = await store.getNeighborhood(id, {
      hops: hops as 1 | 2,
      status: "accepted",
    });
    for (const n of neigh.nodes) nodeMap.set(n.id, n);
    for (const e of neigh.edges) edgeMap.set(e.id, e);
  }

  const nodes = [...nodeMap.values()].filter(
    (n): n is NonNullable<typeof n> => n != null
  );
  if (nodes.length === 0) return null;

  return formatNeighborhood({
    nodes,
    edges: [...edgeMap.values()],
    maxChars,
    title: "Retrieved knowledge (accepted claims/concepts only):",
  });
}
