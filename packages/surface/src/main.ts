import "./styles.css";
import {
  getHealth,
  getNeighborhood,
  getNode,
  getSession,
  getStatus,
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

let selected: KnowledgeNode | null = null;
let namespacedSessionId = SESSION_ID;
let knowledgeReadOk = true;
let workBusy = false;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    pill(
      status.busy || workBusy ? "busy" : "idle",
      status.busy || workBusy ? "warn" : "ok"
    ),
    pill(
      !status.knowledge.configured
        ? "knowledge off"
        : status.knowledge.ok
          ? `knowledge ${status.knowledge.backend ?? "up"}`
          : "knowledge down",
      !status.knowledge.configured
        ? "warn"
        : status.knowledge.ok
          ? "ok"
          : "down"
    ),
    pill(
      status.model.local.ok
        ? `local ${status.model.local.model}`
        : "local model down",
      status.model.local.ok ? "ok" : "down"
    ),
    pill(
      status.model.frontier.configured
        ? `frontier ${status.model.frontier.model}`
        : "frontier off",
      status.model.frontier.configured ? "ok" : "warn"
    ),
    pill(
      status.voice.enabled
        ? `voice ${status.voice.sttProvider}`
        : "voice off",
      status.voice.enabled ? "ok" : "warn"
    ),
  ];
  presencePills.innerHTML = parts.join("");
}

function currentFocus(): ChatFocus | undefined {
  if (!selected) return undefined;
  const focus: ChatFocus = {
    knowledgeId: selected.id,
    nodeIds: [selected.id],
    labels: selected.label ? [selected.label] : undefined,
    hops: 1,
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
    stageObject.hidden = true;
    neighborhood.hidden = true;
    renderFocusHint();
    return;
  }
  stageEmpty.hidden = true;
  stageObject.hidden = false;
  stageObject.innerHTML = `
    <div class="kind">${escapeHtml(selected.type)} · ${escapeHtml(selected.status)}</div>
    <h3>${escapeHtml(selected.label)}</h3>
    <p class="id muted">${escapeHtml(selected.id)}</p>
    ${
      selected.description
        ? `<p>${escapeHtml(selected.description)}</p>`
        : ""
    }
    <button type="button" class="linkish" id="clearStage">Clear stage</button>
  `;
  $("clearStage").addEventListener("click", () => {
    selected = null;
    renderStage();
  });
  renderFocusHint();
}

function neighborLabel(
  nodes: KnowledgeNode[],
  id: string
): string {
  return nodes.find((n) => n.id === id)?.label ?? id.slice(0, 8);
}

function renderNeighborhood(
  rootId: string,
  nodes: KnowledgeNode[],
  edges: Array<{ fromNodeId: string; relation: string; toNodeId: string }>
): void {
  const others = nodes.filter((n) => n.id !== rootId);
  if (others.length === 0 && edges.length === 0) {
    neighborhood.hidden = true;
    return;
  }
  neighborhood.hidden = false;
  neighborhoodList.innerHTML = "";
  for (const edge of edges) {
    const otherId = edge.fromNodeId === rootId ? edge.toNodeId : edge.fromNodeId;
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" class="object-btn" data-id="${escapeHtml(otherId)}">
      <span class="kind">${escapeHtml(edge.relation)}</span>
      <span>${escapeHtml(neighborLabel(nodes, otherId))}</span>
    </button>`;
    neighborhoodList.appendChild(li);
  }
  for (const node of others) {
    if (edges.some((e) => e.fromNodeId === node.id || e.toNodeId === node.id)) {
      continue;
    }
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" class="object-btn" data-id="${escapeHtml(node.id)}">
      <span class="kind">${escapeHtml(node.type)}</span>
      <span>${escapeHtml(node.label)}</span>
    </button>`;
    neighborhoodList.appendChild(li);
  }
}

async function openNode(id: string): Promise<void> {
  const { node } = await getNode(id);
  selected = node;
  renderStage();
  try {
    const neigh = await getNeighborhood(id);
    renderNeighborhood(id, neigh.nodes, neigh.edges);
  } catch (err) {
    neighborhood.hidden = true;
    searchHint.textContent =
      err instanceof Error ? err.message : "Neighborhood unavailable";
  }
}

