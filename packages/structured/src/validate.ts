/**
 * Lightweight JSON Schema subset validation (no dependencies).
 */

import type { JsonSchema } from "./types.js";

export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  path = "$"
): { ok: true } | { ok: false; error: string } {
  const t = schema.type;

  if (t === "string") {
    if (typeof value !== "string") {
      return { ok: false, error: `${path}: expected string` };
    }
    return { ok: true };
  }
  if (t === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `${path}: expected number` };
    }
    return { ok: true };
  }
  if (t === "boolean") {
    if (typeof value !== "boolean") {
      return { ok: false, error: `${path}: expected boolean` };
    }
    return { ok: true };
  }
  if (t === "array") {
    if (!Array.isArray(value)) {
      return { ok: false, error: `${path}: expected array` };
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const r = validateAgainstSchema(value[i], schema.items, `${path}[${i}]`);
        if (!r.ok) return r;
      }
    }
    return { ok: true };
  }

  // object
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: `${path}: expected object` };
  }
  const obj = value as Record<string, unknown>;
  const props = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (!(key in obj)) {
      return { ok: false, error: `${path}: missing required property "${key}"` };
    }
  }
  for (const [key, sub] of Object.entries(props)) {
    if (key in obj) {
      const r = validateAgainstSchema(obj[key], sub, `${path}.${key}`);
      if (!r.ok) return r;
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!(key in props)) {
        return {
          ok: false,
          error: `${path}: unexpected property "${key}"`,
        };
      }
    }
  }
  return { ok: true };
}

/** Parse JSON from text and validate; throws Error on failure. */
export function parseJsonWithSchema<T = unknown>(
  raw: string,
  schema: JsonSchema,
  tryParse: (text: string) =>
    | { ok: true; value: unknown }
    | { ok: false; error: string }
): T {
  const parsed = tryParse(raw);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  const v = validateAgainstSchema(parsed.value, schema);
  if (!v.ok) {
    throw new Error(v.error);
  }
  return parsed.value as T;
}
