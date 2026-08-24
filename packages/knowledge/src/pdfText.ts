/**
 * Extract plain text from a PDF buffer (text-layer PDFs).
 * Uses optional runtime dependency `pdf-parse` when installed locally.
 * Scanned/image PDFs return little or empty text — caller should surface that.
 */

export interface PdfExtractResult {
  text: string;
  pageCount: number;
  chars: number;
  empty: boolean;
  error?: string;
}

export async function extractPdfText(
  data: Buffer,
  options?: { maxChars?: number }
): Promise<PdfExtractResult> {
  const maxChars =
    options?.maxChars != null && Number.isFinite(options.maxChars)
      ? Math.max(1, Math.floor(options.maxChars))
      : 200_000;

  let pdfParse:
    | ((b: Buffer) => Promise<{ text?: string; numpages?: number }>)
    | null = null;
  try {
    const mod = await import("pdf-parse");
    const m = mod as {
      default?: (b: Buffer) => Promise<{ text?: string; numpages?: number }>;
    } & ((b: Buffer) => Promise<{ text?: string; numpages?: number }>);
    pdfParse = typeof m === "function" ? m : m.default ?? null;
  } catch {
    return {
      text: "",
      pageCount: 0,
      chars: 0,
      empty: true,
      error:
        "pdf-parse is not installed. Run: npm install pdf-parse --prefix packages/knowledge (then commit package-lock.json)",
    };
  }

  if (!pdfParse) {
    return {
      text: "",
      pageCount: 0,
      chars: 0,
      empty: true,
      error: "pdf-parse module did not export a parser function",
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