function renderSearch(
  nodes: KnowledgeNode[],
  emptyMessage: string
): void {
  searchResults.innerHTML = "";
  if (nodes.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = emptyMessage;
    searchResults.appendChild(li);
    return;
  }
  for (const node of nodes) {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" class="object-btn" data-id="${escapeHtml(node.id)}">
      <span class="kind">${escapeHtml(node.type)}</span>
      <span>${escapeHtml(node.label)}</span>
    </button>`;
    searchResults.appendChild(li);
  }
}

function proposalLabel(p: Record<string, unknown>): string {
  if (typeof p.label === "string" && p.label.trim()) return p.label;
  const payload = p.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload.label === "string") return payload.label;
  if (payload && typeof payload.relation === "string") {
    return `${payload.relation}`;
  }
  return String(p.id ?? "proposal");
}

function renderProposals(items: Array<Record<string, unknown>>): void {
  proposalCount.textContent = `${items.length} pending`;
  proposalList.innerHTML = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No pending proposals for this session.";
    proposalList.appendChild(li);
    return;
  }
  for (const p of items) {
    const id = String(p.id ?? "");
    const kind = String(p.kind ?? payloadKind(p));
    const li = document.createElement("li");
    li.className = "proposal";
    li.innerHTML = `
      <div class="kind">${escapeHtml(kind)}</div>
      <div class="label">${escapeHtml(proposalLabel(p))}</div>
      <div class="id muted">${escapeHtml(id)}</div>
      <div class="actions">
        <button type="button" data-act="accept" data-id="${escapeHtml(id)}">Accept</button>
        <button type="button" data-act="reject" data-id="${escapeHtml(id)}">Reject</button>
      </div>
    `;
    proposalList.appendChild(li);
  }
}

function payloadKind(p: Record<string, unknown>): string {
  const payload = p.payload as Record<string, unknown> | undefined;
  return typeof payload?.type === "string" ? payload.type : "item";
}

async function refreshProposals(): Promise<void> {
  try {
    const body = await listProposals(namespacedSessionId);
    renderProposals(body.proposals ?? []);
  } catch {
    try {
      const body = await listProposals(SESSION_ID);
      renderProposals(body.proposals ?? []);
    } catch (err) {
      proposalList.innerHTML = `<li class="muted">${escapeHtml(
        err instanceof Error ? err.message : "Proposals unavailable"
      )}</li>`;
    }
  }
}

function setWorkPhase(phase: WorkPhase, detail?: string): void {
  const labels: Record<WorkPhase, string> = {
    idle: "Idle. The system is a client of handle().",
    accepted: "Turn accepted…",
    running: "Working…",
    complete: "Done.",
    error: "Error.",
  };
  workStatus.textContent = detail ? `${labels[phase]} ${detail}` : labels[phase];
  workStatus.className = phase === "error" ? "error" : "muted";
}

function renderWorkDone(done: ChatDone): void {
  setWorkPhase("complete", done.latencyMs != null ? `${done.latencyMs} ms` : "");
  workReply.hidden = false;
  workReply.textContent = done.reply || "(empty reply)";
  const rows: Array<[string, string]> = [];
  if (done.model) rows.push(["model", done.model]);
  if (done.provider) rows.push(["provider", done.provider]);
  if (done.routing?.reason) rows.push(["route", done.routing.reason]);
  if (done.sessionId) {
    namespacedSessionId = done.sessionId;
    rows.push(["session", done.sessionId]);
  }
  if (rows.length === 0) {
    workMeta.hidden = true;
    return;
  }
  workMeta.hidden = false;
  workMeta.innerHTML = rows
    .map(
      ([k, v]) =>
        `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`
    )
    .join("");
}

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!knowledgeReadOk) {
    searchHint.textContent =
      "Knowledge read is off. Start serve with KNOWLEDGE_HTTP_READ=true.";
    return;
  }
  searchHint.textContent = "Searching…";
  try {
    const body = await searchNodes(searchLabel.value, searchType.value);
    knowledgeReadOk = true;
    searchHint.textContent = `${body.count} accepted object${body.count === 1 ? "" : "s"}`;
    renderSearch(body.nodes ?? [], "No accepted objects match.");
  } catch (err) {
    knowledgeReadOk = false;
    searchHint.textContent =
      err instanceof Error
        ? err.message
        : "Search failed. Is KNOWLEDGE_HTTP_READ=true?";
    renderSearch([], "");
  }
});

searchResults.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-id]");
  const id = btn?.getAttribute("data-id");
  if (id) void openNode(id).catch((err) => {
    searchHint.textContent = err instanceof Error ? err.message : String(err);
  });
});

neighborhoodList.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-id]");
  const id = btn?.getAttribute("data-id");
  if (id) void openNode(id).catch((err) => {
    searchHint.textContent = err instanceof Error ? err.message : String(err);
  });
});

proposalList.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-act]");
  if (!btn) return;
  const id = btn.getAttribute("data-id");
  const act = btn.getAttribute("data-act");
  if (!id || (act !== "accept" && act !== "reject")) return;
  btn.setAttribute("disabled", "true");
  try {
    await resolveProposal(id, act);
    await refreshProposals();
    if (selected && act === "accept") await openNode(selected.id);
  } catch (err) {
    searchHint.textContent = err instanceof Error ? err.message : String(err);
  }
});

workForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = promptEl.value.trim();
  if (!prompt || workBusy) return;
  workBusy = true;
  workBtn.disabled = true;
  workReply.hidden = true;
  workMeta.hidden = true;
  setWorkPhase("accepted");
  try {
    const done = await streamChat(prompt, currentFocus(), (event, data) => {
      if (event === "status" && data && typeof data === "object") {
        const phase = (data as { phase?: string }).phase;
        if (phase === "accepted" || phase === "running" || phase === "complete") {
          setWorkPhase(phase);
        }
      }
      if (event === "token" && data && typeof data === "object") {
        const text = (data as { text?: string }).text;
        if (text) {
          workReply.hidden = false;
          workReply.textContent = text;
        }
      }
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
  const live = await refreshStatus();
  if (!live) {
    workStatus.textContent =
      "Orchestrator is not reachable at 127.0.0.1:8787. Run serve, then refresh.";
    workStatus.className = "error";
    return;
  }
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
