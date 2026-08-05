/**
 * Conversation-optimised extract for continuous capture.
 * Prefers structural claims/relations over bag-of-words noise.
 * Limit kinds are properties, not new node types.
 */

import type { ExtractionResult } from "./types.js";

export type LimitKind =
  | "fundamental"
  | "technological"
  | "industrial"
  | "economic"
  | "regulatory";

const CAUSAL_PATTERNS: Array<{
  re: RegExp;
  relation: string;
}> = [
  {
    re: /(.+?)\s+(?:produce[sd]?|generat(?:e|es|ed)|creat(?:e|es|ed))\s+(.+)/i,
    relation: "causes",
  },
  {
    re: /(.+?)\s+(?:limit[sd]?|constrain[sd]?|bound[sd]?|cap(?:s|ped)?)\s+(.+)/i,
    relation: "limits",
  },
  {
    re: /(.+?)\s+(?:requir(?:e|es|ed)|need[sd]?|depend(?:s|ed)? on)\s+(.+)/i,
    relation: "requires",
  },
  {
    re: /(.+?)\s+(?:increas(?:e|es|ed)|rais(?:e|es|ed)|amplif(?:y|ies))\s+(.+)/i,
    relation: "increases",
  },
  {
    re: /(.+?)\s+(?:reduc(?:e|es|ed)|decreas(?:e|es|ed)|lower[sd]?)\s+(.+)/i,
    relation: "reduces",
  },
  {
    re: /(.+?)\s+(?:caus(?:e|es|ed)|lead[sd]? to|result[sd]? in)\s+(.+)/i,
    relation: "causes",
  },
];

const LIMIT_KIND_HINTS: Array<{ re: RegExp; kind: LimitKind }> = [
  {
    re: /\b(absolute|fundamental|physics|physical|cannot be violated|axiom)\b/i,
    kind: "fundamental",
  },
  {
    re: /\b(material|insulation|technology|design choice|contingent|engineering)\b/i,
    kind: "technological",
  },
  {
    re: /\b(factory|manufactur|production|industrial|scale-?up)\b/i,
    kind: "industrial",
  },
  {
    re: /\b(cost|price|budget|economic|margin)\b/i,
    kind: "economic",
  },
  {
    re: /\b(regulat|legal|standard|compliance|code)\b/i,
    kind: "regulatory",
  },
];

const PROCESS_NOISE =
  /^(ok|okay|thanks|thank you|yes|no|sure|hi|hello|hei|ja|nei|hmm|right|got it)\.?$/i;

/** True if the user turn is too thin / pure process talk for auto-extract. */
export function isLowSubstanceUserMessage(text: string, minLen = 40): boolean {
  const t = text.trim();
  if (t.length < minLen) return true;
  if (PROCESS_NOISE.test(t)) return true;
  // Pure slash / meta commands
  if (/^\/\w+/.test(t) && t.length < 80) return true;
  // Very few content words
  const words = t.split(/\s+/).filter((w) => w.length > 2);
  if (words.length < 5 && t.length < minLen + 20) return true;
  return false;
}

