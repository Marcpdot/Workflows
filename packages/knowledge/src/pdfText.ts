/**
 * Extract plain text from a PDF buffer (text-layer PDFs).
 * Optional runtime dependency `pdf-parse` — not required for typecheck/CI.
 * Scanned/image PDFs return little or empty text — caller should surface that.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

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

function asParseFn(candidate: unknown): PdfParseFn | null {
  if (typeof candidate !== "function") return null;

  // pdf-parse v1: callable (buffer) => Promise
  // pdf-parse v2: class PDFParse — must use `new`
  const fn = candidate as PdfParseFn & { prototype?: { constructor?: unknown } };
  const looksLikeClass =
    typeof fn.prototype === "object" &&
    fn.prototype !== null &&
    fn.prototype.constructor === fn;

  if (looksLikeClass) {
    return async (data: Buffer) => {
      const Ctor = candidate as new (opts?: { data?: Buffer }) => {
        getText?: () => Promise<{ text?: string }>;
        getInfo?: () => Promise<{ numPages?: number; pages?: number }>;
        text?: string;
        numpages?: number;
        destroy?: () => Promise<void> | void;
      };
      const instance = new Ctor({ data });
      try {
        if (typeof instance.getText === "function") {
          const result = await instance.getText();
          let pageCount = 0;
          if (typeof instance.getInfo === "function") {
            const info = await instance.getInfo();
            pageCount = info.numPages ?? info.pages ?? 0;
          }
          return { text: result?.text ?? "", numpages: pageCount };
        }
        // Fallback if API differs
        const legacy = candidate as PdfParseFn;
        return await legacy(data);
      } finally {
        try {
          await instance.destroy?.();
        } catch {
          /* ignore */
        }
      }
    };
  }

  return fn;
}

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
    if (typeof mod === "function") {
      return asParseFn(mod);
    }
    if (mod && typeof mod === "object") {
      const record = mod as Record<string, unknown>;
      for (const key of ["default", "PDFParse", "pdfParse", "PDF"]) {
        const wrapped = asParseFn(record[key]);
        if (wrapped) return wrapped;
      }
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
