# Milestone 8 — Observability

## Mål
En enkel, strukturert logg over hva systemet faktisk gjør: route, modell, tokens, latency, tool-kall.

## Scope
1. `OrchestratorEvent` / span-lignende poster per request
2. Sink: JSON-linjer til fil under `data/logs/` (gitignored) + valgfri stderr
3. Felt: timestamp, sessionId, route, model, provider, latencyMs, tokens, toolNames, errors, policy reason
4. CLI/flagg: `--verbose` allerede delvis — enhetlig event-emitter internt
5. Ingen ekstern SaaS-krav (Prometheus/etc. senere)

## Utenfor scope
- Full OpenTelemetry-distribusjon
- Real-time dashboard (UI kan lese logg senere)
- PII-scrubbing utover «ikke logg full prompt by default» (konfigurerbart)

## API (skisse)

```ts
export interface OrchestratorEvent {
  ts: string;
  kind: "request" | "tool" | "error";
  sessionId?: string;
  route?: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
  tokens?: number;
  tools?: string[];
  error?: string;
  meta?: Record<string, unknown>;
}

export interface Observer {
  emit(event: OrchestratorEvent): void;
}
```

## Env
```
OBS_ENABLED=true
OBS_LOG_PATH=./data/logs/orchestrator.jsonl
OBS_LOG_PROMPTS=false
```

## Ferdig når
- Hver handle() kan produsere minst ett request-event
- Tool-steg kan logges
- Fil-sink fungerer; smoke leser tilbake en event
