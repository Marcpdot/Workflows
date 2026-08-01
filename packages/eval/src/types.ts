/** Aligns with Orchestrator ModelChoice values without importing Orchestrator. */
export type EvalRouteModel = "local" | "mid" | "frontier";

export interface EvalCase {
  id: string;
  description?: string;
  prompt: string;
  /** Optional prior turns loaded into memory/history before the prompt */
  sessionSetup?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  expectRoute?: EvalRouteModel;
  /** All strings must appear in the reply (case-insensitive) */
  expectContains?: string[];
  /** If true, force a long sessionSetup so compression is likely */
  forceCompression?: boolean;
}

export interface EvalResult {
  id: string;
  pass: boolean;
  route: string;
  model: string;
  provider: string;
  latencyMs: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** Tokens used for this case (API or estimated) */
  totalTokens?: number;
  /** true if totalTokens came from char heuristic */
  tokensEstimated?: boolean;
  /** Rough USD cost (0 for local) */
  estimatedCostUsd?: number;
  costNote?: string;
  compressed?: boolean;
  replyPreview: string;
  failures: string[];
}

export interface EvalReport {
  startedAt: string;
  finishedAt: string;
  results: EvalResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    totalTokens: number;
    estimatedCostUsd: number;
    /** Cases where tokens were estimated from text length */
    tokensEstimatedCases: number;
  };
}

export interface EvalRunnerOptions {
  /** Run only this case id */
  caseId?: string;
  /** Path to cases.json */
  casesPath: string;
  /** Directory for JSON reports */
  resultsDir: string;
  /** Also print full report JSON to stdout */
  printJson?: boolean;
}
