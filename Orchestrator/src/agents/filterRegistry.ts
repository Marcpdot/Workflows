/**
 * Build a registry view limited to toolsAllowed for a role.
 */

import { MapToolRegistry } from "@workflows/tools";
import type { ToolRegistry } from "@workflows/tools";

/**
 * undefined toolsAllowed → full registry
 * [] → no tools (returns undefined)
 * [names] → filtered registry
 */
export function registryForRole(
  base: ToolRegistry | undefined,
  toolsAllowed: string[] | undefined
): ToolRegistry | undefined {
  if (!base) return undefined;
  if (toolsAllowed === undefined) return base;
  if (toolsAllowed.length === 0) return undefined;

  const filtered = new MapToolRegistry();
  for (const name of toolsAllowed) {
    const tool = base.get(name);
    if (tool) filtered.register(tool);
  }
  return filtered.list().length > 0 ? filtered : undefined;
}
