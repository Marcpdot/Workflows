# Orchestrator (Milestone 0)

Minimal modular TypeScript orchestrator:

1. Receive user request  
2. Analyze task type + complexity  
3. Route to **local (Ollama CLI)** or **frontier (xAI Grok)**  
4. Call selected model  
5. Return reply  

## Setup

```bash
cd Orchestrator
npm install
cp .env.example .env
# Set XAI_API_KEY (local default: gemma4:12b)
```

Requires:

- **Node.js** ≥ 20  
- **Ollama** on PATH (or `OLLAMA_BIN`) with a pulled model  
- **xAI API key** for Grok (`XAI_API_KEY`)

## Usage

```bash
# One-shot
npm run dev -- "Oppsummer denne teksten: ..."
npm run dev -- --route-only "Design a distributed cache"
npm run dev -- --local "Skriv en TypeScript helper"
npm run dev -- --frontier "Reason step by step about ..."

# Interactive REPL
npm run dev
```

Build:

```bash
npm run build
npm start -- "hello"
```

## Layout

| File | Role |
|------|------|
| `src/router.ts` | Task analysis + routing rules |
| `src/models/local.ts` | Ollama CLI client (`ollama run`) |
| `src/models/frontier.ts` | xAI Grok client (chat completions) |
| `src/orchestrator.ts` | Wire routing + models |
| `src/types.ts` | Shared types |
| `src/index.ts` | CLI entry |

## Routing (Milestone 0)

- low / summarize / tool → local  
- medium code → local  
- high / research / reasoning → frontier (Grok)  
