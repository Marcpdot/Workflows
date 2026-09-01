/** Turn flattened PDF text into session-sized blocks. */

export function unfoldPdfText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\b(\d{1,2}\/\d{1,2})\b/g, "\n\n$1")
    .replace(/\b(Lecture\s*\+)/gi, "\n$1")
    .replace(/\b((?:Chapter|Kapittel)\s+\d+)/gi, "\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
