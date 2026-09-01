/** Turn a retrieved row into concrete fields a workspace can bind. */

export interface RowFact {
  date?: string;
  kind?: "lecture" | "quiz" | "cancelled" | "practice" | "other";
  topic?: string;
  chapter?: string;
  section?: string;
  notes?: string;
  status?: "ok" | "cancelled" | "tbd";
}

const DATE = /\b(\d{1,2}\/\d{1,2})\b/g;
const CHAPTER = /\b(?:chapter|kapittel)\s+(\d+)/i;
const SECTION = /\bsec\.?\s+([\d.,\s]+?)(?=\s+in\s+|\s*$)/i;
const NOTES = /\b(hydraulic-notes|electro-notes)\b/i;

function kindOf(text: string): RowFact["kind"] {
  if (/cancelled/i.test(text)) return "cancelled";
  if (/\bquiz\b/i.test(text)) return "quiz";
  if (/practice/i.test(text) && !/lecture/i.test(text)) return "practice";
  if (/lecture/i.test(text)) return "lecture";
  return "other";
}

function topicOf(text: string): string | undefined {
  const cleaned = text
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, " ")
    .replace(/\b(?:chapter|kapittel)\s+\d+/gi, " ")
    .replace(/\bsec\.?\s+[\d.,\s]+/gi, " ")
    .replace(/\b(?:hydraulic-notes|electro-notes)\b/gi, " ")
    .replace(/\b(?:lecture\s*\+|tutorials?|practice|quizzes?|recommended reading|date title|department of engineering|university of agder)\b/gi, " ")
    .replace(/["=]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3 || cleaned.length > 120) return cleaned.slice(0, 120) || undefined;
  return cleaned;
}

export function parseRowFact(text: string): RowFact | undefined {
  const dates = [...text.matchAll(DATE)].map((m) => m[1]!);
  const chapter = text.match(CHAPTER)?.[1];
  const section = text.match(SECTION)?.[1]?.replace(/\s+/g, " ").trim();
  const notes = text.match(NOTES)?.[1]?.toLowerCase();
  const cancelled = /cancelled/i.test(text);
  const tbd = /to be determined/i.test(text);
  const kind = kindOf(text);
  const topic = topicOf(text);
  const fact: RowFact = {};
  if (dates[0]) fact.date = dates[0];
  if (kind && kind !== "other") fact.kind = kind;
  else if (kind === "other" && (chapter || dates[0])) fact.kind = "lecture";
  if (topic) fact.topic = topic;
  if (chapter) fact.chapter = chapter;
  if (section) fact.section = section;
  if (notes) fact.notes = notes;
  if (cancelled) fact.status = "cancelled";
  else if (tbd) fact.status = "tbd";
  else if (fact.date || fact.chapter) fact.status = "ok";
  return Object.keys(fact).length > 0 ? fact : undefined;
}

export function factsFromHits(
  hits: Array<{ ref: { row: { text: string } } }>
): RowFact[] {
  return hits
    .map((hit) => parseRowFact(hit.ref.row.text))
    .filter((fact): fact is RowFact => fact !== undefined);
}
