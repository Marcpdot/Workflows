/**
 * Offline smoke for Milestone 13 project & workspace binding (no live model).
 */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyExtractionResult,
  buildKnowledgeInjectBlock,
  createKnowledgeStore,
  createKnowledgeTools,
  type ExtractionResult,
} from "@workflows/knowledge";
import { MapToolRegistry } from "@workflows/tools";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const dbPath = resolve(
    process.cwd(),
    "data",
    `_smoke_knowledge_projects_${Date.now()}.db`
  );

  const store = createKnowledgeStore({
    dbPath,
    defaultWorkspaceId: "ws-test",
  });

  try {
    // 1. ensure project
    const project = await store.ensureProject({
      label: "aktuator-v2",
      createAccepted: true,
      workspaceId: "ws-test",
    });
    assert(project.type === "project", "type project");
    assert(project.status === "accepted", "project accepted");
    assert(project.workspaceId === "ws-test", "project workspaceId");
    // idempotent
    const again = await store.ensureProject({
      label: "aktuator-v2",
      createAccepted: true,
    });
    assert(again.id === project.id, "ensureProject reuses accepted");
    console.log("OK: ensureProject");

    // 2. fixture extract + accept
    const fixture: ExtractionResult = {
      concepts: [
        { label: "heat", description: "thermal energy" },
        { label: "continuous torque" },
      ],
      claims: [
        {
          label: "copper loss produces heat",
          description: "resistive losses convert to thermal energy",
          confidence: 0.9,
        },
      ],
      relations: [
        {
          from: "heat",
          relation: "limits",
          to: "continuous torque",
          confidence: 0.85,
        },
      ],
    };
    const { proposals } = await applyExtractionResult(store, fixture, {
      sourceType: "manual",
      sourceRef: "smoke-m13",
      model: "fixture",
      rawText: "Copper losses produce heat that limits continuous torque.",
    });
    for (const p of proposals.filter((x) => x.kind === "node")) {
      await store.acceptProposal(p.id);
    }
    for (const p of proposals.filter((x) => x.kind === "edge")) {
      await store.acceptProposal(p.id);
    }

    const claim = (
      await store.findNodes({
        type: "claim",
        label: "copper loss produces heat",
        status: "accepted",
      })
    )[0];
    assert(!!claim, "claim accepted");
    // defaultWorkspaceId applied on accept
    assert(
      claim!.workspaceId === "ws-test",
      `claim workspaceId expected ws-test got ${claim!.workspaceId}`
    );
    console.log("OK: accept nodes with defaultWorkspaceId");

    // 3. link claim → project
    const edge = await store.linkToProject({
      nodeId: claim!.id,
      projectId: project.id,
      relation: "used_in",
    });
    assert(edge.relation === "used_in", "relation used_in");
    console.log("OK: linkToProject");

    // 4. project status
    const status = await store.getProjectStatus({ label: "aktuator-v2" });
    assert(status.project.id === project.id, "status project id");
    assert(status.workspaceId === "ws-test", "status workspace");
    assert(
      status.claims.some((c) => c.label === "copper loss produces heat"),
      "status includes claim"
    );
    assert(
      status.summaryLines.some((l) => l.includes("copper loss produces heat")),
      "summaryLines mention claim"
    );
    console.log("OK: getProjectStatus");

    // 5. second project does not appear in first linked set
    const other = await store.ensureProject({
      label: "other-project",
      createAccepted: true,
      workspaceId: "ws-test",
    });
    const concept = (
      await store.findNodes({
        type: "concept",
        label: "heat",
        status: "accepted",
      })
    )[0];
    assert(!!concept, "heat concept");
    await store.linkToProject({
      nodeId: concept!.id,
      projectId: other.id,
      relation: "about",
    });
    const status2 = await store.getProjectStatus({ label: "aktuator-v2" });
    assert(
      !status2.linkedNodes.some((n) => n.id === other.id),
      "other project not in linked set"
    );
    assert(
      !status2.linkedNodes.some((n) => n.id === concept!.id),
      "concept linked only to other project not in aktuator status"
    );
    console.log("OK: isolation between projects");

    // 6. findNodes workspace filter
    const inWs = await store.findNodes({
      type: "project",
      workspaceId: "ws-test",
      status: "accepted",
    });
    assert(
      inWs.some((n) => n.label === "aktuator-v2"),
      "findNodes workspace filter"
    );
    console.log("OK: findNodes workspaceId filter");

    // 7. tools surface
    const registry = new MapToolRegistry();
    for (const t of createKnowledgeTools(store)) {
      registry.register(t);
    }
    for (const n of [
      "knowledge_ensure_project",
      "knowledge_link_project",
      "knowledge_unlink_project",
      "knowledge_project_status",
    ]) {
      assert(
        registry.list().some((t) => t.name === n),
        `missing tool ${n}`
      );
    }
    const toolStatus = await registry.execute(
      "knowledge_project_status",
      { label: "aktuator-v2" },
      { workspaceRoot: process.cwd() }
    );
    assert(toolStatus.ok, toolStatus.error ?? "project_status tool");
    console.log("OK: M13 knowledge tools");

    // 8. inject prefers project status when label matches
    const inject = await buildKnowledgeInjectBlock(
      store,
      "What is the status of aktuator-v2?",
      { maxChars: 2000 }
    );
    assert(!!inject, "inject block");
    assert(
      inject!.includes("Project status") || inject!.includes("project:"),
      "inject prefers project status"
    );
    assert(inject!.includes("aktuator-v2"), "inject has project label");
    console.log("OK: inject project-status heuristic");

    // 9. unlink
    const unlinked = await store.unlinkFromProject({
      nodeId: claim!.id,
      projectId: project.id,
    });
    assert(unlinked, "unlink removed edge");
    const after = await store.getProjectStatus({ projectId: project.id });
    assert(
      !after.claims.some((c) => c.id === claim!.id),
      "claim no longer linked after unlink"
    );
    console.log("OK: unlinkFromProject");
  } finally {
    store.close();
    try {
      if (existsSync(dbPath)) rmSync(dbPath);
      for (const s of ["-shm", "-wal"]) {
        if (existsSync(dbPath + s)) rmSync(dbPath + s);
      }
    } catch {
      /* ignore */
    }
  }

  console.log("All knowledge-projects (M13) smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