function cleanEndpoint(s: string): string {
  return s
    .replace(/^(user|assistant):\s*/i, "")
    .replace(/["""']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function detectLimitKind(text: string): LimitKind | undefined {
  for (const h of LIMIT_KIND_HINTS) {
    if (h.re.test(text)) return h.kind;
  }
  if (/\blimit\b/i.test(text)) return "technological";
  return undefined;
}

/**
 * Offline conversation extract: structure-first, not word-bag.
 */
export function conversationHeuristicExtract(
  segment: string
): ExtractionResult {
  const lines = segment
    .split(/\n+/)
    .map((l) => l.replace(/^(user|assistant):\s*/i, "").trim())
    .filter((l) => l.length > 8);

  const body = lines.join(" ");
  const sentences = body
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);

  const concepts: ExtractionResult["concepts"] = [];
  const claims: ExtractionResult["claims"] = [];
  const relations: ExtractionResult["relations"] = [];
  const seenLabels = new Set<string>();

  const addConcept = (label: string, description?: string) => {
    const key = label.toLowerCase();
    if (!label || seenLabels.has(key)) return;
    seenLabels.add(key);
    concepts.push({ label, description });
  };

  for (const sent of sentences) {
    const limitKind = detectLimitKind(sent);
    let matched = false;
    for (const { re, relation } of CAUSAL_PATTERNS) {
      const m = sent.match(re);
      if (!m) continue;
      const from = cleanEndpoint(m[1]!);
      const to = cleanEndpoint(m[2]!);
      if (from.length < 2 || to.length < 2) continue;
      if (from.split(" ").length > 12 || to.split(" ").length > 12) continue;
      addConcept(from);
      addConcept(to);
      relations.push({ from, relation, to, confidence: 0.7 });
      const claimLabel = `${from} ${relation} ${to}`;
      claims.push({
        label: claimLabel,
        description: limitKind
          ? `limitKind=${limitKind}; ${sent.slice(0, 160)}`
          : sent.slice(0, 160),
        confidence: 0.7,
      });
      // Attach limitKind as description meta on limit nodes
      if (relation === "limits" && limitKind) {
        addConcept(from, `limitKind=${limitKind}`);
        addConcept(to);
      }
      matched = true;
      break;
    }

    // Next-bottleneck: "if X is solved → Y"
    const nb = sent.match(
      /if\s+(.+?)\s+(?:is\s+)?(?:solved|fixed|resolved|removed)[,:]?\s*(?:then\s+)?(.+?)(?:\s+becomes|\s+is\s+the|\s+limits)/i
    );
    if (nb) {
      const x = cleanEndpoint(nb[1]!);
      const y = cleanEndpoint(nb[2]!);
      addConcept(x, "current bottleneck candidate");
      addConcept(y, "next bottleneck if prior is solved");
      relations.push({ from: x, relation: "limits", to: y, confidence: 0.65 });
      claims.push({
        label: `if ${x} solved then ${y} constrains`,
        description: sent.slice(0, 160),
        confidence: 0.65,
      });
      matched = true;
    }

    // Open questions / assumptions
    if (
      !matched &&
      (/\?$/.test(sent) ||
        /\b(assum(?:e|es|ing|ption)|open question|unclear|unknown)\b/i.test(
          sent
        ))
    ) {
      claims.push({
        label: sent.slice(0, 100),
        description: /\?$/.test(sent)
          ? "open question"
          : "assumption or uncertainty",
        confidence: 0.5,
      });
    }
  }

  // Prefer structural: drop lone concepts if we have relations/claims
  if (relations.length === 0 && claims.length === 0) {
    // Fallback thin: 1–2 long noun phrases as claims only
    for (const sent of sentences.slice(0, 3)) {
      if (sent.split(" ").length >= 5) {
        claims.push({ label: sent.slice(0, 100), confidence: 0.4 });
      }
    }
  }

  return {
    concepts: concepts.slice(0, 10),
    claims: claims.slice(0, 10),
    relations: relations.slice(0, 10),
  };
}

/** Score for ranking: edges/structural claims first. */
export function scoreProposalItem(item: {
  kind: string;
  payload: Record<string, unknown>;
}): number {
  if (item.kind === "edge") {
    const rel = String(item.payload.relation ?? "about");
    const structural = [
      "requires",
      "limits",
      "causes",
      "increases",
      "reduces",
      "supports",
      "contradicts",
      "part_of",
    ];
    return structural.includes(rel) ? 100 : 40;
  }
  if (item.kind === "claim") {
    const desc = String(item.payload.description ?? "");
    if (/limitKind=/.test(desc)) return 90;
    if (/open question|assumption/i.test(desc)) return 70;
    return 50;
  }
  if (item.kind === "node") {
    const desc = String(item.payload.description ?? "");
    if (item.payload.type === "claim") {
      if (/limitKind=/.test(desc)) return 90;
      if (/assumption=true/i.test(desc)) return 70;
      return 50;
    }
    if (/limitKind=|bottleneck/i.test(desc)) return 60;
    return 20;
  }
  return 10;
}

export function rankAndCapItems<
  T extends { kind: string; payload: Record<string, unknown> },
>(items: T[], max: number): T[] {
  return [...items]
    .sort((a, b) => scoreProposalItem(b) - scoreProposalItem(a))
    .slice(0, max);
}
