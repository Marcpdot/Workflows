export type SuggestionKind = "followup" | "tool" | "milestone" | "memory";

export interface Suggestion {
  id: string;
  /** Short, actionable, user language */
  text: string;
  kind: SuggestionKind;
  /** 0–1 heuristic */
  confidence: number;
}

export interface SuggestInput {
  userPrompt: string;
  assistantReply: string;
  retrievedContext?: string;
  longTermSnippets?: string[];
}

export interface SuggestOptions {
  max?: number;
  locale?: "nb" | "en";
  /** Drop suggestions below this confidence. Default 0.45 */
  minConfidence?: number;
}

export interface ProactiveSettings {
  enabled: boolean;
  max: number;
  /** Reserved for later local-model polish; default false in 3B */
  useModel: boolean;
  minConfidence: number;
  locale: "nb" | "en";
}
