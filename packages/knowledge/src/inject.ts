/**
 * Optional knowledge neighborhood inject into model context (M12).
 * M13: prefer project status when prompt matches a project label.
 * Default off — orchestrator only calls when KNOWLEDGE_INJECT_ENABLED.
 */

import { formatNeighborhood, simpleQueryTokens } from "./formatNeighborhood.js";
import type { KnowledgeStore } from "./types.js";

/**
 * Exact-ish project label match: whole label as substring with non-alnum
 * boundaries, or single-token equality against query tokens.
 */
function promptMatchesProjectLabel(
  promptLower: string,
  tokens: string[],
  label: string
): boolean {
  const lab = label.trim().toLowerCase();
  if (!lab) return false;
  if (tokens.includes(lab)) return true;
  // Multi-word / hyphenated labels: bounded substring match
  const escaped = lab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9æøå])${escaped}([^a-z0-9æøå]|$)`, "i");
  return re.test(promptLower);
}

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
  const promptLower = userPrompt.toLowerCase();

  // M13: project-status first when a project label is mentioned
  try {
    const projects = await store.findNodes({
      type: "project",
      status: "accepted",
      limit: 40,
    });
    for (const p of projects) {
      if (!promptMatchesProjectLabel(promptLower, tokens, p.label)) continue;
      const status = await store.getProjectStatus({
        projectId: p.id,
        hops: hops as 1 | 2,
      });
      let text = [
        "Project status (accepted graph only):",
        ...status.summaryLines,
      ].join("\n");
      if (text.length > maxChars) {
        text =
          text.slice(0, Math.max(0, maxChars - 20)) +
          `\n…[truncated ${text.length} chars]`;
      }
      return text;
    }
  } catch {
    // fall through to neighborhood inject
  }

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
