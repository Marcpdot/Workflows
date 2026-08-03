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
/** @type {Array<{id:string,kind:string,label:string}>} */
let lastProposals = [];

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
  lastProposals = Array.isArray(list) ? list : [];
  const n =
    totalPending != null ? totalPending : lastProposals.length;
  pendingCountEl.textContent = `${n} pending`;
  btnAcceptAll.disabled = lastProposals.length === 0;

  if (lastProposals.length === 0) {
    proposalsList.innerHTML =
      '<div class="meta-empty">No new proposals this turn. Pending may still exist in the DB — use /knowledge proposals in CLI or capture more.</div>';
    return;
  }

  proposalsList.innerHTML = "";
  for (const p of lastProposals) {
    const card = document.createElement("div");
    card.className = "proposal-card";
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="kind">${escapeHtml(p.kind || "?")}</div>
      <div class="label">${escapeHtml(p.label || p.id)}</div>
      <div class="actions">
        <button type="button" class="accept" data-act="accept">Accept</button>
        <button type="button" class="reject" data-act="reject">Reject</button>
      </div>
    `;
    proposalsList.appendChild(card);
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
    renderMeta(data);
    if (data.interactionMode) setModeUi(data.interactionMode);
    renderProposals(data.proposals || [], data.pendingProposalCount);
  } catch (err) {
    appendBubble("assistant", err.message || String(err), true);
  }
});

btnRefreshProposals.addEventListener("click", () => {
  renderProposals(lastProposals, lastProposals.length);
});

btnAcceptAll.addEventListener("click", async () => {
  if (!lastProposals.length) return;
  const ids = lastProposals.map((p) => p.id).join(" ");
  try {
    const data = await chat(`/accept ${ids}`);
    appendBubble("assistant", data.reply || "accepted");
    renderProposals([], data.pendingProposalCount ?? 0);
    renderMeta(data);
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
    lastProposals = lastProposals.filter((p) => p.id !== id);
    renderProposals(lastProposals, data.pendingProposalCount);
    renderMeta(data);
  } catch (err) {
    appendBubble("assistant", err.message || String(err), true);
  }
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
    if (data.command) {
      appendBubble("assistant", data.reply || "(ok)");
    } else {
      appendBubble("assistant", data.reply || "(empty reply)");
    }
    if (data.interactionMode) setModeUi(data.interactionMode);
    if (data.proposalsEnabled === false) proposalsEnabledEl.checked = false;
    if (data.proposalsEnabled === true) proposalsEnabledEl.checked = true;
    renderMeta(data);
    renderProposals(data.proposals || [], data.pendingProposalCount);
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

// Sync mode from server on load
(async () => {
  try {
    const data = await chat("/mode");
    if (data.interactionMode) setModeUi(data.interactionMode);
    else if (typeof data.reply === "string" && data.reply.includes("neutral")) {
      setModeUi("neutral");
    }
    renderMeta(data);
  } catch {
    /* offline until server up */
  }
})();

refreshHealth();
setInterval(refreshHealth, 15000);
