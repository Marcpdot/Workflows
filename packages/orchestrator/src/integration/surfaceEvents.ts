/**
 * In-process event hub for GET /v1/events.
 * Not a cognition controller — HTTP handlers publish what they already observed.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { IntegrationSurfaceEventType } from "./types.js";
import { initSse, writeSse, writeSseComment } from "./sse.js";

export interface SurfaceEvent {
  type: IntegrationSurfaceEventType;
  at: string;
  sessionId?: string;
  error?: string;
  latencyMs?: number;
  command?: boolean;
  proposalCount?: number;
  proposalId?: string;
  kind?: string;
  capabilities?: string[];
}

const HEARTBEAT_MS = 15_000;

export class SurfaceEventHub {
  private readonly clients = new Set<ServerResponse>();

  emit(event: Omit<SurfaceEvent, "at"> & { at?: string }): void {
    const payload: SurfaceEvent = {
      ...event,
      at: event.at ?? new Date().toISOString(),
    };
    for (const res of [...this.clients]) {
      if (!writeSse(res, payload.type, payload)) {
        this.clients.delete(res);
      }
    }
  }

  subscribe(
    req: IncomingMessage,
    res: ServerResponse,
    presence: Record<string, unknown>
  ): void {
    initSse(res);
    this.clients.add(res);
    writeSse(res, "presence", {
      type: "presence",
      at: new Date().toISOString(),
      clients: this.clients.size,
      ...presence,
    });

    const heartbeat = setInterval(() => {
      if (!writeSseComment(res, "ping")) {
        clearInterval(heartbeat);
        this.clients.delete(res);
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
