# Packaging

## Single Orchestrator package owns all layers (temporary)

**Status:** active  
**Evidence:** confirmed  
**Source:** repo layout; decision 2026-08-01  
**Revisit when:** M10 done — then refactor into clearer packages/folders per layer

Implementation of memory, tools, eval, embeddings, integration HTTP, web UI, compute policy, and observability currently lives **under `Orchestrator/`**. The runnable unit is one Node package. Layer *names* show up as subfolders and local `AGENTS.md` files; layer *boundaries* as separately versioned packages are deferred.

**Reason:** One place to run, one dependency tree, one path for Grok Build. Ship the vertical (M0–M8 shells, then M9–M10) before paying packaging tax.

**Rejected alternatives:**

- **Stop feature work to split packages mid-stack** — refactor before M9–M10 surfaces would still be speculative.
- **Keep forever as one package** — acknowledged as not disciplined enough for a long-lived Jarvis-layer under many projects.

**Intended follow-up:** After M10, split so Orchestrator primarily wires layers rather than containing all of them.
