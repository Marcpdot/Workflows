import { MapToolRegistry } from "./registry.js";
import { readFileTool } from "./builtin/readFile.js";
import { listDirTool } from "./builtin/listDir.js";
import { runCommandTool } from "./builtin/runCommand.js";
import type { ToolRegistry } from "./types.js";

/** Create a registry with the three phase-A built-in tools. */
export function createBuiltinRegistry(): ToolRegistry {
  const registry = new MapToolRegistry();
  registry.register(readFileTool);
  registry.register(listDirTool);
  registry.register(runCommandTool);
  return registry;
}
