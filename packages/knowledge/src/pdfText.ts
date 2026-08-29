/**
 * Extract plain text from a PDF buffer.
 * Text layer first (pdf-parse, pdfjs). OCR if the layer is empty or garbled.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { recoverPdfText } from "./pdfOcr.js";
import { looksGarbled } from "./pdfQuality.js";

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
        return await (candidate as PdfParseFn)(data);
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

async function loadPdfParse(): Promise<PdfParseFn | null> {
  try {
    let resolved: string;
    try {
      resolved = requireFromHere.resolve("pdf-parse");
    } catch {
      return null;
    }
    const mod: unknown = await import(pathToFileURL(resolved).href);
    if (typeof mod === "function") return asParseFn(mod);
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
  let first = "";
  let pageCount = 0;
  let error: string | undefined;

  if (!pdfParse) {
    error =
      "pdf-parse is not installed. Run: npm install pdf-parse --prefix packages/knowledge";
  } else {
    try {
      const parsed = await pdfParse(data);
      first = (parsed.text ?? "").replace(/\r/g, "").trim();
      first = first.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
      pageCount = parsed.numpages ?? 0;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  let text = first;
  if (!text || looksGarbled(text)) {
    text = await recoverPdfText(data, first);
  }
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n\n[truncated]";

  return {
    text,
    pageCount,
    chars: text.length,
    empty: text.length < 40,
    error: text.length >= 40 ? undefined : error,
  };
}
