/* M6 web shell — talks only to same-origin /health and /v1/chat */

const $ = (id) => document.getElementById(id);

const healthEl = $("health");
const logEl = $("log");
const form = $("form");
const promptEl = $("prompt");
const sendBtn = $("send");
const sessionEl = $("sessionId");
const workspaceEl = $("workspace");
const toolsEl = $("toolsEnabled");
const metaEl = $("meta");

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
    ["reason", data.routing?.reason ?? "—"],
    ["latency", data.latencyMs != null ? `${data.latencyMs} ms` : "—"],
    [
      "compression",
      data.compression
        ? data.compression.compressed
          ? "yes"
          : "no"
        : "—",
    ],
    [
      "tools",
      data.toolSteps?.length
        ? data.toolSteps
            .map((s) => `${s.call?.name ?? "?"} ${s.result?.ok ? "ok" : "fail"}`)
            .join(", ")
        : "—",
    ],
    ["session", data.sessionId ?? "—"],
    ["workspace", data.workspaceRoot ?? "—"],
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

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = promptEl.value.trim();
  if (!prompt) return;

  appendBubble("user", prompt);
  promptEl.value = "";
  sendBtn.disabled = true;

  const payload = {
    prompt,
    sessionId: sessionEl.value.trim() || "ui-default",
    options: {
      toolsEnabled: toolsEl.checked,
    },
  };
  const ws = workspaceEl.value.trim();
  if (ws) payload.workspaceRoot = ws;

  try {
    const res = await fetch("/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    appendBubble("assistant", data.reply || "(empty reply)");
    renderMeta(data);
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

refreshHealth();
setInterval(refreshHealth, 15000);
