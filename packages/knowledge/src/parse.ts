/** One workspace fact per dated session, not one blob per retrieved row. */

export interface RowFact {
  date?: string;
  kind?: "lecture" | "quiz" | "cancelled" | "practice" | "other";
  topic?: string;
  chapter?: string;
  section?: string;
  notes?: string;
  status?: "ok" | "cancelled" | "tbd";
}

const DATE = /\b(\d{1,2}\/\d{1,2})\b/;
const CHAPTER = /\b(?:chapter|kapittel)\s+(\d+)/i;
const SECTION = /\bsec\.?\s+([\d.,]+(?:\s*,\s*[\d.]+)*)/i;
const NOTES = /\b(hydraulic-notes|electro-notes)\b/i;
const HEADER =
  /university of agder|department of engineering|recommended reading|date title|michael rygaard|mas237 lecture plan|lecture plan #/i;

function sessions(text: string): string[] {
  const parts = text
    .replace(/\b(\d{1,2}\/\d{1,2})\b/g, "\n###$1 ")
    .split(/\n###/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text.replace(/\s+/g, " ").trim()];
}

function kindOf(text: string): RowFact["kind"] {
  if (/cancelled/i.test(text)) return "cancelled";
  if (/lecture/i.test(text)) return "lecture";
  if (/\bquizzes?\b/i.test(text)) return "quiz";
  if (/practice/i.test(text)) return "practice";
  return "other";
}

function topicOf(text: string): string | undefined {
  const cleaned = text
    .replace(DATE, " ")
    .replace(/\b(?:chapter|kapittel)\s+\d+/gi, " ")
    .replace(/\bsec\.?\s+[\d.,\s]+/gi, " ")
    .replace(/\b(?:hydraulic-notes|electro-notes)\b/gi, " ")
    .replace(
      /\b(?:lecture\s*\+|tutorials?|practice|quizzes?|qh\d|qe\d|in)\b/gi,
      " "
    )
    .replace(/["=]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || HEADER.test(cleaned)) return undefined;
  return cleaned.slice(0, 80);
}

export function parseSession(text: string): RowFact | undefined {
  if (HEADER.test(text) && !DATE.test(text) && !CHAPTER.test(text)) return undefined;
  const date = text.match(DATE)?.[1];
  const chapter = text.match(CHAPTER)?.[1];
  const section = text.match(SECTION)?.[1]?.replace(/\s+/g, " ").trim();
  const notes = text.match(NOTES)?.[1]?.toLowerCase();
  const kind = kindOf(text);
  const topic = topicOf(text);
  const fact: RowFact = {};
  if (date) fact.date = date;
  if (kind !== "other") fact.kind = kind;
  else if (date || chapter) fact.kind = "lecture";
  if (topic) fact.topic = topic;
  if (chapter) fact.chapter = chapter;
  if (section) fact.section = section;
  if (notes) fact.notes = notes;
  if (/cancelled/i.test(text)) fact.status = "cancelled";
  else if (/to be determined/i.test(text)) fact.status = "tbd";
  else if (date || chapter) fact.status = "ok";
  if (!fact.date && !fact.chapter) return undefined;
  return fact;
}

export function parseRowFacts(text: string): RowFact[] {
  return sessions(text)
    .map(parseSession)
    .filter((fact): fact is RowFact => fact !== undefined);
}

export function parseRowFact(text: string): RowFact | undefined {
  return parseRowFacts(text)[0];
}
