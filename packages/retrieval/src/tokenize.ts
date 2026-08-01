/**
 * Deterministic keyword tokenization + scoring (no embeddings).
 */

/** Small NO/EN stopword list — drop noise tokens from queries. */
const STOPWORDS = new Set([
  // English
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "but",
  "with",
  "as",
  "by",
  "at",
  "from",
  "it",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "my",
  "your",
  "our",
  "their",
  "what",
  "why",
  "how",
  "when",
  "where",
  "which",
  "who",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "would",
  "will",
  "just",
  "about",
  "into",
  "not",
  "no",
  "yes",
  // Norwegian
  "og",
  "i",
  "på",
  "for",
  "til",
  "av",
  "en",
  "et",
  "ei",
  "den",
  "det",
  "de",
  "som",
  "er",
  "var",
  "med",
  "om",
  "jeg",
  "du",
  "vi",
  "dere",
  "han",
  "hun",
  "meg",
  "deg",
  "min",
  "din",
  "vår",
  "hva",
  "hvorfor",
  "hvordan",
  "når",
  "hvor",
  "hvilken",
  "hvilke",
  "ikke",
  "ja",
  "nei",
  "skal",
  "kan",
  "vil",
  "må",
  "har",
  "hadde",
  "blir",
  "ble",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9æøåäöü]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export function uniqueTokens(text: string): string[] {
  return [...new Set(tokenize(text))];
}

/**
 * score = unique query tokens found in candidate text
 * + bonus (tokenCount) if every query token matches
 */
export function scoreText(queryTokens: string[], candidateText: string): number {
  if (queryTokens.length === 0) return 0;
  const hay = candidateText.toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) hits += 1;
  }
  if (hits === 0) return 0;
  let score = hits;
  if (hits === queryTokens.length) {
    score += queryTokens.length; // full-match bonus
  }
  return score;
}

export function truncateSnippet(text: string, maxChars: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}
