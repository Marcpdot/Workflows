# Milestone 10 — Structured output

## Mål
Påliteligere **parsebare** modelsvar (JSON / planer) for tools, pipeline og eval.

## Implementert (shell)

| Del | Hvor |
|-----|------|
| `completeStructured` + repair turns | `completeStructured.ts` |
| JSON extract + lenient repair | `extractJson.ts` |
| JSON Schema subset validate | `validate.ts` |
| `PLAN_SCHEMA` / `TOOL_CALLS_SCHEMA` | `schemas.ts` |
| Pipeline planner | `orchestrator.runPipeline` asks for plan JSON when no tool loop |
| Tool text parse | `parseToolCalls` uses shared `extractJsonCandidates` |

```bash
npx tsx scripts/smoke-structured.ts
```

Raw `handle()` chat path is **unchanged**.

## Utenfor scope
- Full constrained decoding / grammar på alle backends
- Kun-frontier structured mode som eneste path
- Zod / full JSON Schema draft

## API

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

## Ferdig når
- Smoke: mock complete returnerer rotten JSON → repair eller ok:false
- Minst én produksjons-path (tools eller pipeline) bruker helper
- Raw chat-path uendret
