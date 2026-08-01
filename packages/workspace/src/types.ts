/**
 * Milestone 9 — session / workspace model types.
 */

export interface WorkspaceContext {
  /** Stable short id derived from absolute root path */
  id: string;
  /** Absolute workspace root (tools bind here) */
  rootPath: string;
  /** Project context dir for retrieval (workspace/context or configured) */
  contextDir: string;
  /** Prefix applied to logical session ids in shared short-term DB */
  sessionPrefix: string;
  /** Session id as provided by user / env (not namespaced) */
  logicalSessionId: string;
  /** Effective session id stored in short-term memory */
  sessionId: string;
}

export interface ResolveWorkspaceInput {
  /** Explicit workspace root (CLI --workspace / HTTP body) */
  workspaceRoot?: string;
  /** Logical session id (CLI --session); default "default" */
  sessionId?: string;
  /** Process cwd used to resolve relative paths */
  cwd?: string;
  /** Override retrieval context dir (else env / workspace/context / default) */
  contextDir?: string;
  env?: NodeJS.ProcessEnv;
}
