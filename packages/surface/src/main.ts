import "./styles.css";
import {
  getHealth,
  getNeighborhood,
  getNode,
  getSession,
  getStatus,
  listPendingProposals,
  listProposals,
  resolveProposal,
  searchNodes,
  streamChat,
  subscribeEvents,
} from "./api.js";
import {
  SESSION_ID,
  type ChatDone,
  type ChatFocus,
  type KnowledgeNode,
  type StatusResponse,
  type WorkPhase,
} from "./types.js";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const presencePills = $("presencePills");
const searchForm = $("searchForm") as HTMLFormElement;
const searchLabel = $("searchLabel") as HTMLInputElement;
const searchType = $("searchType") as HTMLSelectElement;
const searchHint = $("searchHint");
const searchResults = $("searchResults");
const stageEmpty = $("stageEmpty");
const stageObject = $("stageObject");
const neighborhood = $("neighborhood");
const neighborhoodList = $("neighborhoodList");
const workStatus = $("workStatus");
const workReply = $("workReply");
const workMeta = $("workMeta");
const workForm = $("workForm") as HTMLFormElement;
const promptEl = $("prompt") as HTMLTextAreaElement;
const workBtn = $("workBtn") as HTMLButtonElement;
const focusHint = $("focusHint");
const proposalCount = $("proposalCount");
const proposalList = $("proposalList");
const findDrawer = $("findDrawer");
const proposalsDrawer = $("proposalsDrawer");
const toggleFind = $("toggleFind") as HTMLButtonElement;
const toggleProposals = $("toggleProposals") as HTMLButtonElement;
const closeFind = $("closeFind") as HTMLButtonElement;
const closeProposals = $("closeProposals") as HTMLButtonElement;
const focusStrip = $("focusStrip");
const clearFocusBtn = $("clearFocus") as HTMLButtonElement;
const systemLine = $("systemLine");
const proposalBadge = $("proposalBadge");

let selected: KnowledgeNode | null = null;
let namespacedSessionId = SESSION_ID;
let knowledgeReadOk = true;
let workBusy = false;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function strField(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function pill(label: string, state: "ok" | "warn" | "down"): string {
  return `<span class="pill ${state}">${escapeHtml(label)}</span>`;
}

function renderPresence(status: StatusResponse | null, live: boolean): void {
  if (!live || !status) {
    presencePills.innerHTML = pill("system down", "down");
    return;
  }
  const parts = [
    pill(status.degraded ? "degraded" : "system here", status.degraded ? "warn" : "ok"),
    pill(status.busy ? "busy" : "idle", status.busy ? "warn" : "ok"),
  ];
  if (status.knowledge.configured) {
    parts.push(
      pill(
        status.knowledge.ok
          ? `knowledge ${status.knowledge.backend || "ok"}`
          : "knowledge down",
        status.knowledge.ok ? "ok" : "down"
      )
    );
  }
  parts.push(
    pill(
      status.model.local.ok
        ? `local ${status.model.local.model}`
        : "local down",
      status.model.local.ok ? "ok" : "down"
    )
  );
  parts.push(
    pill(
      status.model.frontier.configured ? "frontier on" : "frontier off",
      status.model.frontier.configured ? "ok" : "warn"
    )
  );
  parts.push(
    pill(
      status.voice.enabled ? `voice ${status.voice.sttProvider}` : "voice off",
      status.voice.enabled ? "ok" : "warn"
    )
  );
  presencePills.innerHTML = parts.join("");
}

function setWorkPhase(phase: WorkPhase, detail?: string): void {
  const labels: Record<WorkPhase, string> = {
    idle: "Ready when you are.",
    accepted: "Accepted.",
    running: "Working…",
    complete: "Done.",
    error: detail || "Error",
  };
  workStatus.textContent = labels[phase];
  workStatus.className = phase === "error" ? "error" : "muted";
}

function currentFocus(): ChatFocus | undefined {
  if (!selected) return undefined;
  const focus: ChatFocus = {
    knowledgeId: selected.id,
    nodeIds: [selected.id],
    labels: selected.label ? [selected.label] : undefined,
  };
  if (selected.type === "project") {
    focus.projectId = selected.id;
    focus.projectLabel = selected.label;
  }
  if (selected.workspaceId) focus.workspaceId = selected.workspaceId;
  return focus;
}

function renderFocusHint(): void {
  if (!selected) {
    focusHint.textContent = "No focus";
    return;
  }
  focusHint.textContent = `Focus: ${selected.type} · ${selected.label}`;
}

function renderStage(): void {
  if (!selected) {
    stageEmpty.hidden = false;
    focusStrip.hidden = true;
    stageObject.innerHTML = "";
    neighborhood.hidden = true;
    renderFocusHint();
    return;
  }
  stageEmpty.hidden = true;
  focusStrip.hidden = false;
  stageObject.innerHTML = `
    <div class="kind">${escapeHtml(selected.type)} · ${escapeHtml(selected.status)}</div>
    <strong>${escapeHtml(selected.label)}</strong>
    <span class="id muted">${escapeHtml(selected.id)}</span>
    ${
      selected.description
        ? `<p class="focus-desc">${escapeHtml(selected.description)}</p>`
        : ""
    }
  `;
  renderFocusHint();
}

function setDrawer(drawer: HTMLElement, toggle: HTMLButtonElement, open: boolean): void {
  drawer.hidden = !open;
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  toggle.classList.toggle("active", open);
}

function wireDrawers(): void {
  toggleFind.addEventListener("click", () => {
    const open = findDrawer.hidden;
    setDrawer(findDrawer, toggleFind, open);
  });
  toggleProposals.addEventListener("click", () => {
    const open = proposalsDrawer.hidden;
    setDrawer(proposalsDrawer, toggleProposals, open);
  });
  closeFind.addEventListener("click", () => setDrawer(findDrawer, toggleFind, false));
  closeProposals.addEventListener("click", () =>
    setDrawer(proposalsDrawer, toggleProposals, false)
  );
  clearFocusBtn.addEventListener("click", () => {
    selected = null;
    renderStage();
  });
}

function neighborLabel(nodes: KnowledgeNode[], id: string): string {
  return nodes.find((n) => n.id === id)?.label ?? id.slice(0, 8);
}

function renderNeighborhood(
  rootId: string,
  nodes: KnowledgeNode[],
  edges: Array<{ id: string; fromNodeId: string; relation: string; toNodeId: string }>
): void {
  neighborhood.hidden = false;
  neighborhoodList.innerHTML = "";
  const others = nodes.filter((n) => n.id !== rootId);
  for (const e of edges) {
    const otherId = e.fromNodeId === rootId ? e.toNodeId : e.fromNodeId;
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" class="object-btn" data-id="${escapeHtml(otherId)}">
      <span class="kind">${escapeHtml(e.relation)}</span>
      <span>${escapeHtml(neighborLabel(nodes, otherId))}</span>
    </button>`;
    neighborhoodList.appendChild(li);
  }
  for (const node of others) {
    if (edges.some((ed) => ed.fromNodeId === node.id || ed.toNodeId === node.id)) continue;
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" class="object-btn" data-id="${escapeHtml(node.id)}">
      <span class="kind">${escapeHtml(node.type)}</span>
      <span>${escapeHtml(node.label)}</span>
    </button>`;
    neighborhoodList.appendChild(li);
  }
  neighborhoodList.querySelectorAll("[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id) void openNode(id);
    });
  });
}

