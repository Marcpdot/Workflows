/**
 * Milestone 17 — compact text/markdown renderers for CLI and simple HTML.
 */

import type {
  KnowledgeEdge,
  KnowledgeNode,
  ProjectStatus,
} from "./types.js";
import type {
  ContradictionsRead,
  KnowledgeEdgeDto,
  KnowledgeNodeDto,
  NeighborhoodRead,
  SearchRead,
} from "./read.js";
import { formatNeighborhood } from "./formatNeighborhood.js";

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

/** Pipe-friendly node table (fixed columns). */
export function renderNodeTable(
  nodes: Array<KnowledgeNode | KnowledgeNodeDto>,
  options?: { title?: string }
): string {
  const lines: string[] = [];
  if (options?.title) lines.push(options.title);
  lines.push("id\ttype\tstatus\tlabel\tworkspace");
  for (const n of nodes) {
    lines.push(
      [
        n.id,
        n.type,
        n.status,
        n.label.replace(/\t/g, " "),
        n.workspaceId ?? "",
      ].join("\t")
    );
  }
  lines.push(`count\t${nodes.length}`);
  return lines.join("\n");
}

/** Markdown-ish list for humans. */
export function renderNodeList(
  nodes: Array<KnowledgeNode | KnowledgeNodeDto>,
  options?: { title?: string }
): string {
  const lines: string[] = [];
  if (options?.title) lines.push(options.title);
  if (nodes.length === 0) {
    lines.push("(none)");
    return lines.join("\n");
  }
  for (const n of nodes) {
    const ws = n.workspaceId ? ` ws=${n.workspaceId}` : "";
    lines.push(
      `- [${n.type}] ${n.label}  ${shortId(n.id)}  (${n.status})${ws}`
    );
  }
  return lines.join("\n");
}

/** ASCII/markdown subgraph (reuses formatNeighborhood). */
export function renderSubgraph(
  input: {
    nodes: Array<KnowledgeNode | KnowledgeNodeDto>;
    edges: Array<KnowledgeEdge | KnowledgeEdgeDto>;
    title?: string;
    maxChars?: number;
  }
): string {
  return formatNeighborhood({
    nodes: input.nodes as KnowledgeNode[],
    edges: input.edges as KnowledgeEdge[],
    title: input.title ?? "Subgraph",
    maxChars: input.maxChars ?? 8000,
  });
}

export function renderNeighborhoodRead(
  n: NeighborhoodRead,
  options?: { maxChars?: number }
): string {
  return renderSubgraph({
    nodes: n.nodes,
    edges: n.edges,
    title: `Neighborhood root=${shortId(n.rootId)} hops=${n.hops} (nodes=${n.nodeCount} edges=${n.edgeCount})`,
    maxChars: options?.maxChars,
  });
}

