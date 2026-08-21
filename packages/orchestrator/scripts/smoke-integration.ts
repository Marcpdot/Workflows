/**
 * Smoke for Milestone 5 integration contract (CLI JSON + workspace + HTTP health).
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { listenIntegrationServer } from "../src/integration/index.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function runCli(args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    // Invoke tsx via node (avoids Windows spawn EINVAL on npx.cmd)
    const tsxCli = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
    const child = spawn(
      process.execPath,
      [tsxCli, "src/index.ts", ...args],
      {
        cwd: resolve(process.cwd()),
        env: { ...process.env },
        windowsHide: true,
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function main(): Promise<void> {
  // 1. --json --route-only → parseable pure JSON
  const route = await runCli([
    "--json",
    "--route-only",
    "Oppsummer denne teksten kort",
  ]);
  assert(route.code === 0, `route-only exit ${route.code}: ${route.stderr}`);
  const trimmed = route.stdout.trim();
  assert(trimmed.startsWith("{"), "stdout must be pure JSON object");
  const routing = JSON.parse(trimmed) as { model?: string };
  assert(routing.model === "local", `expected local, got ${routing.model}`);
  console.log("OK: --json --route-only pure JSON");

  // 2. --workspace binds tools
  const tmp = resolve(process.cwd(), "data", `_m5_ws_${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "marker.txt"), "workspace-marker\n", "utf8");

  try {
    const listed = await runCli([
      "--json",
      "--workspace",
      tmp,
      "--tool",
      "run",
      "list_dir",
      "path=.",
    ]);
    assert(listed.code === 0, `list_dir failed: ${listed.stderr}\n${listed.stdout}`);
    assert(
      listed.stdout.includes("marker.txt"),
      "workspace list_dir should see marker.txt"
    );

    const escape = await runCli([
      "--json",
      "--workspace",
      tmp,
      "--tool",
      "run",
      "read_file",
      "path=../package.json",
    ]);
    assert(escape.code !== 0, "escape should non-zero exit");
    const errText = `${escape.stdout}\n${escape.stderr}`.toLowerCase();
    assert(
      errText.includes("escape") || errText.includes("ok"),
      "escape should report error"
    );
    console.log("OK: --workspace binds tools");
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  // 3. HTTP /health
  const { server, url } = await listenIntegrationServer({
    host: "127.0.0.1",
    port: 18787,
  });
  try {
    const res = await fetch(`${url}/health`);
    const body = (await res.json()) as { ok?: boolean; service?: string };
    assert(res.status === 200 && body.ok === true, "health ok");
    assert(body.service === "orchestrator", "service name");
    console.log(`OK: HTTP GET /health (${url})`);

    const miss = await fetch(`${url}/nope`);
    assert(miss.status === 404, "404 unknown path");
    console.log("OK: HTTP 404");

    const statusRes = await fetch(`${url}/v1/status`);
    const statusBody = (await statusRes.json()) as {
      ok?: boolean;
      busy?: boolean;
      degraded?: boolean;
      knowledge?: { configured?: boolean; ok?: boolean };
      model?: { local?: { model?: string }; frontier?: { configured?: boolean } };
      voice?: { enabled?: boolean; sttProvider?: string };
    };
    assert(statusRes.status === 200 && statusBody.ok === true, "status ok");
    assert(typeof statusBody.busy === "boolean", "status busy flag");
    assert(typeof statusBody.degraded === "boolean", "status degraded flag");
    assert(statusBody.knowledge != null, "status knowledge probe");
    assert(statusBody.model?.local?.model, "status local model");
    assert(typeof statusBody.voice?.enabled === "boolean", "status voice flags");
    console.log(
      `OK: HTTP GET /v1/status busy=${statusBody.busy} degraded=${statusBody.degraded}`
    );

    const sessionName = `m5-surface-${Date.now()}`;
    const modeRes = await fetch(`${url}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "/mode",
        sessionId: sessionName,
        focus: { labels: ["heat"], hops: 1 },
        options: { toolsEnabled: false },
      }),
    });
    const modeBody = (await modeRes.json()) as {
      reply?: string;
      command?: boolean;
      sessionId?: string;
      focus?: { labels?: string[] };
    };
    assert(modeRes.status === 200, `chat /mode status ${modeRes.status}`);
    assert(modeBody.command === true, "slash command handled without model");
    assert(
      typeof modeBody.reply === "string" && modeBody.reply.includes("mode="),
      "mode reply"
    );
    assert(
      modeBody.focus?.labels?.[0] === "heat",
      "focus echoed without breaking existing clients"
    );
    console.log("OK: POST /v1/chat focus + slash command");

    const sessRes = await fetch(
      `${url}/v1/session?sessionId=${encodeURIComponent(sessionName)}`
    );
    const sessBody = (await sessRes.json()) as {
      ok?: boolean;
      exists?: boolean;
      historyCount?: number;
      interactionMode?: string;
      sessionId?: string;
      messages?: unknown;
      history?: unknown;
    };
    assert(sessRes.status === 200 && sessBody.ok === true, "session metadata");
    assert(sessBody.exists === true, "session exists after /mode");
    assert((sessBody.historyCount ?? 0) >= 2, "historyCount without transcript");
    assert(sessBody.interactionMode === "active", "session mode");
    assert(sessBody.messages == null && sessBody.history == null, "no transcript dump");
    console.log("OK: GET /v1/session metadata only");

    const missingSess = await fetch(`${url}/v1/session`);
    assert(missingSess.status === 400, "session without id → 400");

    const streamRes = await fetch(`${url}/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        prompt: "/mode",
        sessionId: `${sessionName}-stream`,
        stream: true,
        options: { toolsEnabled: false },
      }),
    });
    assert(streamRes.status === 200, `stream status ${streamRes.status}`);
    assert(
      (streamRes.headers.get("content-type") ?? "").includes("text/event-stream"),
      "chat SSE content-type"
    );
    const streamText = await streamRes.text();
    assert(streamText.includes("event: status"), "stream status event");
    assert(streamText.includes("event: token"), "stream token event");
    assert(streamText.includes("event: done"), "stream done event");
    const doneLine = streamText
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .find((line) => line.includes('"command":true'));
    assert(doneLine, "done payload matches non-stream command shape");
    const doneBody = JSON.parse(doneLine!) as { reply?: string; command?: boolean };
    assert(doneBody.command === true && (doneBody.reply ?? "").includes("mode="), "done == chat result");
    console.log("OK: POST /v1/chat SSE token/status/done");

    const eventsAbort = new AbortController();
    const eventsRes = await fetch(`${url}/v1/events`, {
      signal: eventsAbort.signal,
    });
    assert(eventsRes.status === 200, "events status");
    assert(
      (eventsRes.headers.get("content-type") ?? "").includes("text/event-stream"),
      "events SSE content-type"
    );
    const reader = eventsRes.body?.getReader();
    assert(!!reader, "events body");
    const decoder = new TextDecoder();
    let eventsBuf = "";
    const deadline = Date.now() + 8_000;
    const chatTurn = fetch(`${url}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "/mode",
        sessionId: `${sessionName}-events`,
        options: { toolsEnabled: false },
      }),
    });
    while (Date.now() < deadline) {
      const { value, done } = await reader!.read();
      if (done) break;
      eventsBuf += decoder.decode(value, { stream: true });
      if (
        eventsBuf.includes("event: presence") &&
        eventsBuf.includes("event: turn.started") &&
        eventsBuf.includes("event: turn.completed")
      ) {
        break;
      }
    }
    await chatTurn;
    eventsAbort.abort();
    try {
      await reader!.cancel();
    } catch {
      /* ignore */
    }
    assert(eventsBuf.includes("event: presence"), "events presence");
    assert(eventsBuf.includes("event: turn.started"), "events turn.started");
    assert(eventsBuf.includes("event: turn.completed"), "events turn.completed");
    console.log("OK: GET /v1/events presence + turn.*");

    const gated = await listenIntegrationServer({
      host: "127.0.0.1",
      port: 18786,
      token: "surface-token",
    });
    try {
      const denied = await fetch(`${gated.url}/v1/status`);
      assert(denied.status === 401, "status requires token");
      const allowed = await fetch(`${gated.url}/v1/status`, {
        headers: { Authorization: "Bearer surface-token" },
      });
      assert(allowed.status === 200, "status accepts bearer token");
      console.log("OK: INTEGRATION_HTTP_TOKEN gate on /v1/status");
    } finally {
      await new Promise<void>((r) => gated.server.close(() => r()));
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }

  assert(
    existsSync(resolve(process.cwd(), "src/integration/contract.md")),
    "contract.md missing"
  );
  assert(
    existsSync(resolve(process.cwd(), "src/integration/surface-contract.md")),
    "surface-contract.md missing"
  );
  console.log("OK: contract.md present");

  console.log("All integration smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
