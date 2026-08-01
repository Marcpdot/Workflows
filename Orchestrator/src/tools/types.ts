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
