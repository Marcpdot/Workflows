/** Compatible with Orchestrator / models ChatMessage shape. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ToolParamType = "string" | "number" | "boolean";

export interface ToolParameter {
  name: string;
  type: ToolParamType;
  description: string;
  required?: boolean;
}

export interface ToolResult {
  ok: boolean;
  /** Human/model-readable output */
  output: string;
  /** Optional machine-readable payload */
  data?: unknown;
  error?: string;
}

export interface ToolContext {
  /** Absolute path — all file tools must stay under this root */
  workspaceRoot: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult>;
}

/** Model-requested tool invocation (phase B). */
export interface ToolCall {
  /** Model-provided or generated id */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolLoopStep {
  call: ToolCall;
  result: ToolResult;
  durationMs: number;
}

export interface ToolLoopResult {
  /** Final assistant text after loop ends */
  finalText: string;
  steps: ToolLoopStep[];
  /** true if stopped because maxSteps hit */
  hitMaxSteps: boolean;
}

export interface ToolLoopCompleteResult {
  text: string;
  toolCalls?: ToolCall[];
}

export interface ToolLoopOptions {
  maxSteps?: number;
  workspaceRoot: string;
  registry: ToolRegistry;
  /** Each model turn; return assistant text + optional structured tool calls */
  complete: (
    messages: ChatMessage[],
    tools: Tool[]
  ) => Promise<ToolLoopCompleteResult>;
  /** Optional durable-source hook, invoked before this output affects later steps. */
  onModelOutput?: (
    output: ToolLoopCompleteResult
  ) => Promise<string | void>;
  /** Optional durable-source hook, invoked before tool execution. */
  onToolCall?: (
    call: ToolCall,
    modelOutputExperienceId?: string
  ) => Promise<string | void>;
  /** Optional durable-source hook, invoked before another model turn can use the result. */
  onToolResult?: (
    step: ToolLoopStep,
    toolCallExperienceId?: string
  ) => Promise<string | void>;
}

export interface ModelToolSchema {
  name: string;
  description: string;
  parameters: ToolParameter[];
}
