/** Expand Norwegian query tokens so they can hit English lecture notes. */

const SYN: Record<string, string> = {
  kapitler: "chapter chapters kapittel",
  kapittel: "chapter chapters",
  datoer: "date dates",
  dato: "date dates",
  notatene: "notes note lecture",
  notater: "notes note",
  notat: "note notes",
  enheter: "units unit",
  størrelser: "quantities quantity",
  fysikk: "physics",
};

export function expandQuery(text: string): string {
  return text.replace(/\p{L}+/gu, (word) => {
    const extra = SYN[word.toLowerCase()];
    return extra ? `${word} ${extra}` : word;
  });
}
