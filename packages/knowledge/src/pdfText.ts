/**
 * Extract plain text from a PDF buffer (text-layer PDFs).
 * Scanned/image PDFs return little or empty text — caller should surface that.
 */

export interface PdfExtractResult {
  text: string;
  pageCount: number;
  chars: number;
  empty: boolean;
}

export async function extractPdfText(
  data: Buffer,
  options?: { maxChars?: number }
): Promise<PdfExtractResult> {
  const maxChars =
    options?.maxChars != null && Number.isFinite(options.maxChars)
      ? Math.max(1, Math.floor(options.maxChars))
      : 200_000;

  // Dynamic import so CI / environments without the dep fail only on use.
  const mod = await import("pdf-parse");
  const pdfParse =
    (mod as { default?: (b: Buffer) => Promise<{ text?: string; numpages?: number }> })
      .default ??
    (mod as unknown as (b: Buffer) => Promise<{ text?: string; numpages?: number }>);

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
}
