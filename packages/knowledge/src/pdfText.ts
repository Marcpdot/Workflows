/**
 * Extract plain text from a PDF buffer (text-layer PDFs).
 * Optional runtime dependency `pdf-parse` — not required for typecheck/CI.
 * Scanned/image PDFs return little or empty text — caller should surface that.
 */

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

/** Avoid static `import("pdf-parse")` so tsc does not require the package. */
async function loadPdfParse(): Promise<PdfParseFn | null> {
  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)"
    ) as (specifier: string) => Promise<unknown>;
    const mod = await dynamicImport("pdf-parse");
    if (typeof mod === "function") return mod as PdfParseFn;
    if (mod && typeof mod === "object") {
      const def = (mod as { default?: unknown }).default;
      if (typeof def === "function") return def as PdfParseFn;
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
