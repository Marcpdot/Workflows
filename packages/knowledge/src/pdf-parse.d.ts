declare module "pdf-parse" {
  interface PdfParseResult {
    text?: string;
    numpages?: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
  }
  function pdfParse(data: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
