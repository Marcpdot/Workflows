/**
 * Minimal SSE helpers for the integration HTTP surface.
 */

import type { ServerResponse } from "node:http";

export function initSse(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
}

export function writeSse(
  res: ServerResponse,
  event: string,
  data: unknown
): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

export function writeSseComment(res: ServerResponse, comment: string): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(`: ${comment}\n\n`);
    return true;
  } catch {
    return false;
  }
}
