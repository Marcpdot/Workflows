/**
 * createRegistryFromConfig() rebuilds built-ins only and drops tools that
 * loadConfigFromEnv already registered (knowledge_*). Re-attach them.
 */

import { createKnowledgeTools, createTensorTools, resolveKnowledgeToolsOptions } from "@workflows/knowledge";
import { createRegistryFromConfig } from "@workflows/tools";
import type { OrchestratorConfig } from "./types.js";

function envFlagTrue(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export async function attachKnowledgeToolsToRegistry(
  config: OrchestratorConfig
): Promise<void> {
  if (!config.tools) return;
  config.tools = await createRegistryFromConfig();
  for (const tool of createTensorTools()) {
    config.tools.register(tool);
  }
  if (config.knowledge && envFlagTrue(process.env.KNOWLEDGE_TOOLS_ENABLED)) {
    for (const t of createKnowledgeTools(config.knowledge, resolveKnowledgeToolsOptions())) {
      config.tools.register(t);
    }
  }
}
