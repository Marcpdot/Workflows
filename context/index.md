# Context index

Lean index of why-knowledge. Load a topic file only when relevant.

- [architecture.md](architecture.md) — layered intent; handle pipeline (mode, capture); package shape
- [milestones.md](milestones.md) — shell-first; **M0–M18** + post-M18 continuous capture
- [packaging.md](packaging.md) — **packages/* + packages/orchestrator**; knowledge vs voice split
- [routing.md](routing.md) — rule-based local vs frontier selection
- [policy.md](policy.md) — budget/tier compute policy over the router (M7)
- [memory.md](memory.md) — short-term SQLite; LTM; **session_state** (interaction mode)
- [knowledge.md](knowledge.md) — world model M11–M18 + **continuous capture decisions** (`04415a5` / `7d474bb`)
- [workspace.md](workspace.md) — multi-project session/workspace isolation (M9)
- [structured.md](structured.md) — parseable JSON + repair, not constrained decoding (M10)
- [models.md](models.md) — default small local model, Ollama CLI, Grok frontier
- [privacy.md](privacy.md) — personal model out of public repo; knowledge DB + voice remote gates
- [interface.md](interface.md) — CLI first; M6 web; M18 voice; **mode + session proposals panel**
- [integration.md](integration.md) — CLI + HTTP same brain; knowledge read + session proposals queue
- [observability.md](observability.md) — local JSONL events, prompts off (M8)
- Design (how): [`docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md`](../docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md), [`docs/INTERACTION_CAPTURE_ITERATION.md`](../docs/INTERACTION_CAPTURE_ITERATION.md)
