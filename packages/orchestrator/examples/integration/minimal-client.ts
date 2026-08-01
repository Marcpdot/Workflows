/**
 * Minimal TypeScript client for M5 integration surface.
 * Run from Orchestrator package (or adjust ORCHESTRATOR_URL):
 *
 *   npx tsx examples/integration/minimal-client.ts "prompt"
 *   # server: npm run serve
 */

const base = process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:8787";
const workspace = process.env.WORKSPACE_ROOT ?? process.cwd();
const prompt = process.argv.slice(2).join(" ") || "Say hi in one sentence.";

async function main(): Promise<void> {
  const health = await fetch(`${base}/health`);
  const healthBody = (await health.json()) as { ok?: boolean };
  if (!health.ok || !healthBody.ok) {
    throw new Error(`health failed: ${health.status}`);
  }
  console.error("health ok");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.INTEGRATION_HTTP_TOKEN) {
    headers.Authorization = `Bearer ${process.env.INTEGRATION_HTTP_TOKEN}`;
  }

  const res = await fetch(`${base}/v1/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt,
      workspaceRoot: workspace,
      sessionId: "minimal-client",
      options: { toolsEnabled: false },
    }),
  });

  const body = (await res.json()) as {
    reply?: string;
    error?: string;
    latencyMs?: number;
  };
  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  // Machine-friendly: print reply only on stdout
  console.log(body.reply ?? "");
  console.error(`latencyMs=${body.latencyMs ?? "?"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
