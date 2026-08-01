/**
 * Shared schemas for tools / pipeline structured paths.
 */

import type { JsonSchema } from "./types.js";

/** Planner output: ordered steps for the worker. */
export const PLAN_SCHEMA: JsonSchema = {
  type: "object",
  required: ["steps"],
  properties: {
    steps: {
      type: "array",
      items: { type: "string" },
    },
    summary: { type: "string" },
  },
};

export interface PlanValue {
  steps: string[];
  summary?: string;
}

/** Fallback tool_calls envelope used by text models without native tool API. */
export const TOOL_CALLS_SCHEMA: JsonSchema = {
  type: "object",
  required: ["tool_calls"],
  properties: {
    tool_calls: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          args: { type: "object" },
          arguments: { type: "object" },
          id: { type: "string" },
        },
      },
    },
  },
};
