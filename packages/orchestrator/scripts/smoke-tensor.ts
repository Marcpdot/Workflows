/** Orchestrator can build and ask a tensor store through the tool registry. */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTensorTools, runTensorSmoke } from "@workflows/knowledge";
import { MapToolRegistry } from "@workflows/tools";

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

async function main(): Promise<void> {
  await runTensorSmoke();

  const workspaceRoot = await mkdtemp(join(tmpdir(), "wf-tensor-"));
  await writeFile(
    join(workspaceRoot, "catalog.md"),
    "Catalog husker sourceId slik at kunnskap kan hentes tilbake."
  );
  await writeFile(
    join(workspaceRoot, "ultron.md"),
    "Ultron bygget en kropp av vibranium i Sokovia."
  );

  const registry = new MapToolRegistry();
  for (const tool of createTensorTools()) registry.register(tool);
  const names = new Set(registry.list().map((tool) => tool.name));
  assert(names.has("knowledge_tensor_build"), "missing knowledge_tensor_build");
  assert(names.has("knowledge_tensor_ask"), "missing knowledge_tensor_ask");

  const ctx = { workspaceRoot };
  const built = await registry.execute(
    "knowledge_tensor_build",
    { sourceDir: ".", storeDir: "store", rank: 2 },
    ctx
  );
  assert(built.ok, built.error ?? "tensor build failed");

  const asked = await registry.execute(
    "knowledge_tensor_ask",
    { query: "hente kunnskap fra catalog", storeDir: "store", limit: 2 },
    ctx
  );
  assert(asked.ok, asked.error ?? "tensor ask failed");
  const hits = (asked.data as { hits?: Array<{ sourcePath?: string; score: number }> }).hits ?? [];
  assert(hits[0]?.sourcePath?.endsWith("catalog.md"), "tool ask missed catalog.md, got " + hits[0]?.sourcePath);
  console.log("OK: orchestrator tool registry used tensor store");
  console.log(asked.output.split("\n").slice(0, 4).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
