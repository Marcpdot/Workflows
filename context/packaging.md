# Packaging

## Single Orchestrator package owns all layers (temporary)

**Status:** active  
**Evidence:** confirmed  
**Source:** repo layout; decision 2026-08-01; re-confirmed after M10 (working session)  
**Revisit when:** daily multi-project use makes boundary friction obvious, or a second consumer package is required

> **Re-confirmed after M10:** Vertical shells M0–M10 exist under `Orchestrator/`. Split into separately versioned layer packages is **still deferred** — ship usage and harden shells before packaging tax. Intended long-term shape (Orchestrator wires layers) unchanged; timeline is “not yet,” not “never.”

Implementation of memory, tools, eval, embeddings, integration HTTP, web UI, compute policy, observability, workspace, and structured output currently lives **under `Orchestrator/`**. The runnable unit is one Node package. Layer *names* show up as subfolders and local `AGENTS.md` files; layer *boundaries* as separately versioned packages remain deferred.

**Reason:** One place to run, one dependency tree, one path for Grok Build. The vertical is complete as shells; splitting without real multi-package consumers would still be speculative.

**Rejected alternatives:**

- **Split packages immediately after M10** — re-confirmed deferred: no second consumer yet, interfaces still thin, cost outweighs benefit.
- **Stop feature/usage work to split mid-stack** — same as pre-M10: speculative boundaries.
- **Keep forever as one package** — still rejected as the *final* state for a long-lived Jarvis-layer; only the *timing* of the split stays open.

**Intended follow-up:** When revisit triggers, split so Orchestrator primarily wires layers rather than containing all of them.
