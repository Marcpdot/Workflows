# Milestone 16 — First-principles workflow

## Mål

Gi en **fast, gjenbrukbar mal** for first-principles-analyse som skriver strukturert til knowledge-grafen (events + claims + relations) — ikke fri tekst alene.

Dette er *én* workflow oppå generelt knowledge-lag (M11–M15), ikke en begrensning av laget.

## Scope

1. **Template** — ordnet steg:
   - Goal / what the system must do
   - Relevant physical (or domain) laws & invariants
   - Absolute limits vs contingent limits
   - Subsystems & bottlenecks
   - Scaling consequences
   - Next bottleneck / experiment
2. **Runner** — `runFirstPrinciplesAnalysis({ topic, goal?, projectLabel?, complete })`  
   → structured extraction per steg → **proposals** (eller batched event)
3. **Graph shape** — concepts for quantities/limits; claims for assertions; relations `requires` / `limits` / `causes` / `increases` / `reduces`; link to project if provided (M13)
4. **Tool** — `knowledge_first_principles` `{ topic, goal?, projectLabel? }`
5. **CLI** — `--knowledge fp --topic "..."`
6. **Smoke** — fixture structured steps → proposals med forventede relation types; offline uten frontier optional path

## Utenfor scope

- Kun FP-analyser i hele knowledge-laget (laget forblir generelt)
- Autonom lab/hardware execution
- Perfect physics solver (LLM + graph assist, not simulation engine)
- Voice (M18)

## Output contract (structured)

```ts
interface FirstPrinciplesResult {
  goal: string;
  laws: Array<{ label: string; description?: string }>;
  limits: Array<{ label: string; kind: "absolute" | "contingent"; description?: string }>;
  bottlenecks: Array<{ label: string; description?: string }>;
  relations: Array<{ from: string; relation: string; to: string }>;
  nextActions: Array<{ label: string; description?: string }>;
}
```

Map to existing proposal kinds (nodes/edges). Prefer accept-gate unchanged.

## Ferdig når

- [x] template + runner produserer proposals i stabil shape
- [x] tool + CLI
- [x] optional project link via M13 helpers
- [x] smoke offline with fixture
- [x] documented as workflow, not as sole purpose of knowledge
