import { MapToolRegistry } from "./registry.js";
import { readFileTool } from "./builtin/readFile.js";
import { listDirTool } from "./builtin/listDir.js";
import { runCommandTool } from "./builtin/runCommand.js";
import { writeFileTool } from "./builtin/writeFile.js";
import { searchFilesTool } from "./builtin/searchFiles.js";
import { webSearchTool } from "./builtin/webSearch.js";
import { runScriptTool } from "./builtin/runScript.js";
import type { ToolRegistry } from "./types.js";

/**
 * Create a registry with phase A + phase C built-in tools.
 * For optional plugin modules, use createRegistryFromConfig() / loadExtraTools().
 */
export function createBuiltinRegistry(): ToolRegistry {
  const registry = new MapToolRegistry();
  // Phase A
  registry.register(readFileTool);
  registry.register(listDirTool);
  registry.register(runCommandTool);
  // Phase C
  registry.register(writeFileTool);
  registry.register(searchFilesTool);
  registry.register(webSearchTool);
  registry.register(runScriptTool);
  return registry;
}
