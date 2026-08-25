/**
 * Slash commands for interaction mode + knowledge capture/accept.
 */

import type { InteractionMode, Memory } from "@workflows/memory";
import type { KnowledgeStore } from "@workflows/knowledge";

export type SessionCommandResult =
  | {
      kind: "handled";
      message: string;
      sessionState?: Awaited<ReturnType<Memory["getSessionState"]>>;
      data?: unknown;
    }
  | { kind: "force_capture"; restPrompt: string }
  | { kind: "passthrough" };

/**
 * Parse leading slash commands. Returns passthrough if not a session command.
 */
export async function tryHandleSessionCommand(
  raw: string,
  ctx: {
    memory: Memory | null;
    sessionId: string;
    knowledge?: KnowledgeStore;
  }
): Promise<SessionCommandResult> {
  const line = raw.trim();
  if (!line.startsWith("/")) return { kind: "passthrough" };

  const parts = line.split(/\s+/);
  const cmd = parts[0]!.toLowerCase();
  const arg = parts.slice(1).join(" ").trim();

  if (cmd === "/mode") {
    if (!ctx.memory) {
      return {
        kind: "handled",
        message: "Session memory required for /mode (enable memory).",
      };
    }
    if (!arg) {
      const st = await ctx.memory.getSessionState(ctx.sessionId);
      return {
        kind: "handled",
        message: `mode=${st.interactionMode} proposals=${st.proposalsEnabled ? "on" : "off"}`,
        sessionState: st,
      };
    }
    const next = arg.toLowerCase();
    if (next !== "active" && next !== "neutral") {
      return {
        kind: "handled",
        message: "Usage: /mode | /mode active | /mode neutral",
      };
    }
    const st = await ctx.memory.updateSessionState(ctx.sessionId, {
      interactionMode: next as InteractionMode,
      // active implies proposals on unless user turned them off earlier — keep flag as-is
    });
    return {
      kind: "handled",
      message: `interactionMode → ${st.interactionMode}`,
      sessionState: st,
    };
  }

  if (cmd === "/proposals") {
    if (!ctx.memory) {
      return {
        kind: "handled",
        message: "Session memory required for /proposals.",
      };
    }
    if (!arg) {
      const st = await ctx.memory.getSessionState(ctx.sessionId);
      return {
        kind: "handled",
        message: `proposals=${st.proposalsEnabled ? "on" : "off"} mode=${st.interactionMode}`,
        sessionState: st,
      };
    }
    const next = arg.toLowerCase();
    if (next !== "on" && next !== "off") {
      return {
        kind: "handled",
        message: "Usage: /proposals | /proposals on | /proposals off",
      };
    }
    const st = await ctx.memory.updateSessionState(ctx.sessionId, {
      proposalsEnabled: next === "on",
    });
    return {
      kind: "handled",
      message: `proposals → ${st.proposalsEnabled ? "on" : "off"}`,
      sessionState: st,
    };
  }

  if (cmd === "/capture") {
    return {
      kind: "force_capture",
      restPrompt: arg || "capture last segment",
    };
  }

  if (cmd === "/accept" || cmd === "/reject") {
    if (!ctx.knowledge) {
      return {
        kind: "handled",
        message: "Knowledge store not open (enable KNOWLEDGE_TOOLS_ENABLED or KNOWLEDGE_CAPTURE_ENABLED).",
      };
    }
    if (!arg) {
      return {
        kind: "handled",
        message: `Usage: ${cmd} <proposalId>[,id2...]`,
      };
    }
    const ids = arg.split(/[\s,]+/).filter(Boolean);
    const done: string[] = [];
    const errors: string[] = [];
    for (const id of ids) {
      try {
        if (cmd === "/accept") await ctx.knowledge.acceptProposal(id);
        else await ctx.knowledge.rejectProposal(id);
        done.push(id);
      } catch (err) {
        errors.push(
          `${id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return {
      kind: "handled",
      message:
        `${cmd.slice(1)}ed ${done.length}` +
        (errors.length ? `; errors: ${errors.join("; ")}` : ""),
      data: { done, errors },
    };
  }

  return { kind: "passthrough" };
}
