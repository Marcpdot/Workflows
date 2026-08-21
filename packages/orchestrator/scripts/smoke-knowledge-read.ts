/**
 * Offline smoke for Milestone 17 knowledge read surface.
 * Asserts stable JSON envelopes across repeated reads.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  createKnowledgeReader,
  createKnowledgeStore,
  renderKnowledgeBrowseHtml,
  renderNeighborhoodRead,
  renderProjectStatusReport,
  renderSearchRead,
  selectKnowledgeContext,
} from "@workflows/knowledge";
import { listenIntegrationServer } from "../src/integration/index.js";
import { startKnowledgePostgresTest } from "./knowledge-postgres-test-runtime.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function stableKeys(obj: unknown): string[] {
  if (obj == null || typeof obj !== "object") return [];
  return Object.keys(obj as object).sort();
}

async function main(): Promise<void> {
  const postgres = await startKnowledgePostgresTest();
  const dataDir = resolve(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = resolve(dataDir, `_smoke_knowledge_read_${Date.now()}.db`);
  const store = createKnowledgeStore();
  const reader = createKnowledgeReader(store);

  try {
    // Seed graph
    const project = await store.ensureProject({
      label: "read-demo",
      createAccepted: true,
    });
    const ev = await store.createEvent({
      sourceType: "manual",
      sourceRef: "smoke-read",
    });
    const props = await store.addProposals(ev.id, [
      { kind: "node", payload: { type: "concept", label: "heat" } },
      { kind: "node", payload: { type: "concept", label: "torque" } },
      {
        kind: "edge",
        payload: { from: "heat", relation: "limits", to: "torque" },
      },
      {
        kind: "node",
        payload: { type: "claim", label: "heat limits torque" },
      },
    ]);
    for (const p of props) await store.acceptProposal(p.id);
    const heat = (
      await store.findNodes({
        type: "concept",
        label: "heat",
        status: "accepted",
      })
    ).find((n) => n.label === "heat")!;
    await store.linkToProject({
      nodeId: heat.id,
      projectId: project.id,
      relation: "used_in",
    });
    const pendingEvent = await store.createEvent({
      sourceType: "manual",
      sourceRef: "smoke-read-pending",
    });
    await store.addProposals(pendingEvent.id, [
      { kind: "node", payload: { type: "concept", label: "pending-only" } },
    ]);

    // 1. search envelope stable
    const s1 = await reader.search({ label: "heat", status: "accepted" });
    const s2 = await reader.search({ label: "heat", status: "accepted" });
    assert(s1.count === s2.count, "search count stable");
    assert(
      JSON.stringify(stableKeys(s1)) === JSON.stringify(stableKeys(s2)),
      "search keys stable"
    );
    for (const k of ["query", "nodes", "count"]) {
      assert(k in s1, `search has ${k}`);
    }
    assert(s1.nodes[0] && "id" in s1.nodes[0] && "type" in s1.nodes[0], "node dto");
    console.log("OK: search envelope");

    // 2. neighborhood
    const n1 = await reader.getNeighborhood(heat.id, { hops: 1 });
    const n2 = await reader.getNeighborhood(heat.id, { hops: 1 });
    assert(n1.edgeCount === n2.edgeCount, "neighborhood edgeCount stable");
    assert(n1.nodeCount >= 1, "has nodes");
    assert(n1.edgeCount >= 1, "has edges");
    for (const k of [
      "rootId",
      "hops",
      "nodes",
      "edges",
      "nodeCount",
      "edgeCount",
    ]) {
      assert(k in n1, `neighborhood has ${k}`);
    }
    const text = renderNeighborhoodRead(n1);
    assert(text.includes("heat") && text.includes("limits"), "subgraph render");
    console.log("OK: neighborhood envelope + render");

    // 3. bulk subgraph defaults to accepted and returns induced edges only
    const subgraph = await reader.getSubgraph({ limit: 50 });
    assert(subgraph.query.status === "accepted", "subgraph accepted default");
    assert(subgraph.nodes.some((n) => n.id === heat.id), "subgraph includes heat");
    assert(
      !subgraph.nodes.some((n) => n.label === "pending-only"),
      "pending proposals never appear as graph nodes"
    );
    assert(subgraph.edgeCount >= 1, "subgraph includes accepted edges");
    const subgraphIds = new Set(subgraph.nodes.map((n) => n.id));
    assert(
      subgraph.edges.every(
        (edge) =>
          subgraphIds.has(edge.fromNodeId) && subgraphIds.has(edge.toNodeId)
      ),
      "subgraph edges are induced by returned nodes"
    );
    assert(!subgraph.truncated, "small graph is not truncated");

    const rooted = await reader.getSubgraph({ rootId: heat.id, hops: 1 });
    assert(rooted.query.rootId === heat.id, "rooted query echoed");
    assert(rooted.nodes.some((n) => n.id === heat.id), "rooted graph has root");
    assert(rooted.edgeCount >= 1, "rooted graph has neighborhood edge");

    const bulk = await reader.getSubgraph({ nodeIds: [heat.id], limit: 10 });
    assert(bulk.nodeCount === 1, "bulk ids select exact accepted nodes");
    assert(bulk.edgeCount === 0, "induced edge omitted without both endpoints");

    const capped = await reader.getSubgraph({ limit: 1 });
    assert(capped.nodeCount === 1 && capped.truncated, "subgraph cap reported");
    console.log("OK: accepted subgraph bulk/root/cap envelopes");

    // 4. project status
    const st = await reader.getProjectStatus({ label: "read-demo" });
    assert(st.project.label === "read-demo", "project");
    assert(st.summaryLines.length >= 2, "summaryLines");
    const report = renderProjectStatusReport(st);
    assert(report.includes("read-demo"), "status report");
    console.log("OK: project status read + report");

    // 5. node get
    const node = await reader.getNode(heat.id);
    assert(node?.label === "heat", "getNode");
    console.log("OK: getNode");

    // 6. contradictions envelope (may be empty)
    const c = await reader.findContradictions();
    assert("pairs" in c && "count" in c, "contradictions shape");
    console.log("OK: contradictions envelope");

    // 7. search render
    const listText = renderSearchRead(s1);
    assert(listText.includes("heat"), "search render");

    // 8. HTML browse shell is self-contained
    const html = renderKnowledgeBrowseHtml({ apiBase: "" });
    assert(html.includes("/v1/knowledge/search"), "html has search route");
    assert(html.includes("<!DOCTYPE html>"), "html doctype");
    console.log("OK: browse HTML");

    // 9. HTTP read (optional path)
    process.env.KNOWLEDGE_HTTP_READ = "true";
    const httpPort = 19000 + Math.floor(Math.random() * 1000);
    const { server, url: base } = await listenIntegrationServer({
      host: "127.0.0.1",
      port: httpPort,
      token: undefined,
    });
    try {
      const searchRes = await fetch(
        `${base}/v1/knowledge/search?label=heat&status=accepted`
      );
      assert(searchRes.ok, `http search ${searchRes.status}`);
      const searchBody = (await searchRes.json()) as {
        ok?: boolean;
        count?: number;
        nodes?: unknown[];
      };
      assert(searchBody.ok === true, "http ok");
      assert((searchBody.count ?? 0) >= 1, "http search hits");

      const neighRes = await fetch(
        `${base}/v1/knowledge/neighborhood?nodeId=${encodeURIComponent(heat.id)}`
      );
      assert(neighRes.ok, "http neighborhood");
      const neighBody = (await neighRes.json()) as {
        ok?: boolean;
        edgeCount?: number;
        rootId?: string;
      };
      assert(neighBody.rootId === heat.id, "http rootId");
      assert((neighBody.edgeCount ?? 0) >= 1, "http edges");

      const subgraphRes = await fetch(
        `${base}/v1/knowledge/subgraph?rootId=${encodeURIComponent(heat.id)}&hops=1`
      );
      assert(subgraphRes.ok, "http subgraph");
      const subgraphBody = (await subgraphRes.json()) as {
        ok?: boolean;
        nodeCount?: number;
        edgeCount?: number;
        query?: { status?: string; rootId?: string };
      };
      assert(subgraphBody.ok === true, "http subgraph ok");
      assert(subgraphBody.query?.status === "accepted", "http accepted default");
      assert(subgraphBody.query?.rootId === heat.id, "http subgraph root");
      assert((subgraphBody.nodeCount ?? 0) >= 2, "http subgraph nodes");

      const idx = await fetch(`${base}/v1/knowledge`);
      assert(idx.ok, "http knowledge index");

      const page = await fetch(`${base}/knowledge`);
      assert(page.ok, "http /knowledge html");
      const pageText = await page.text();
      assert(pageText.includes("Knowledge read"), "html title");

      const focused = await selectKnowledgeContext(store, "unrelated-xyz-query", {
        seedNodeIds: [heat.id],
      });
      assert(
        focused?.canonicalIds.includes(heat.id) === true,
        "focus seedNodeIds retrieve accepted neighborhood without prompt match"
      );
      console.log("OK: knowledge focus seeds");

      const pendingListed = await fetch(
        `${base}/v1/knowledge/proposals?status=pending`
      );
      const pendingBody = (await pendingListed.json()) as {
        ok?: boolean;
        proposals?: Array<{ id: string; payload?: { label?: string } }>;
      };
      const pendingOnly = pendingBody.proposals?.find(
        (p) => p.payload?.label === "pending-only"
      );
      assert(pendingOnly?.id, "pending-only proposal");
      const rejectRes = await fetch(
        `${base}/v1/knowledge/proposals/${encodeURIComponent(pendingOnly!.id)}/reject`,
        { method: "POST" }
      );
      const rejectBody = (await rejectRes.json()) as {
        ok?: boolean;
        action?: string;
      };
      assert(rejectRes.status === 200 && rejectBody.ok === true, "http reject");
      assert(rejectBody.action === "reject", "reject action");
      const rejected = await store.getProposal(pendingOnly!.id);
      assert(rejected?.status === "rejected", "store reject via HTTP");

      const acceptEvent = await store.createEvent({
        sourceType: "manual",
        sourceRef: "smoke-read-accept-http",
      });
      const [toAccept] = await store.addProposals(acceptEvent.id, [
        { kind: "node", payload: { type: "concept", label: "http-accepted" } },
      ]);
      const acceptRes = await fetch(
        `${base}/v1/knowledge/proposals/${encodeURIComponent(toAccept!.id)}/accept`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const acceptBody = (await acceptRes.json()) as { ok?: boolean; action?: string };
      assert(acceptRes.status === 200 && acceptBody.ok === true, "http accept");
      const accepted = await store.getProposal(toAccept!.id);
      assert(accepted?.status === "accepted", "store accept via HTTP");
      const missAccept = await fetch(
        `${base}/v1/knowledge/proposals/not-a-real-id/accept`,
        { method: "POST" }
      );
      assert(missAccept.status === 400 || missAccept.status === 404, "unknown proposal");

      console.log("OK: HTTP knowledge read + accept/reject routes");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  } finally {
    await store.close();
    await postgres.dispose();
    delete process.env.KNOWLEDGE_HTTP_READ;
    try {
      if (existsSync(dbPath)) rmSync(dbPath);
      for (const s of ["-shm", "-wal"]) {
        if (existsSync(dbPath + s)) rmSync(dbPath + s);
      }
    } catch {
      /* ignore */
    }
  }

  console.log("All knowledge-read (M17) smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
