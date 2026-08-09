import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Neo4jGraphConfig } from "@workflows/knowledge";

const DEFAULT_DOCKER = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";

function run(executable: string, args: string[], dockerConfig: string): string {
  return execFileSync(executable, args, { encoding: "utf8", env: { ...process.env, DOCKER_CONFIG: dockerConfig }, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export async function startKnowledgeNeo4jTest(): Promise<{ config: Neo4jGraphConfig; dispose(): Promise<void> }> {
  const executable = process.env.KNOWLEDGE_DOCKER_EXE?.trim() || DEFAULT_DOCKER;
  const name = `workflows-neo4j-${randomUUID().replaceAll("-", "")}`;
  const dockerConfig = join(tmpdir(), `${name}-docker-config`); mkdirSync(dockerConfig, { recursive: true });
  let started = false;
  try {
    run(executable, ["run", "--detach", "--rm", "--name", name, "--env", "NEO4J_AUTH=neo4j/fixture-password", "--publish", "127.0.0.1::7687", "neo4j:5.26-community"], dockerConfig);
    started = true;
    let port = "";
    for (let attempt = 0; attempt < 30 && !port; attempt++) {
      try { const output = run(executable, ["port", name, "7687/tcp"], dockerConfig); port = /:(\d+)\s*$/.exec(output)?.[1] ?? ""; } catch { /* container is starting */ }
      if (!port) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!port) throw new Error("Neo4j test container did not publish a Bolt port");
    return {
      config: { uri: `bolt://127.0.0.1:${port}`, username: "neo4j", password: "fixture-password", database: "neo4j" },
      async dispose() {
        try { run(executable, ["rm", "--force", name], dockerConfig); } finally { rmSync(dockerConfig, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    if (started) try { run(executable, ["rm", "--force", name], dockerConfig); } catch { /* best effort */ }
    rmSync(dockerConfig, { recursive: true, force: true }); throw error;
  }
}
