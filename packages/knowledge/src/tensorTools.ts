/** Tensor tools for the shared Tool registry. No Postgres. */

import { isAbsolute, resolve } from "node:path";
import type { Tool, ToolContext, ToolResult } from "@workflows/tools";
import { askStore, buildTensorFromDir } from "./tensorCorpus.js";

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function resolveUnder(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

export function createTensorTools(): Tool[] {
  const knowledge_tensor_build: Tool = {
    name: "knowledge_tensor_build",
    description:
      "Build a tensor store from a directory of .md/.txt/.pdf. Writes snapshot.json. No model.",
    parameters: [
      {
        name: "sourceDir",
        type: "string",
        description: "Directory of sources, relative to workspace root",
        required: true,
      },
      {
        name: "storeDir",
        type: "string",
        description: "Where to write snapshot.json",
        required: true,
      },
      {
        name: "rank",
        type: "number",
        description: "LSA rank (default 8)",
      },
    ],
    async execute(args, ctx: ToolContext): Promise<ToolResult> {
      const sourceDir = str(args.sourceDir);
      const storeDir = str(args.storeDir);
      if (!sourceDir || !storeDir) {
        return { ok: false, output: "", error: "knowledge_tensor_build: sourceDir and storeDir are required" };
      }
      try {
        const built = await buildTensorFromDir({
          sourceDir: resolveUnder(ctx.workspaceRoot, sourceDir),
          storeDir: resolveUnder(ctx.workspaceRoot, storeDir),
          rank: num(args.rank),
        });
        return {
          ok: true,
          output: `tensor store rows=${built.rows} files=${built.files.length} S=${built.core.S.shape.join("x")} id=${built.core.encodeId}`,
          data: {
            storeDir: built.storeDir,
            rows: built.rows,
            files: built.files,
            shape: built.core.S.shape,
            encodeId: built.core.encodeId,
          },
        };
      } catch (err) {
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const knowledge_tensor_ask: Tool = {
    name: "knowledge_tensor_ask",
    description:
      "Read ranked catalog rows from a tensor snapshot. No model. Requires knowledge_tensor_build first.",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "Question or keywords",
        required: true,
      },
      {
        name: "storeDir",
        type: "string",
        description: "Directory that contains snapshot.json",
        required: true,
      },
      {
        name: "limit",
        type: "number",
        description: "Max hits (default 5)",
      },
    ],
    async execute(args, ctx: ToolContext): Promise<ToolResult> {
      const query = str(args.query);
      const storeDir = str(args.storeDir);
      if (!query || !storeDir) {
        return { ok: false, output: "", error: "knowledge_tensor_ask: query and storeDir are required" };
      }
      try {
        const hits = await askStore(resolveUnder(ctx.workspaceRoot, storeDir), query, {
          limit: num(args.limit) ?? 5,
        });
        if (hits.length === 0) {
          return { ok: true, output: "No tensor hits.", data: { hits: [] } };
        }
        const lines = hits.map(
          (hit) =>
            `${hit.score.toFixed(3)}  ${hit.ref.sourcePath ?? hit.ref.sourceId}\n${hit.ref.row.text}`
        );
        return {
          ok: true,
          output: `${hits.length} tensor hit(s):\n\n${lines.join("\n\n")}`,
          data: {
            hits: hits.map((hit) => ({
              score: hit.score,
              sourcePath: hit.ref.sourcePath,
              text: hit.ref.row.text,
            })),
          },
        };
      } catch (err) {
        return { ok: false, output: "", error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [knowledge_tensor_build, knowledge_tensor_ask];
}