export function renderSearchRead(s: SearchRead): string {
  const q = [
    s.query.label ? `label=${s.query.label}` : null,
    s.query.type ? `type=${s.query.type}` : null,
    s.query.status ? `status=${s.query.status}` : null,
    s.query.workspaceId != null ? `workspaceId=${s.query.workspaceId}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return renderNodeList(s.nodes, {
    title: `Search ${q || "(all)"} count=${s.count}`,
  });
}

/** Stable project status report (uses summaryLines + table of claims). */
export function renderProjectStatusReport(status: ProjectStatus): string {
  const lines = [...status.summaryLines];
  if (status.claims.length > 0) {
    lines.push("claims detail:");
    for (const c of status.claims.slice(0, 20)) {
      lines.push(`  ${shortId(c.id)}  ${c.label}`);
    }
  }
  if (status.concepts.length > 0) {
    lines.push("concepts detail:");
    for (const c of status.concepts.slice(0, 20)) {
      lines.push(`  ${shortId(c.id)}  ${c.label}`);
    }
  }
  lines.push(
    `totals: linked=${status.linkedNodes.length} edges=${status.edges.length}`
  );
  return lines.join("\n");
}

export function renderContradictionsRead(c: ContradictionsRead): string {
  const lines = [
    `Contradictions count=${c.count}${c.nodeId ? ` nodeId=${shortId(c.nodeId)}` : ""}`,
  ];
  if (c.pairs.length === 0) {
    lines.push("(none)");
    return lines.join("\n");
  }
  for (const p of c.pairs) {
    lines.push(`- ${p.summary}  edge=${shortId(p.edge.id)}`);
  }
  return lines.join("\n");
}

/**
 * Minimal HTML document for browser browse (no framework).
 * Self-contained string — can be written to disk or served.
 */
export function renderKnowledgeBrowseHtml(options?: {
  apiBase?: string;
  title?: string;
}): string {
  const apiBase = options?.apiBase ?? "";
  const title = options?.title ?? "Knowledge read (M17)";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #e8e8e8; background: #12141a; }
    body { max-width: 52rem; margin: 1.5rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    label { display: block; margin: 0.75rem 0 0.25rem; font-size: 0.85rem; opacity: 0.85; }
    input, select, button { font: inherit; padding: 0.4rem 0.55rem; border-radius: 6px; border: 1px solid #333; background: #1c1f28; color: inherit; }
    button { cursor: pointer; background: #2a3344; margin-right: 0.35rem; margin-top: 0.75rem; }
    button:hover { background: #364156; }
    pre { background: #0c0e14; border: 1px solid #2a2f3a; border-radius: 8px; padding: 0.75rem; overflow: auto; font-size: 0.8rem; white-space: pre-wrap; }
    .row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: end; }
    .row > div { flex: 1 1 8rem; }
    .err { color: #f88; }
    .hint { font-size: 0.8rem; opacity: 0.7; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="hint">Read-only browser over <code>/v1/knowledge/*</code>. Enable <code>KNOWLEDGE_HTTP_READ=true</code>. Same token as integration if set.</p>
  <div class="row">
    <div>
      <label>Search label</label>
      <input id="q" placeholder="heat" />
    </div>
    <div>
      <label>Type</label>
      <select id="type">
        <option value="">any</option>
        <option>concept</option>
        <option>claim</option>
        <option>project</option>
        <option>artifact</option>
        <option>source</option>
      </select>
    </div>
  </div>
  <button id="btnSearch" type="button">Search</button>
  <label>Node id (neighborhood)</label>
  <input id="nodeId" placeholder="uuid" style="width:100%" />
  <button id="btnNeigh" type="button">Neighborhood</button>
  <label>Project label</label>
  <input id="project" placeholder="aktuator-v2" />
  <button id="btnProject" type="button">Project status</button>
  <button id="btnContra" type="button">Contradictions</button>
  <pre id="out">Ready.</pre>
  <script>
    const API = ${JSON.stringify(apiBase)};
    const out = document.getElementById("out");
    function tokenHeaders() {
      const t = localStorage.getItem("INTEGRATION_HTTP_TOKEN") || "";
      return t ? { Authorization: "Bearer " + t } : {};
    }
    async function get(path) {
      out.textContent = "Loading…";
      try {
        const res = await fetch(API + path, { headers: tokenHeaders() });
        const text = await res.text();
        let body;
        try { body = JSON.parse(text); } catch { body = text; }
        if (!res.ok) {
          out.className = "err";
          out.textContent = typeof body === "object" ? JSON.stringify(body, null, 2) : text;
          return;
        }
        out.className = "";
        out.textContent = typeof body === "object" ? JSON.stringify(body, null, 2) : String(body);
      } catch (e) {
        out.className = "err";
        out.textContent = String(e);
      }
    }
    document.getElementById("btnSearch").onclick = () => {
      const q = document.getElementById("q").value.trim();
      const type = document.getElementById("type").value;
      const p = new URLSearchParams();
      if (q) p.set("label", q);
      if (type) p.set("type", type);
      p.set("status", "accepted");
      get("/v1/knowledge/search?" + p.toString());
    };
    document.getElementById("btnNeigh").onclick = () => {
      const id = document.getElementById("nodeId").value.trim();
      if (!id) { out.textContent = "node id required"; return; }
      get("/v1/knowledge/neighborhood?nodeId=" + encodeURIComponent(id) + "&hops=1");
    };
    document.getElementById("btnProject").onclick = () => {
      const label = document.getElementById("project").value.trim();
      if (!label) { out.textContent = "project label required"; return; }
      get("/v1/knowledge/project-status?label=" + encodeURIComponent(label));
    };
    document.getElementById("btnContra").onclick = () => get("/v1/knowledge/contradictions");
  </script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
