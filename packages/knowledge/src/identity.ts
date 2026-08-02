/**
 * Milestone 15 — label normalization and identity helpers (no NLP).
 */

/** Lowercase, trim, collapse whitespace, strip simple combining diacritics. */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** True when two labels match under normalizeLabel. */
export function labelsMatch(a: string, b: string): boolean {
  return normalizeLabel(a) === normalizeLabel(b);
}
