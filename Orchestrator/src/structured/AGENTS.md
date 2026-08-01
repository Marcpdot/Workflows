# Milestone 10 — Structured output

## Mål
Påliteligere **parsebare** modelsvar (JSON / planer) for tools, pipeline og eval.

## Scope
1. `completeStructured(prompt, schema)`-stil API over model clients
2. Schema: enkel JSON Schema-subset eller Zod-lignende beskrivelse (hold deps lette)
3. Retry/repair: 1–2 forsøk hvis parse feiler (valgfri lokal «fix JSON»-pass)
4. Brukes av: tool-call parsing (forsterker M2), pipeline planner output, eval assertions
5. Fallback: raw text + parse failure object (ikke crash)

## Utenfor scope
- Full constrained decoding / grammar på alle backends
- Kun-frontier structured mode som eneste path

## API (skisse)

```ts
export interface StructuredResult<T> {
  ok: boolean;
  value?: T;
  raw: string;
  error?: string;
  attempts: number;
}

export async function completeStructured<T>(options: {
  complete: (messages: ChatMessage[]) => Promise<string>;
  messages: ChatMessage[];
  parse: (raw: string) => T;  // throw on failure
  maxAttempts?: number;
}): Promise<StructuredResult<T>>;
```

## Integrasjon
- Tool-loop kan bruke structured parse for `tool_calls`
- Pipeline planner kan be om `{ steps: string[] }`
- Eval kan assert'e på strukturerte felt senere

## Ferdig når
- Smoke: mock complete returnerer rotten JSON → repair eller ok:false
- Minst én produksjons-path (tools eller pipeline) bruker helper
- Raw chat-path uendret
