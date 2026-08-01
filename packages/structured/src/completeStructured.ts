/**
 * completeStructured: model complete + parse with optional repair turns.
 * Never throws for parse failures — returns StructuredResult with ok:false.
 */

import type {
  ChatMessage,
  CompleteStructuredOptions,
  StructuredResult,
} from "./types.js";

const DEFAULT_MAX_ATTEMPTS = 2;

const DEFAULT_REPAIR_HINT =
  "Your previous reply was not valid for the required structure. " +
  "Reply with ONLY valid JSON matching the schema. No markdown fences if possible, no prose.";

/**
 * Call the model, parse the result, and optionally repair once (or more).
 * Raw chat callers should not use this — only structured consumers.
 */
export async function completeStructured<T>(
  options: CompleteStructuredOptions<T>
): Promise<StructuredResult<T>> {
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  );
  const repair = options.repair !== false;
  const repairHint = options.repairHint?.trim() || DEFAULT_REPAIR_HINT;

  let messages: ChatMessage[] = [...options.messages];
  let lastRaw = "";
  let lastError = "no attempt";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      lastRaw = (await options.complete(messages)) ?? "";
    } catch (err) {
      return {
        ok: false,
        raw: lastRaw,
        error: `complete failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        attempts: attempt,
      };
    }

    try {
      const value = options.parse(lastRaw);
      return {
        ok: true,
        value,
        raw: lastRaw,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (!repair || attempt >= maxAttempts) {
        return {
          ok: false,
          raw: lastRaw,
          error: lastError,
          attempts: attempt,
        };
      }
      // Repair turn: show prior raw + hint
      messages = [
        ...messages,
        { role: "assistant", content: lastRaw },
        {
          role: "user",
          content: `${repairHint}\n\nParse error: ${lastError}\n\nPrevious output:\n${lastRaw.slice(0, 4000)}`,
        },
      ];
    }
  }

  return {
    ok: false,
    raw: lastRaw,
    error: lastError,
    attempts: maxAttempts,
  };
}
