/**
 * Minimal SSE helpers for the integration HTTP surface.
 */

import type { ServerResponse } from "node:http";

export function initSse(res: ServerResponse): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.writeHead(200);
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
