/**
 * Optional plugin loader: dynamic-import modules that export Tool or Tool[].
 *
 * Plugin module shapes supported:
 *   export const tools: Tool[]
 *   export default Tool | Tool[]
 *   export const tool: Tool
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { Tool, ToolRegistry } from "./types.js";

function collectTools(mod: Record<string, unknown>): Tool[] {
  const found: Tool[] = [];

  const asTool = (v: unknown): v is Tool =>
    !!v &&
    typeof v === "object" &&
    typeof (v as Tool).name === "string" &&
    typeof (v as Tool).execute === "function";

  if (Array.isArray(mod.tools)) {
    for (const t of mod.tools) {
      if (asTool(t)) found.push(t);
    }
  }
  if (asTool(mod.tool)) found.push(mod.tool);
  if (asTool(mod.default)) found.push(mod.default);
  if (Array.isArray(mod.default)) {
    for (const t of mod.default) {
      if (asTool(t)) found.push(t);
    }
  }

  return found;
}

/**
 * Load extra tool modules and register them on the registry.
 * Module paths are resolved from cwd (file path or bare specifier).
 */
export async function loadExtraTools(
  registry: ToolRegistry,
  modules: string[]
): Promise<{ loaded: string[]; errors: string[] }> {
  const loaded: string[] = [];
  const errors: string[] = [];

  for (const raw of modules) {
    const spec = raw.trim();
    if (!spec) continue;

    try {
      let href = spec;
      // Relative/absolute file paths → file URL for dynamic import on Windows.
      if (
        spec.startsWith(".") ||
        spec.startsWith("/") ||
        /^[A-Za-z]:[\\/]/.test(spec)
      ) {
        href = pathToFileURL(resolve(process.cwd(), spec)).href;
      }

      const mod = (await import(href)) as Record<string, unknown>;
      const tools = collectTools(mod);
      if (tools.length === 0) {
        errors.push(`${spec}: no Tool exports found`);
        continue;
      }
      for (const t of tools) {
        registry.register(t);
        loaded.push(`${spec}#${t.name}`);
      }
    } catch (err) {
      errors.push(
        `${spec}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { loaded, errors };
}

/**
 * Built-ins (A+C) plus optional TOOL_EXTRA_MODULES / explicit extras list.
 */
export async function createRegistryFromConfig(options?: {
  extraModules?: string[];
  /** If true, skip registering built-ins (tests). Default false */
  builtins?: boolean;
}): Promise<ToolRegistry> {
  const { createBuiltinRegistry } = await import("./createBuiltinRegistry.js");
  const registry =
    options?.builtins === false
      ? new (await import("./registry.js")).MapToolRegistry()
      : createBuiltinRegistry();

  const fromEnv =
    process.env.TOOL_EXTRA_MODULES?.split(",").map((s) => s.trim()).filter(Boolean) ??
    [];
  const modules = options?.extraModules ?? fromEnv;
  if (modules.length > 0) {
    const { errors } = await loadExtraTools(registry, modules);
    if (errors.length > 0) {
      // Non-fatal: report but keep built-ins
      for (const e of errors) {
        console.warn(`[tools] extra module: ${e}`);
      }
    }
  }

  return registry;
}
