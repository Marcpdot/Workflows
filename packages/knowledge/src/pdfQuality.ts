/** Heuristic: extracted PDF text is unusable as language. */

export function looksGarbled(text: string): boolean {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length < 40) return true;

  const words = cleaned.match(/\p{L}+/gu) ?? [];
  if (words.length < 8) return true;

  const short = words.filter((word) => word.length <= 2).length / words.length;
  const noVowel = words.filter(
    (word) => word.length >= 5 && !/[aeiouyæøå]/i.test(word)
  ).length / words.length;
  const noise =
    (cleaned.match(/[^ \p{L}\p{N}.,;:!?()\[\]\/%+=\-\n]/gu)?.length ?? 0) /
    cleaned.length;

  return short > 0.42 || noVowel > 0.18 || noise > 0.08;
}
