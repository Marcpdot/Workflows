/** Optional OCR. Skips if tesseract.js / canvas are not installed. */

import { looksGarbled } from "./pdfQuality.js";

const DEFAULT_PAGES = 8;

async function loadPdfjs(): Promise<{
  getDocument: (opts: { data: Uint8Array; useSystemFonts?: boolean }) => { promise: Promise<PdfDoc> };
} | null> {
  try {
    const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
      getDocument?: unknown;
      default?: { getDocument?: unknown };
    };
    const getDocument = (mod.getDocument ?? mod.default?.getDocument) as
      | ((opts: { data: Uint8Array; useSystemFonts?: boolean }) => { promise: Promise<PdfDoc> })
      | undefined;
    return getDocument ? { getDocument } : null;
  } catch {
    return null;
  }
}

interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}

interface PdfPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
}

export async function extractPdfJsText(data: Buffer): Promise<string> {
  const pdfjs = await loadPdfjs();
  if (!pdfjs) return "";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => item.str ?? "")
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim()
    );
  }
  return pages.filter(Boolean).join("\n\n");
}

export async function extractPdfOcr(
  data: Buffer,
  options?: { maxPages?: number }
): Promise<{ text: string; pages: number; used: boolean; error?: string }> {
  if (process.env.TENSOR_OCR === "0") {
    return { text: "", pages: 0, used: false, error: "TENSOR_OCR=0" };
  }

  try {
    const pdfjs = await loadPdfjs();
    const canvasMod = await import("@napi-rs/canvas").catch(() => null);
    const tessMod = await import("tesseract.js").catch(() => null);
    if (!pdfjs || !canvasMod || !tessMod) {
      return {
        text: "",
        pages: 0,
        used: false,
        error: "OCR deps missing (pdfjs-dist, @napi-rs/canvas, tesseract.js)",
      };
    }

    const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
    const maxPages = Math.min(
      doc.numPages,
      options?.maxPages ?? Number(process.env.TENSOR_OCR_PAGES ?? DEFAULT_PAGES)
    );
    const worker = await tessMod.createWorker("nor+eng");
    const parts: string[] = [];
    try {
      for (let i = 1; i <= maxPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = canvasMod.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        const png = canvas.toBuffer("image/png");
        const recognized = await worker.recognize(png);
        const text = recognized.data.text?.trim() ?? "";
        if (text) parts.push(text);
      }
    } finally {
      await worker.terminate();
    }
    const text = parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    return { text, pages: maxPages, used: text.length > 0 };
  } catch (error) {
    return {
      text: "",
      pages: 0,
      used: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function recoverPdfText(data: Buffer, firstPass: string): Promise<string> {
  const jsText = await extractPdfJsText(data).catch(() => "");
  const candidates = [firstPass, jsText].filter((text) => text.trim().length > 0);
  candidates.sort((a, b) => Number(looksGarbled(a)) - Number(looksGarbled(b)) || b.length - a.length);
  const best = candidates[0] ?? "";
  if (best && !looksGarbled(best)) return best;

  const ocr = await extractPdfOcr(data);
  if (ocr.used && ocr.text && (!best || looksGarbled(best))) {
    if (!looksGarbled(ocr.text) || ocr.text.length > best.length * 0.6) return ocr.text;
  }
  return best;
}
