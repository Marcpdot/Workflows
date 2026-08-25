/**
 * Extract plain text from a PDF buffer (text-layer PDFs).
 * Optional runtime dependency `pdf-parse` — not required for typecheck/CI.
 * Scanned/image PDFs return little or empty text — caller should surface that.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface PdfExtractResult {
  text: string;
  pageCount: number;
  chars: number;
  empty: boolean;
  error?: string;
}

type PdfParseFn = (data: Buffer) => Promise<{
  text?: string;
  numpages?: number;
}>;

const requireFromHere = createRequire(import.meta.url);

/**
 * Load pdf-parse relative to this package so orchestrator/tsx runs still
 * resolve packages/knowledge/node_modules/pdf-parse.
 */
async function loadPdfParse(): Promise<PdfParseFn | null> {
  try {
    let resolved: string;
    try {
      resolved = requireFromHere.resolve("pdf-parse");
    } catch {
      return null;
    }
    const mod: unknown = await import(pathToFileURL(resolved).href);
    if (typeof mod === "function") return mod as PdfParseFn;
    if (mod && typeof mod === "object") {
      const def = (mod as { default?: unknown }).default;
      if (typeof def === "function") return def as PdfParseFn;
      // pdf-parse v2 may export { PDFParse } or similar — prefer default/callable
      const nested = (mod as { PDFParse?: unknown }).PDFParse;
      if (typeof nested === "function") return nested as PdfParseFn;
    }
    return null;
  } catch {
    return null;
  }
}

export async function extractPdfText(
  data: Buffer,
  options?: { maxChars?: number }
): Promise<PdfExtractResult> {
  const maxChars =
    options?.maxChars != null && Number.isFinite(options.maxChars)
      ? Math.max(1, Math.floor(options.maxChars))
      : 200_000;

  const pdfParse = await loadPdfParse();
  if (!pdfParse) {
    return {
      text: "",
      pageCount: 0,
      chars: 0,
      empty: true,
      error:
        "pdf-parse is not installed. Run: npm install pdf-parse --prefix packages/knowledge (commit package-lock.json for CI)",
    };
  }

  try {
    const parsed = await pdfParse(data);
    let text = (parsed.text ?? "").replace(/\r/g, "").trim();
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    if (text.length > maxChars) {
      text = text.slice(0, maxChars) + "\n\n[truncated]";
    }
    const pageCount = parsed.numpages ?? 0;
    return {
      text,
      pageCount,
      chars: text.length,
      empty: text.length < 40,
    };
  } catch (err) {
    return {
      text: "",
      pageCount: 0,
      chars: 0,
      empty: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
