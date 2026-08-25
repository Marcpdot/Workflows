import type { Tool } from "@workflows/tools";
import { ingestDirectory } from "./ingest.js";
import type { KnowledgeStore } from "./types.js";

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

export function createKnowledgeIngestDirTool(store: KnowledgeStore): Tool {
  return {
    name: "knowledge_ingest_dir",
    description:
      "Ingest all .md/.txt/.pdf files in a workspace directory as transform jobs (as-is + chunks). Does not accept.",
    parameters: [
      {
        name: "path",
        type: "string",
        description:
          'Directory relative to workspace (e.g. "work/FYS128_Fysikk/Lecture_notes")',
        required: true,
      },
      {
        name: "recursive",
        type: "boolean",
        description: "Walk subfolders (default false)",
        required: false,
      },
      {
        name: "maxFiles",
        type: "number",
        description: "Max files to ingest this call (default 20)",
        required: false,
      },
      {
        name: "projectLabel",
        type: "string",
        description: "Optional project label stamped into sourceRef",
        required: false,
      },
    ],
    async execute(args, ctx) {
      const path = str(args.path);
      if (!path) {
        return {
          ok: false,
          output: "",
          error: "knowledge_ingest_dir: path is required",
        };
      }
      const recursive =
        args.recursive === true ||
        args.recursive === "true" ||
        args.recursive === 1;
      const maxFiles = Math.min(100, Math.max(1, num(args.maxFiles) ?? 20));
      try {
        const batch = await ingestDirectory(store, {
          path,
          workspaceRoot: ctx.workspaceRoot,
          recursive,
          maxFiles,
          extensions: [".md", ".txt", ".pdf"],
          projectLabel: str(args.projectLabel),
          minChars: 40,
        });
        const lines = batch.results.map((r, i) => {
          if (r.status === "skipped") {
            return `${i + 1}. SKIP ${r.sourceRef} — ${r.reason ?? "skipped"}`;
          }
          if (r.status === "failed") {
            return `${i + 1}. FAIL ${r.sourceRef} job=${r.jobId || "none"} — ${r.reason ?? "failed"}`;
          }
          return `${i + 1}. OK ${r.sourceRef} job=${r.jobId} chunks=${r.chunkCount} status=${r.status}`;
        });
        return {
          ok: true,
          output: `Ingest dir ${path}: scanned=${batch.scanned} ingested=${batch.ingested} failed=${batch.failed} skipped=${batch.skipped}\n${lines.join("\n")}\nJobs await accept before they are canonical.`,
          data: {
            scanned: batch.scanned,
            ingested: batch.ingested,
            failed: batch.failed,
            skipped: batch.skipped,
            results: batch.results.map((r) => ({
              sourceRef: r.sourceRef,
              status: r.status,
              reason: r.reason,
              jobId: r.jobId,
              chunkCount: r.chunkCount,
            })),
          },
        };
      } catch (err) {
        return {
          ok: false,
          output: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
