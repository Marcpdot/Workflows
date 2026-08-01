/**
 * Deterministic next-step suggestions (Milestone 3B).
 * Heuristics only — no model calls unless PROACTIVE_USE_MODEL (stubbed off).
 */

import { randomUUID } from "node:crypto";
import type {
  SuggestInput,
  SuggestOptions,
  Suggestion,
  SuggestionKind,
} from "./types.js";

const BUG_RE =
  /\b(bug|error|feil|crash|exception|stack\s*trace|failing|broken|regresjon|regression|typeerror|ENOENT)\b/i;

const CODE_RE =
  /\b(code|kode|implement|function|typescript|refactor|api|test|smoke)\b/i;

const MEMORY_RE =
  /\b(husk|remember|preferanse|preference|navnet mitt|my name|long[- ]?term)\b/i;

const FILE_PATH_RE =
  /(?:[\w.-]+\/)+[\w.-]+\.\w{1,8}|(?:[\w.-]+\.)+(?:ts|tsx|js|json|md|py|rs)/g;

const ARCH_CONTEXT_RE =
  /\b(architecture|milestone|routing|context\/|keep the why|orchestrat)\b/i;

const SMALLTALK_RE =
  /^(hei|hello|hi|hallo|yo|sup|takk|thanks|ok|okay|ja|nei)[\s!.?]*$/i;

function detectLocale(
  text: string,
  forced?: "nb" | "en"
): "nb" | "en" {
  if (forced) return forced;
  if (
    /\b(hva|hvordan|hvorfor|feil|kjør|fil|oppdater|foreslå|neste)\b/i.test(text)
  ) {
    return "nb";
  }
  return "en";
}

function t(
  locale: "nb" | "en",
  nb: string,
  en: string
): string {
  return locale === "nb" ? nb : en;
}

function make(
  kind: SuggestionKind,
  text: string,
  confidence: number
): Suggestion {
  return {
    id: randomUUID().slice(0, 8),
    kind,
    text,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

function extractPaths(text: string): string[] {
  const matches = text.match(FILE_PATH_RE) ?? [];
  const unique = [...new Set(matches.map((m) => m.replace(/[.,;:)]+$/, "")))];
  return unique.slice(0, 3);
}

/**
 * Suggest 0–N next steps. Synchronous, deterministic heuristics.
 */
export function suggestNextSteps(
  input: SuggestInput,
  options?: SuggestOptions
): Suggestion[] {
  const max = options?.max ?? 3;
  const minConfidence = options?.minConfidence ?? 0.45;
  const locale = detectLocale(
    `${input.userPrompt}\n${input.assistantReply}`,
    options?.locale
  );

  const prompt = input.userPrompt.trim();
  const reply = input.assistantReply.trim();
  const combined = `${prompt}\n${reply}`;
  const ctx = input.retrievedContext ?? "";
  const ltm = input.longTermSnippets ?? [];

  if (!prompt && !reply) return [];

  // Smalltalk / empty substance → no spam
  if (SMALLTALK_RE.test(prompt) && reply.length < 80) {
    return [];
  }

  const candidates: Suggestion[] = [];

  // Bug / error → run smoke or inspect
  if (BUG_RE.test(combined)) {
    candidates.push(
      make(
        "tool",
        t(
          locale,
          "Kjør relevant smoke-test (f.eks. npm run typecheck eller scripts/smoke-*.ts).",
          "Run a relevant smoke test (e.g. npm run typecheck or scripts/smoke-*.ts)."
        ),
        0.85
      )
    );
    candidates.push(
      make(
        "followup",
        t(
          locale,
          "Del full feilmelding / stack trace hvis den ikke allerede er med.",
          "Share the full error message / stack trace if not already included."
        ),
        0.7
      )
    );
  }

  // Paths in reply or prompt → tool suggestions
  const paths = extractPaths(combined);
  for (const path of paths) {
    candidates.push(
      make(
        "tool",
        t(
          locale,
          `Les filen med tool: read_file path=${path}`,
          `Read the file with tool: read_file path=${path}`
        ),
        0.8
      )
    );
  }
  if (paths.length > 0) {
    candidates.push(
      make(
        "tool",
        t(
          locale,
          `Søk i repoet: search_files query=${paths[0]!.split("/").pop()}`,
          `Search the repo: search_files query=${paths[0]!.split("/").pop()}`
        ),
        0.55
      )
    );
  }

  // Project context about architecture / milestones
  if (ARCH_CONTEXT_RE.test(ctx) || ARCH_CONTEXT_RE.test(combined)) {
    candidates.push(
      make(
        "milestone",
        t(
          locale,
          "Oppdater context/ hvis denne samtalen endret en beslutning (Keep the Why).",
          "Update context/ if this conversation changed a decision (Keep the Why)."
        ),
        0.65
      )
    );
  }

  // Code-ish work without paths
  if (CODE_RE.test(prompt) && paths.length === 0 && !BUG_RE.test(combined)) {
    candidates.push(
      make(
        "followup",
        t(
          locale,
          "Vil du at jeg skal foreslå konkrete filendringer eller bare skisse?",
          "Want concrete file-level changes, or just a design sketch?"
        ),
        0.55
      )
    );
  }

  // Memory / remember intent
  if (MEMORY_RE.test(prompt) || (ltm.length > 0 && MEMORY_RE.test(combined))) {
    candidates.push(
      make(
        "memory",
        t(
          locale,
          "Lagre dette som LTM-fakta: --ltm remember key=... content=...",
          "Store this as an LTM fact: --ltm remember key=... content=..."
        ),
        0.75
      )
    );
  }

  // LTM snippets present → optional deepen
  if (ltm.length > 0 && candidates.length === 0) {
    candidates.push(
      make(
        "memory",
        t(
          locale,
          "Knytt svaret til lagrede fakta (LTM) eller oppdater dem hvis de er utdaterte.",
          "Tie the answer to stored LTM facts, or update them if stale."
        ),
        0.5
      )
    );
  }

  // Generic deeper dive only for substantial non-smalltalk Q&A with high signal
  if (
    candidates.length === 0 &&
    prompt.length > 40 &&
    reply.length > 120 &&
    !SMALLTALK_RE.test(prompt)
  ) {
    candidates.push(
      make(
        "followup",
        t(
          locale,
          "Vil du gå dypere på ett konkret punkt i svaret?",
          "Want to go deeper on one concrete point in the answer?"
        ),
        0.48
      )
    );
  }

  // Sort by confidence, dedupe similar text, apply min + max
  const seen = new Set<string>();
  const filtered = candidates
    .filter((s) => s.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .filter((s) => {
      const key = s.text.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(0, max));

  return filtered;
}
