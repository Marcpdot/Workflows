/**
 * Optional knowledge neighborhood inject into model context (M12).
 * M13: prefer project status when prompt matches a project label.
 * Default off — orchestrator only calls when KNOWLEDGE_INJECT_ENABLED.
 */

import { formatNeighborhood, simpleQueryTokens } from "./formatNeighborhood.js";
import type { KnowledgeStore } from "./types.js";

export interface KnowledgeContextSelection {
  text: string;
  canonicalIds: string[];
  claimIds: string[];
  contradictionIds: string[];
}

/** Optional attention hint; prompt-based selection still runs when omitted. */
export interface KnowledgeContextOptions {
  maxChars?: number;
  hops?: 1 | 2;
  maxSeeds?: number;
  seedNodeIds?: string[];
  projectId?: string;
  projectLabel?: string;
  labels?: string[];
}

export interface KnowledgeLineageContext {
  text: string | null;
  claimIds: string[];
  eventIds: string[];
  experienceIds: string[];
}

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

function formatProjectSelection(
  status: Awaited<ReturnType<KnowledgeStore["getProjectStatus"]>>,
  maxChars: number
): KnowledgeContextSelection {
  let text = [
    "Project status (accepted graph only):",
    ...status.summaryLines,
  ].join("\n");
  if (text.length > maxChars) {
    text =
      text.slice(0, Math.max(0, maxChars - 20)) +
      `\n…[truncated ${text.length} chars]`;
  }
  return {
    text,
    canonicalIds: [status.project.id, ...status.linkedNodes.map((node) => node.id)],
    claimIds: status.claims.map((claim) => claim.id),
    contradictionIds: status.edges
      .filter((edge) => edge.relation === "contradicts")
      .map((edge) => edge.id),
  };
}

/**
 * Build a compact context block from accepted graph hits for a user prompt.
 * Returns null when nothing useful is found.
 */
export async function selectKnowledgeContext(
  store: KnowledgeStore,
  userPrompt: string,
  options?: KnowledgeContextOptions
): Promise<KnowledgeContextSelection | null> {
  const maxChars = options?.maxChars ?? 2000;
  const hops = options?.hops === 2 ? 2 : 1;
  const maxSeeds = options?.maxSeeds ?? 3;
  const tokens = simpleQueryTokens(userPrompt, 10);
  const extraLabels = (options?.labels ?? [])
    .map((label) => label.trim())
    .filter(Boolean);
  const promptLower = userPrompt.toLowerCase();

  try {
    if (options?.projectId?.trim() || options?.projectLabel?.trim()) {
      const status = await store.getProjectStatus({
        projectId: options.projectId?.trim() || undefined,
        label: options.projectLabel?.trim() || undefined,
        hops: hops as 1 | 2,
      });
      return formatProjectSelection(status, maxChars);
    }
  } catch {
    // explicit focus miss falls through to neighborhood seeds
  }

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
      return formatProjectSelection(status, maxChars);
    }
  } catch {
    // fall through to neighborhood inject
  }

  const seedIds: string[] = [];
  const focusIds = (options?.seedNodeIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 8);
  for (const id of focusIds) {
    try {
      const node = await store.getNode(id);
      if (node && node.status === "accepted" && !seedIds.includes(node.id)) {
        seedIds.push(node.id);
      }
    } catch {
      /* ignore invalid focus ids */
    }
  }

  const searchLabels = [...extraLabels, ...tokens];
  for (const t of searchLabels) {
    if (seedIds.length >= Math.max(maxSeeds, focusIds.length)) break;
    const hits = await store.findNodes({
      label: t,
      status: "accepted",
      limit: 2,
    });
    for (const h of hits) {
      if (!seedIds.includes(h.id)) seedIds.push(h.id);
      if (seedIds.length >= Math.max(maxSeeds, focusIds.length)) break;
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

  const edges = [...edgeMap.values()];
  return {
    text: formatNeighborhood({
      nodes,
      edges,
      maxChars,
      title: "Retrieved knowledge (accepted claims/concepts only):",
    }),
    canonicalIds: nodes.map((node) => node.id),
    claimIds: nodes.filter((node) => node.type === "claim").map((node) => node.id),
    contradictionIds: edges
      .filter((edge) => edge.relation === "contradicts")
      .map((edge) => edge.id),
  };
}

/** Compatibility wrapper for callers that only need prompt text. */
export async function buildKnowledgeInjectBlock(
  store: KnowledgeStore,
  userPrompt: string,
  options?: KnowledgeContextOptions
): Promise<string | null> {
  const selected = await selectKnowledgeContext(store, userPrompt, options);
  return selected?.text ?? null;
}

/** Bounded, ID-oriented lineage context. It never copies durable experience payloads. */
export async function hydrateKnowledgeLineageContext(
  store: KnowledgeStore,
  claimIds: string[],
  maxChars = 2_000
): Promise<KnowledgeLineageContext> {
  const lineages = [];
  for (const claimId of [...new Set(claimIds)].slice(0, 3)) {
    lineages.push(await store.getClaimLineage(claimId, { maxDepth: 4 }));
  }
  if (lineages.length === 0) {
    return { text: null, claimIds: [], eventIds: [], experienceIds: [] };
  }

  const eventIds = [
    ...new Set(lineages.flatMap((lineage) => lineage.sourceEvents.map((event) => event.id))),
  ];
  const experienceIds = [
    ...new Set(
      lineages.flatMap((lineage) =>
        lineage.sourceEvents.flatMap((event) => event.sourceExperienceIds)
      )
    ),
  ];
  const lines = ["Knowledge provenance (canonical lineage; IDs are auditable):"];
  for (const lineage of lineages) {
    const methods = [
      ...new Set(lineage.derivations.map((derivation) => derivation.method)),
    ];
    const lineageEventIds = lineage.sourceEvents.map((event) => event.id);
    const lineageExperienceIds = lineage.sourceEvents.flatMap(
      (event) => event.sourceExperienceIds
    );
    lines.push(
      `- ${lineage.claim.label} (claim=${lineage.claim.id}, epistemic=${lineage.claim.epistemicStatus})`,
      `  events=${lineageEventIds.join(",") || "none"}; experiences=${lineageExperienceIds.join(",") || "none"}; methods=${methods.join(",") || "none"}`
    );
  }
  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = text.slice(0, Math.max(0, maxChars - 14)) + "\n…[truncated]";
  }
  return {
    text,
    claimIds: lineages.map((lineage) => lineage.claim.id),
    eventIds,
    experienceIds,
  };
}
