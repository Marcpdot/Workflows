import { OllamaCliClient, type ModelClient } from "@workflows/models";
import type { KnowledgeAgentDecision, KnowledgeAgentMode, KnowledgeAgentModelAdapter, KnowledgeAgentModelInput, KnowledgeAgentOutcome } from "@workflows/knowledge";

export interface KnowledgeAgentModelConfig { provider: "ollama"; navigatorModel: string; curatorModel: string; ollamaBin?: string; }
export function resolveKnowledgeAgentModelConfig(env: NodeJS.ProcessEnv = process.env): KnowledgeAgentModelConfig {
  const provider = env.KNOWLEDGE_AGENT_PROVIDER?.trim().toLowerCase() || "ollama";
  if (provider !== "ollama") throw new Error(`Unsupported KNOWLEDGE_AGENT_PROVIDER: ${provider}`);
  const shared = env.KNOWLEDGE_AGENT_MODEL?.trim() || env.OLLAMA_MODEL?.trim() || "llama3.2:3b";
  return { provider, navigatorModel: env.KNOWLEDGE_AGENT_NAVIGATOR_MODEL?.trim() || shared, curatorModel: env.KNOWLEDGE_AGENT_CURATOR_MODEL?.trim() || shared, ollamaBin: env.OLLAMA_BIN?.trim() || undefined };
}
export class ProviderKnowledgeAgentModelAdapter implements KnowledgeAgentModelAdapter {
  constructor(private readonly clients: Record<KnowledgeAgentMode, ModelClient>, private readonly models: Record<KnowledgeAgentMode, string>) {}
  async next(input: KnowledgeAgentModelInput): Promise<KnowledgeAgentDecision> {
    const response = await this.clients[input.mode].complete({ model: this.models[input.mode], temperature: 0, messages: [
      { role: "system", content: `${input.policy}\nReturn exactly one JSON object: either {\"kind\":\"tool\",\"tool\":\"allowed tool name\",\"args\":{}} or {\"kind\":\"final\",\"answer\":\"answer\",\"outcome\":\"answered|proposed|insufficient|bounded|failed\"}. Never emit prose outside JSON.` },
      { role: "user", content: JSON.stringify({ goal: input.goal, mode: input.mode, tools: input.tools, priorSteps: input.steps, remainingToolCalls: input.remainingToolCalls, remainingProposals: input.remainingProposals }) },
    ] });
    return parseKnowledgeAgentDecision(response.content, input);
  }
}
export function parseKnowledgeAgentDecision(raw: string, input: Pick<KnowledgeAgentModelInput, "tools" | "mode">): KnowledgeAgentDecision {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""); let value: unknown;
  try { value = JSON.parse(cleaned); } catch { throw new Error("Knowledge Agent model returned malformed JSON; refusing tool execution"); }
  if (!value || typeof value !== "object") throw new Error("Knowledge Agent model decision must be an object");
  const decision = value as Record<string, unknown>;
  if (decision.kind === "final" && typeof decision.answer === "string") { const outcomes = ["answered", "proposed", "insufficient", "bounded", "failed"]; if (decision.outcome !== undefined && !outcomes.includes(String(decision.outcome))) throw new Error("Knowledge Agent model returned an invalid outcome"); return { kind: "final", answer: decision.answer, outcome: decision.outcome as KnowledgeAgentOutcome | undefined }; }
  if (decision.kind === "tool" && typeof decision.tool === "string" && decision.args && typeof decision.args === "object" && !Array.isArray(decision.args)) { if (!input.tools.some((tool) => tool.name === decision.tool)) throw new Error(`Knowledge Agent model selected unavailable ${input.mode} tool ${decision.tool}`); return { kind: "tool", tool: decision.tool, args: decision.args as Record<string, unknown> }; }
  throw new Error("Knowledge Agent model returned an invalid decision; refusing tool execution");
}
export function createConfiguredKnowledgeAgentModelAdapter(env: NodeJS.ProcessEnv = process.env): ProviderKnowledgeAgentModelAdapter { const config = resolveKnowledgeAgentModelConfig(env); const client = new OllamaCliClient({ bin: config.ollamaBin, defaultModel: config.navigatorModel }); return new ProviderKnowledgeAgentModelAdapter({ navigator: client, curator: client }, { navigator: config.navigatorModel, curator: config.curatorModel }); }
