# Fix: Web UI chat layout scroll + word wrap

## Context

Usage feedback after interaction-mode UI is live:

1. Long conversations make the **whole page** grow. Sidebar, mode controls, and proposals panel appear stuck at the initial viewport while the user scrolls the document — they no longer stay usable beside the chat.
2. Assistant/user bubbles **break mid-word** (or restart a word on the next line) when the line runs out of horizontal space.

These are pure presentation bugs in `packages/orchestrator/src/ui/web/public/`. No orchestrator, knowledge, or session logic changes.

## Goals

- Chat column scrolls internally; header, left sidebar, and proposals panel stay fixed in the viewport for the session.
- Bubble text wraps at word boundaries (or only breaks a word when unavoidable for overflow), never mid-syllable as the default behaviour.
- No change to JS behaviour except if a tiny class/structure tweak is required for the CSS grid/flex fix.

## Non-goals

- Proposals content quality / extract rework (separate)
- Active-mode prompt tuning
- Model selection
- Mobile redesign beyond not regressing the existing simple stacked layout

## Files

Primary:

- `packages/orchestrator/src/ui/web/public/styles.css`

Touch only if required for structure:

- `packages/orchestrator/src/ui/web/public/index.html`
- `packages/orchestrator/src/ui/web/public/app.js` (unlikely)

## Fix 1 — Viewport-locked shell, scroll inside chat

### Current problem

`.app` uses `min-height: 100vh` and a grid, but the document grows with `.log` content. Body/document scroll moves everything; side columns do not remain a stable chrome.

### Required behaviour

```
┌─────────────────────────────────────────────────────────┐
│ header (fixed in viewport)                              │
├──────────┬──────────────────────────────┬───────────────┤
│ sidebar  │ main                         │ proposals     │
│ (own     │  ┌ log (overflow-y: auto) ─┐ │ (own scroll   │
│  scroll  │  │ bubbles…                │ │  if needed)   │
│  if      │  │                         │ │               │
│  needed) │  └ composer (pinned bottom)┘ │               │
└──────────┴──────────────────────────────┴───────────────┘
```

### CSS direction (implement equivalently)

```css
html, body {
  height: 100%;
  margin: 0;
  overflow: hidden; /* scroll lives in panes, not the document */
}

.app {
  height: 100%;
  min-height: 0;
  /* keep existing grid areas */
  display: grid;
  grid-template-columns: 260px 1fr minmax(260px, 320px);
  grid-template-rows: auto 1fr;
  grid-template-areas:
    "top top top"
    "side main proposals";
}

.sidebar,
.proposals-panel,
.main {
  min-height: 0; /* critical for nested overflow in grid/flex */
  overflow: hidden;
}

.sidebar {
  overflow-y: auto; /* meta can be long */
}

.main {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.composer {
  flex-shrink: 0;
}

.proposals-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.proposals-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
```

On narrow breakpoints, prefer stacked layout **with** internal scroll on main rather than unbounded document growth if practical; at minimum do not regress desktop behaviour.

### Done when

- After many messages, only the chat log scrolls.
- Mode toggle, session fields, and proposals panel remain visible/usable without scrolling the whole page away.
- Composer stays at the bottom of the main column.

## Fix 2 — Word wrap in bubbles

### Current problem

`.bubble` uses `white-space: pre-wrap` + `word-break: break-word`. In practice users still see mid-word breaks / repeated word starts on the next line.

### Required behaviour

- Prefer wrapping at spaces/soft break opportunities.
- Do not use `word-break: break-all`.
- Long unbroken tokens (URLs, ids) may break only when needed to avoid horizontal overflow.

### CSS direction

```css
.bubble {
  white-space: pre-wrap;
  overflow-wrap: anywhere; /* or break-word */
  word-break: normal;
  hyphens: none;
  max-width: min(720px, 95%);
}
```

Ensure the bubble’s text node/container does not force a smaller width that triggers aggressive breaking. If text is set via `textContent` (it is), no HTML change needed.

Also apply the same wrap rules to `.proposal-card .label` if mid-word breaks appear there.

### Done when

- Normal Norwegian/English sentences wrap between words.
- No systematic “cut word in half, then continue underneath” for ordinary prose.

## Verification

Manual (primary):

1. `cd packages/orchestrator && npm run ui`
2. Send 15+ messages so the log exceeds the viewport.
3. Confirm: page body does not scroll; log scrolls; sidebar + proposals stay on screen; composer visible.
4. Paste a long Norwegian sentence and a long English sentence; confirm wraps at word boundaries.
5. Paste a long token (e.g. session id); confirm no horizontal page overflow.

Optional: no new smoke required if pure CSS; keep `smoke-ui` green if it exists.

## Implementation notes for Codex / any agent

- Scope **only** the layout/wrap fix above.
- Do not refactor the web UI architecture, do not change capture/mode logic, do not restyle the whole theme.
- Prefer minimal diff in `styles.css`.
- Match existing dark theme variables.
