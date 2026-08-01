/**
 * semanticSearch: embed query → vector store search.
 */

import type { SemanticSearchDeps, VectorHit, VectorSearchOptions } from "./types.js";

export async function semanticSearch(
  query: string,
  deps: SemanticSearchDeps,
  options?: VectorSearchOptions
): Promise<VectorHit[]> {
  if (!query?.trim()) return [];
  const [qv] = await deps.embedder.embed([query.trim()]);
  if (!qv?.length) return [];
  return deps.store.search(qv, options);
}
