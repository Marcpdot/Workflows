/**
 * JSON extract helpers for tool-call text parsing.
 * Same behavior as packages/structured extract (shared logic; structured still owns completeStructured).
 */

/** Collect candidate JSON strings from model output (best-effort). */
export function extractJsonCandidates(text: string): string[] {
  if (!text || !text.trim()) return [];
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (s: string) => {
    const t = s.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    candidates.push(t);
  };

  // Fenced ```json ... ```
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m[1]?.trim()) push(m[1]);
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    push(trimmed);
  }

  // Balanced objects / arrays from each { or [
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    const slice = balancedSlice(text, i);
    if (slice) push(slice);
  }

  return candidates;
}

function balancedSlice(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Light repairs for common LLM JSON mistakes (not a full fixer).
 */
export function lenientJsonRepair(text: string): string {
  let s = text.trim();
  s = s.replace(/,\s*([}\]])/g, "$1");
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  return s;
}
