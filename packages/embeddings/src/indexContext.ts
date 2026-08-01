/**
 * Index Keep the Why context/*.md into the vector store (source=context).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Embedder, VectorStore } from "./types.js";

export async function indexProjectContext(options: {
  contextDir: string;
  embedder: Embedder;
  store: VectorStore;
  /** Skip re-index if store already has context rows. Default true */
  skipIfNonEmpty?: boolean;
}): Promise<number> {
  const dir = options.contextDir;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return 0;
  }

  if (options.skipIfNonEmpty !== false && options.store.count("context") > 0) {
    return 0;
  }

  const files = readdirSync(dir)
    .filter((n) => n.endsWith(".md") && n.toLowerCase() !== "readme.md")
    .map((n) => join(dir, n))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });

  let n = 0;
  for (const filePath of files) {
    let text: string;
    try {
      text = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (!text.trim()) continue;

    const rel = relative(dir, filePath).replace(/\\/g, "/");
    // Cap very large files for embedding
    const snippet =
      text.length > 6000 ? text.slice(0, 6000) + "…" : text;

    const [vector] = await options.embedder.embed([snippet]);
    if (!vector?.length) continue;

    await options.store.upsert({
      id: `context:${rel}`,
      source: "context",
      refId: rel,
      text: snippet,
      vector,
    });
    n++;
  }
  return n;
}
