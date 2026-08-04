/* Web shell — chat + interaction mode + proposals panel */

const $ = (id) => document.getElementById(id);

const healthEl = $("health");
const logEl = $("log");
const form = $("form");
const promptEl = $("prompt");
const sendBtn = $("send");
const sessionEl = $("sessionId");
const workspaceEl = $("workspace");
const toolsEl = $("toolsEnabled");
const proposalsEnabledEl = $("proposalsEnabled");
const metaEl = $("meta");
const modeToggle = $("modeToggle");
const proposalsList = $("proposalsList");
const pendingCountEl = $("pendingCount");
const btnCapture = $("btnCapture");
const btnRefreshProposals = $("btnRefreshProposals");
const btnAcceptAll = $("btnAcceptAll");

/** @type {"active"|"neutral"} */
let interactionMode = "active";
/** @type {Array<{id:string,kind:string,label:string,relation?:string,sourceRef?:string,limitKind?:string}>} */
let queueProposals = [];
/** @type {"idle"|"loading"|"error"} */
let queueStatus = "idle";
let queueError = "";

/** @type {string|null} */
let lastServerSessionId = null;

function appendBubble(role, text, isError) {
  const div = document.createElement("div");
  div.className = `bubble ${isError ? "error" : role}`;
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = isError ? "error" : role;
  const body = document.createElement("div");
  body.textContent = text;
  div.appendChild(who);
  div.appendChild(body);
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function setModeUi(mode) {
  interactionMode = mode === "neutral" ? "neutral" : "active";
  modeToggle.textContent = `mode: ${interactionMode}`;
  modeToggle.className =
    "mode-btn " + (interactionMode === "active" ? "active" : "neutral");
}

function renderMeta(data) {
  if (!data) {
    metaEl.innerHTML =
      '<div class="meta-empty">Send a message to see route / model / latency.</div>';
    return;
  }

  const rows = [
    ["provider", data.provider ?? "—"],
    ["model", data.model ?? "—"],
    ["route", data.routing?.model ?? "—"],
    ["mode", data.interactionMode ?? interactionMode],
    ["proposals", data.proposalsEnabled === false ? "off" : "on"],
    ["pending", data.pendingProposalCount ?? "—"],
    ["latency", data.latencyMs != null ? `${data.latencyMs} ms` : "—"],
    [
      "tools",
      data.toolSteps?.length
        ? data.toolSteps
            .map((s) => `${s.call?.name ?? "?"} ${s.result?.ok ? "ok" : "fail"}`)
            .join(", ")
        : "—",
    ],
    ["session", data.sessionId ?? "—"],
  ];

  let html = "<dl>";
  for (const [k, v] of rows) {
    html += `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`;
  }
  html += "</dl>";

  if (data.suggestions?.length) {
    html += '<div class="suggestions"><strong>Next</strong><ul>';
    for (const s of data.suggestions) {
      html += `<li>${escapeHtml(s.text || "")}</li>`;
    }
    html += "</ul></div>";
  }

  metaEl.innerHTML = html;
}

function renderProposals(list, totalPending) {
  if (Array.isArray(list)) queueProposals = list;
  const n =
    totalPending != null ? totalPending : queueProposals.length;
  pendingCountEl.textContent = `${n} pending`;
  btnAcceptAll.disabled = queueProposals.length === 0;

  if (queueStatus === "loading") {
    proposalsList.innerHTML =
      '<div class="meta-empty">Loading session queue…</div>';
    return;
  }
  if (queueStatus === "error") {
    proposalsList.innerHTML = `<div class="meta-empty" style="color:var(--error)">Failed to load: ${escapeHtml(queueError)}</div>`;
    return;
  }
  if (queueProposals.length === 0) {
    proposalsList.innerHTML =
      '<div class="meta-empty">No pending proposals for this session. Reason freely in active mode, or use Capture.</div>';
    return;
  }

  proposalsList.innerHTML = "";
  for (const p of queueProposals) {
    const card = document.createElement("div");
    card.className = "proposal-card";
    card.dataset.id = p.id;
    const metaBits = [
      p.kind || "?",
      p.relation ? `rel=${p.relation}` : null,
      p.limitKind ? `limit=${p.limitKind}` : null,
      p.sourceRef ? p.sourceRef.replace(/^conversation:[^#]+/, "session") : null,
    ]
      .filter(Boolean)
      .join(" · ");
    card.innerHTML = `
      <div class="kind">${escapeHtml(metaBits)}</div>
      <div class="label">${escapeHtml(p.label || p.id)}</div>
      <div class="actions">
        <button type="button" class="accept" data-act="accept">Accept</button>
        <button type="button" class="reject" data-act="reject">Reject</button>
      </div>
    `;
    proposalsList.appendChild(card);
  }
}

/** Full session queue from knowledge store (not only last turn). */
async function refreshSessionQueue() {
  queueStatus = "loading";
  renderProposals(queueProposals);
  try {
    // Prefer server namespaced session id when known (ws:…:logical)
    const sid = lastServerSessionId || sessionEl.value.trim() || "ui-default";
    const res = await fetch(
      `/v1/knowledge/proposals?sessionId=${encodeURIComponent(sid)}`
    );
    if (!res.ok) {
      // Fallback: try logical id only if we used namespaced and failed
      if (lastServerSessionId) {
        const res2 = await fetch(
          `/v1/knowledge/proposals?sessionId=${encodeURIComponent(sessionEl.value.trim() || "ui-default")}`
        );
        if (res2.ok) {
          const body2 = await res2.json();
          queueStatus = "idle";
          queueError = "";
          renderProposals(body2.proposals || [], body2.count);
          return;
        }
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const body = await res.json();
    queueStatus = "idle";
    queueError = "";
    renderProposals(body.proposals || [], body.count);
  } catch (err) {
    queueStatus = "error";
    queueError = err instanceof Error ? err.message : String(err);
    renderProposals(queueProposals);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function chat(prompt) {
  const payload = {
    prompt,
    sessionId: sessionEl.value.trim() || "ui-default",
    options: {
      toolsEnabled: toolsEl.checked,
    },
  };
  const ws = workspaceEl.value.trim();
  if (ws) payload.workspaceRoot = ws;

  const res = await fetch("/v1/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function refreshHealth() {
  try {
    const res = await fetch("/health");
    const body = await res.json();
    if (res.ok && body.ok) {
      healthEl.textContent = `ok · v${body.version ?? "?"}`;
      healthEl.className = "status ok";
    } else {
      throw new Error(body.error || res.statusText);
    }
  } catch (err) {
    healthEl.textContent = `down · ${err.message || err}`;
    healthEl.className = "status bad";
  }
}

modeToggle.addEventListener("click", async () => {
  const next = interactionMode === "active" ? "neutral" : "active";
  try {
    const data = await chat(`/mode ${next}`);
    if (data.interactionMode) setModeUi(data.interactionMode);
    else setModeUi(next);
    appendBubble("assistant", data.reply || `mode → ${next}`);
    renderMeta(data);
  } catch (err) {
    appendBubble("assistant", err.message || String(err), true);
  }
});

proposalsEnabledEl.addEventListener("change", async () => {
  const next = proposalsEnabledEl.checked ? "on" : "off";
  try {
    const data = await chat(`/proposals ${next}`);
    appendBubble("assistant", data.reply || `proposals → ${next}`);
    renderMeta(data);
  } catch (err) {
    appendBubble("assistant", err.message || String(err), true);
  }
});

btnCapture.addEventListener("click", async () => {
  try {
    const data = await chat("/capture");
    appendBubble("assistant", data.reply || "(capture)");
    if (data.sessionId) lastServerSessionId = data.sessionId;
    renderMeta(data);
    if (data.interactionMode) setModeUi(data.interactionMode);
    await refreshSessionQueue();
  } catch (err) {
    appendBubble("assistant", err.message || String(err), true);
  }
});

btnRefreshProposals.addEventListener("click", () => {
  refreshSessionQueue();
});

btnAcceptAll.addEventListener("click", async () => {
  if (!queueProposals.length) return;
  const ids = queueProposals.map((p) => p.id).join(" ");
  try {
    const data = await chat(`/accept ${ids}`);
    appendBubble("assistant", data.reply || "accepted");
    if (data.sessionId) lastServerSessionId = data.sessionId;
    renderMeta(data);
    await refreshSessionQueue();
  } catch (err) {
    appendBubble("assistant", err.message || String(err), true);
  }
});

proposalsList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const card = btn.closest(".proposal-card");
  const id = card?.dataset?.id;
  if (!id) return;
  const act = btn.getAttribute("data-act");
  try {
    const data = await chat(`/${act} ${id}`);
    appendBubble("assistant", data.reply || `${act} ${id}`);
    if (data.sessionId) lastServerSessionId = data.sessionId;
    renderMeta(data);
    await refreshSessionQueue();
  } catch (err) {
    appendBubble("assistant", err.message || String(err), true);
  }
});

sessionEl.addEventListener("change", () => {
  lastServerSessionId = null;
  refreshSessionQueue();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = promptEl.value.trim();
  if (!prompt) return;

  appendBubble("user", prompt);
  promptEl.value = "";
  sendBtn.disabled = true;

  try {
    const data = await chat(prompt);
    if (data.sessionId) lastServerSessionId = data.sessionId;
    if (data.command) {
      appendBubble("assistant", data.reply || "(ok)");
    } else {
      appendBubble("assistant", data.reply || "(empty reply)");
    }
    if (data.interactionMode) setModeUi(data.interactionMode);
    if (data.proposalsEnabled === false) proposalsEnabledEl.checked = false;
    if (data.proposalsEnabled === true) proposalsEnabledEl.checked = true;
    renderMeta(data);
    // Prefer full session queue over last-turn only
    await refreshSessionQueue();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendBubble("assistant", msg, true);
    renderMeta(null);
  } finally {
    sendBtn.disabled = false;
    promptEl.focus();
  }
});

promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

// Sync mode + queue from server on load
(async () => {
  try {
    const data = await chat("/mode");
    if (data.sessionId) lastServerSessionId = data.sessionId;
    if (data.interactionMode) setModeUi(data.interactionMode);
    else if (typeof data.reply === "string" && data.reply.includes("neutral")) {
      setModeUi("neutral");
    }
    renderMeta(data);
    await refreshSessionQueue();
  } catch {
    /* offline until server up */
  }
})();

refreshHealth();
setInterval(refreshHealth, 15000);