async function openNode(id: string): Promise<void> {
  const { node } = await getNode(id);
  selected = node;
  renderStage();
  try {
    const neigh = await getNeighborhood(id);
    renderNeighborhood(id, neigh.nodes as KnowledgeNode[], neigh.edges);
  } catch (err) {
    neighborhood.hidden = true;
    searchHint.textContent =
      err instanceof Error ? err.message : "Neighborhood unavailable";
  }
}

function renderSearch(nodes: KnowledgeNode[], emptyMsg: string): void {
  searchResults.innerHTML = "";
  if (nodes.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = emptyMsg;
    searchResults.appendChild(li);
    return;
  }
  for (const n of nodes) {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" class="object-btn" data-id="${escapeHtml(n.id)}">
      <span class="kind">${escapeHtml(n.type)} · ${escapeHtml(n.status)}</span>
      <span>${escapeHtml(n.label)}</span>
    </button>`;
    searchResults.appendChild(li);
  }
  searchResults.querySelectorAll("[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id) void openNode(id);
    });
  });
}

function proposalRows(p: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const kind = strField(p.kind);
  if (kind) rows.push(["kind", kind]);
  const type = strField(p.type);
  if (type) rows.push(["type", type]);
  const relation = strField(p.relation);
  if (relation) rows.push(["relation", relation]);
  const from = strField(p.from) || strField(p.fromNodeId);
  if (from) rows.push(["from", from]);
  const to = strField(p.to) || strField(p.toNodeId);
  if (to) rows.push(["to", to]);
  const eventId = strField(p.eventId);
  if (eventId) rows.push(["event", eventId]);
  const payload = asRecord(p.payload);
  const method = strField(asRecord(payload?.derivation)?.method);
  if (method) rows.push(["derivation", method]);
  return rows;
}

function renderProposals(items: Array<Record<string, unknown>>): void {
  proposalCount.textContent = `${items.length} pending`;
  proposalBadge.textContent = String(items.length);
  proposalList.innerHTML = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No pending proposals.";
    proposalList.appendChild(li);
    return;
  }
  for (const p of items) {
    const id = String(p.id ?? "");
    const kind = strField(p.kind) ?? "item";
    const label = strField(p.label) ?? id;
    const payload = asRecord(p.payload);
    const rows = proposalRows(p);
    const li = document.createElement("li");
    li.className = "proposal";
    li.innerHTML = `
      <div class="kind">${escapeHtml(kind)}</div>
      <div class="label">${escapeHtml(label)}</div>
      <p class="id muted">${escapeHtml(id)}</p>
      ${
        rows.length
          ? `<dl class="proposal-meta">${rows
              .map(
                ([k, v]) =>
                  `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`
              )
              .join("")}</dl>`
          : ""
      }
      ${
        payload
          ? `<details class="proposal-structure"><summary>Payload</summary><pre class="proposal-payload">${escapeHtml(
              JSON.stringify(payload, null, 2)
            )}</pre></details>`
          : ""
      }
      <div class="actions">
        <button type="button" data-act="accept" data-id="${escapeHtml(id)}">Accept</button>
        <button type="button" data-act="reject" data-id="${escapeHtml(id)}">Reject</button>
      </div>`;
    proposalList.appendChild(li);
  }
  proposalList.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const el = btn as HTMLElement;
      const act = el.dataset.act as "accept" | "reject";
      const id = el.dataset.id;
      if (!id) return;
      try {
        await resolveProposal(id, act);
        await refreshProposals();
        if (selected && act === "accept") await openNode(selected.id);
      } catch (err) {
        searchHint.textContent =
          err instanceof Error ? err.message : String(err);
      }
    });
  });
}

async function refreshProposals(): Promise<void> {
  try {
    let body = await listPendingProposals();
    if (!body.proposals?.length) {
      body = await listProposals(namespacedSessionId);
    }
    renderProposals(body.proposals || []);
  } catch {
    renderProposals([]);
  }
}

function renderWorkDone(done: ChatDone): void {
  setWorkPhase(done.error ? "error" : "complete", done.error);
  workReply.hidden = false;
  workReply.textContent = done.reply || done.error || "(empty)";
  workMeta.hidden = false;
  workMeta.innerHTML = "";
  const rows: Array<[string, string]> = [];
  if (done.model) rows.push(["model", done.model]);
  if (done.provider) rows.push(["provider", done.provider]);
  if (done.latencyMs != null) rows.push(["latency", `${done.latencyMs}ms`]);
  if (done.routing?.reason) rows.push(["route", done.routing.reason]);
  for (const [k, v] of rows) {
    workMeta.innerHTML += `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`;
  }
}

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!knowledgeReadOk) return;
  try {
    const body = await searchNodes(searchLabel.value, searchType.value || undefined);
    renderSearch(body.nodes, "No matches.");
  } catch (err) {
    searchHint.textContent = err instanceof Error ? err.message : String(err);
  }
});

workForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (workBusy) return;
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  workBusy = true;
  workBtn.disabled = true;
  setWorkPhase("running");
  workReply.hidden = true;
  workMeta.hidden = true;
  try {
    const done = await streamChat({
      prompt,
      sessionId: SESSION_ID,
      focus: currentFocus(),
      onEvent: (event, data) => {
        if (event === "token" && data && typeof data === "object") {
          const text = strField((data as { text?: unknown }).text);
          if (text) {
            workReply.hidden = false;
            workReply.textContent = text;
          }
        }
      },
    });
    renderWorkDone(done);
    promptEl.value = "";
    await refreshProposals();
  } catch (err) {
    setWorkPhase("error", err instanceof Error ? err.message : String(err));
    workReply.hidden = false;
    workReply.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    workBusy = false;
    workBtn.disabled = false;
  }
});

promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    workForm.requestSubmit();
  }
});

async function refreshStatus(): Promise<boolean> {
  try {
    await getHealth();
    const status = await getStatus();
    renderPresence(status, true);
    return true;
  } catch {
    renderPresence(null, false);
    return false;
  }
}

function listenEvents(): void {
  const run = async () => {
    try {
      await subscribeEvents({
        onEvent: (event) => {
          if (event === "presence" || event === "degraded") {
            void refreshStatus();
          }
          if (event === "turn.started") {
            workBusy = true;
            void refreshStatus();
          }
          if (event === "turn.completed" || event === "turn.failed") {
            workBusy = false;
            void refreshStatus();
          }
          if (event === "proposal.created") {
            void refreshProposals();
          }
          if (event === "error") {
            void refreshStatus();
          }
        },
      });
    } catch {
      /* reconnect below */
    }
    window.setTimeout(() => listenEvents(), 3000);
  };
  void run();
}

async function boot(): Promise<void> {
  wireDrawers();
  const live = await refreshStatus();
  if (!live) {
    systemLine.textContent = "System unreachable. Start orchestrator serve on :8787.";
    workStatus.textContent =
      "Orchestrator is not reachable at 127.0.0.1:8787. Run serve, then refresh.";
    workStatus.className = "error";
    return;
  }
  systemLine.textContent =
    "System is here. Same brain as CLI and voice — thin client of handle().";
  try {
    const session = await getSession(SESSION_ID);
    namespacedSessionId = session.sessionId;
  } catch {
    namespacedSessionId = SESSION_ID;
  }
  listenEvents();
  await refreshProposals();
  try {
    const body = await searchNodes("", "");
    knowledgeReadOk = true;
    searchHint.textContent = "Search to pull objects into the room.";
    renderSearch(body.nodes.slice(0, 12), "No accepted objects yet.");
  } catch {
    knowledgeReadOk = false;
    searchHint.textContent =
      "Knowledge maps need KNOWLEDGE_HTTP_READ=true on npm run serve.";
  }
}

void boot();
