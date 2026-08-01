/**
 * Simple in-memory tool registry.
 */

import type { Tool, ToolContext, ToolRegistry, ToolResult } from "./types.js";

export class MapToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (!tool?.name?.trim()) {
      throw new Error("Tool must have a non-empty name");
    }
    if (typeof tool.execute !== "function") {
      throw new Error(`Tool "${tool.name}" must have an execute function`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        output: "",
        error: `Unknown tool: "${name}". Known: ${this.list()
          .map((t) => t.name)
          .join(", ") || "(none)"}`,
      };
    }

    try {
      return await tool.execute(args ?? {}, ctx);
    } catch (err) {
      // Programming errors surface; business failures should return ok:false.
      // Still wrap unexpected throws so callers get ToolResult shape.
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        output: "",
        error: message,
      };
    }
  }
}
