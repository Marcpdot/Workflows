/**
 * Milestone 10 — structured / parseable model output.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Minimal JSON Schema subset (no external schema libs). */
export type JsonSchemaType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "boolean";

export interface JsonSchema {
  type: JsonSchemaType;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  /** When false, extra object keys fail validation. Default: allow. */
  additionalProperties?: boolean;
}

export interface StructuredResult<T> {
  ok: boolean;
  value?: T;
  /** Last raw model text attempted */
  raw: string;
  error?: string;
  /** Number of complete() calls made */
  attempts: number;
}

export interface CompleteStructuredOptions<T> {
  /** Model turn — returns assistant text only */
  complete: (messages: ChatMessage[]) => Promise<string>;
  messages: ChatMessage[];
  /**
   * Parse + validate raw text into T.
   * Throw Error (or return never) on failure so a repair turn can run.
   */
  parse: (raw: string) => T;
  /** Max complete() attempts including the first. Default: 2 */
  maxAttempts?: number;
  /**
   * When true (default), on parse failure append a repair user message
   * and call complete again (until maxAttempts).
   */
  repair?: boolean;
  /** Optional extra instruction appended on repair turns */
  repairHint?: string;
}
