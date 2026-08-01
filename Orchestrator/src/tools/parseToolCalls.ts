/**
 * Extract tool calls from model text (fallback when API has no structured calls).
 * Never throws on messy output — returns [] and lets the loop finish with text.
 */

import { randomUUID } from "node:crypto";
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

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];

  // Fenced ```json ... ```
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m[1]?.trim()) candidates.push(m[1].trim());
  }

  // Whole text if it looks like JSON
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    candidates.push(trimmed);
  }

  // First balanced {...} containing tool_calls
  const marker = text.indexOf("tool_calls");
  if (marker >= 0) {
    const start = text.lastIndexOf("{", marker);
    if (start >= 0) {
      let depth = 0;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            candidates.push(text.slice(start, i + 1));
            break;
          }
        }
      }
    }
  }

  return candidates;
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
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const calls = callsFromParsed(parsed);
      if (calls.length > 0) return calls;
    } catch {
      // try next candidate
    }
  }

  return [];
}
