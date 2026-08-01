/**
 * High-level parse helpers combining extract + schema validate.
 */

import { tryParseJson } from "./extractJson.js";
import type { JsonSchema } from "./types.js";
import { parseJsonWithSchema, validateAgainstSchema } from "./validate.js";

/** Parse raw model text as JSON validated against schema; throws on failure. */
export function parseStructured<T = unknown>(
  raw: string,
  schema: JsonSchema
): T {
  return parseJsonWithSchema<T>(raw, schema, tryParseJson);
}

/** Non-throwing variant. */
export function tryParseStructured<T = unknown>(
  raw: string,
  schema: JsonSchema
):
  | { ok: true; value: T }
  | { ok: false; error: string; raw: string } {
  try {
    const value = parseStructured<T>(raw, schema);
    return { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      raw,
    };
  }
}

export { validateAgainstSchema, tryParseJson };
