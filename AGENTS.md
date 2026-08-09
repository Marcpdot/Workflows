# AGENTS.md

This project uses Keep the Why to preserve the reasoning behind its code.

- Orchestrator usage: see `packages/orchestrator/README.md`
- High-level system shape: see `ARCHITECTURE.md`
- Why things are the way they are: see `context/index.md`
- If `AGENTS.local.md` exists in this repo, read that too — personal/local notes.

Read `context/index.md` before making non-trivial changes to understand
prior decisions and avoid re-litigating or accidentally reverting them.

## Documentation discipline

Treat repository documentation as durable system knowledge, not as a per-change scratchpad.

- Put implementation-specific plans, workstreams, acceptance criteria, migration steps, and temporary delivery notes in the pull request description.
- Update an existing `context/*.md` file when a durable design decision or its rationale changes. Prefer integrating into the existing topic file over creating a new one.
- Update `ARCHITECTURE.md` only when the high-level system shape changes.
- Keep package `README.md` files focused on current usage and package boundaries.
- Keep package/root `AGENTS.md` files focused on current agent rules, contracts, and invariants.
- Do not create a new standalone Markdown plan/spec file for each feature or milestone unless the design is genuinely cross-cutting, long-lived, and does not fit an existing durable home.
- Historical implementation plans belong in Git/PR history; current repository docs should describe the system as it is intended to remain.

<!-- keep-the-why:config -->
- context: `context/`
- init: complete
- context-schema: 0.6.3
- capture-confirmation: confirm-when-unsure
- source-reference: never
<!-- /keep-the-why:config -->
