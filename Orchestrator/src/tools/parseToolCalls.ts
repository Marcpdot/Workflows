/**
 * Extract tool calls from model text (fallback when API has no structured calls).
 * Never throws on messy output — returns [] and lets the loop finish with text.
 * Uses Milestone 10 JSON extract helpers (shared with completeStructured).
 */

import { randomUUID } from "node:crypto";
import {
  extractJsonCandidates,
  lenientJsonRepair,
} from "../structured/extractJson.js";
import type { ToolCall } from "./types.js";

function asArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeCall(raw: unknown, index: number): ToolCall | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // OpenAI-ish: { id, function: { name, arguments } }
  if (obj.function && typeof obj.function === "object") {
    const fn = obj.function as Record<string, unknown>;
    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name) return null;
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === "string") {
      try {
        args = asArgs(JSON.parse(fn.arguments));
      } catch {
        args = { _raw: fn.arguments };
      }
    } else {
      args = asArgs(fn.arguments);
    }
    return {
      id: typeof obj.id === "string" ? obj.id : `call_${index}_${randomUUID().slice(0, 8)}`,
      name,
      args,
    };
  }

  // Simple: { name, args } or { name, arguments }
  const name = typeof obj.name === "string" ? obj.name : "";
  if (!name) return null;
  const args = asArgs(obj.args ?? obj.arguments ?? obj.parameters);
  return {
    id: typeof obj.id === "string" ? obj.id : `call_${index}_${randomUUID().slice(0, 8)}`,
    name,
    args,
  };
}

function callsFromParsed(parsed: unknown): ToolCall[] {
  if (Array.isArray(parsed)) {
    return parsed
      .map((item, i) => normalizeCall(item, i))
      .filter((c): c is ToolCall => c != null);
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.tool_calls)) {
      return obj.tool_calls
        .map((item, i) => normalizeCall(item, i))
        .filter((c): c is ToolCall => c != null);
    }
    // Single call object
    const single = normalizeCall(obj, 0);
    if (single && (obj.name || obj.function)) {
      return [single];
    }
  }
  return [];
}

/**
 * Parse tool calls from assistant text. Returns [] if none found or parse fails.
 */
export function parseToolCalls(text: string): ToolCall[] {
  if (!text || !text.trim()) return [];

  for (const candidate of extractJsonCandidates(text)) {
    for (const variant of [candidate, lenientJsonRepair(candidate)]) {
      try {
        const parsed = JSON.parse(variant) as unknown;
        const calls = callsFromParsed(parsed);
        if (calls.length > 0) return calls;
      } catch {
        // try next
      }
    }
  }

  return [];
}
