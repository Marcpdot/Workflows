/**
 * Best-effort status probes for GET /v1/status.
 * Failures degrade the payload; they must not become a central controller.
 */

import { spawn } from "node:child_process";
import { createKnowledgeStore } from "@workflows/knowledge";
import { loadVoiceConfig } from "@workflows/voice";
import type { IntegrationStatusResponse } from "./types.js";

const PROBE_MS = 1_500;

function envFlagTrue(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function probeKnowledge(): Promise<
  IntegrationStatusResponse["knowledge"]
> {
  const captureDisabled = envFlagTrue(process.env.KNOWLEDGE_CAPTURE_DISABLED);
  const configured =
    envFlagTrue(process.env.KNOWLEDGE_TOOLS_ENABLED) ||
    envFlagTrue(process.env.KNOWLEDGE_INJECT_ENABLED) ||
    envFlagTrue(process.env.KNOWLEDGE_INGEST_AUTO_ON_CHAT) ||
    !captureDisabled;
  if (!configured) {
    return { configured: false, ok: true, detail: "knowledge store not opened" };
  }
  const store = createKnowledgeStore();
  try {
    const health = await withTimeout(
      store.healthCheck(),
      PROBE_MS,
      "knowledge"
    );
    return {
      configured: true,
      ok: health.ok,
      backend: health.backend,
      detail: health.detail,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      backend: "postgresql",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      await withTimeout(Promise.resolve(store.close()), PROBE_MS, "knowledge.close");
    } catch {
      /* ignore — probe must not hang the status route */
    }
  }
}

function probeLocalModel(
  bin: string
): Promise<{ ok: boolean; detail?: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    let settled = false;
    const finish = (ok: boolean, detail?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({ ok, detail });
    };
    const timer = setTimeout(() => finish(false, "timeout"), PROBE_MS);
    child.on("error", (err) => finish(false, err.message));
    child.on("close", (code) =>
      finish(code === 0, code === 0 ? undefined : `exit ${code}`)
    );
  });
}

export async function collectIntegrationStatus(input: {
  version: string;
  busy: boolean;
}): Promise<IntegrationStatusResponse> {
  const voice = loadVoiceConfig(process.env);
  const ollamaBin = process.env.OLLAMA_BIN ?? "ollama";
  const ollamaModel = process.env.OLLAMA_MODEL ?? "llama3.1:8b";
  const [knowledge, local] = await Promise.all([
    probeKnowledge(),
    probeLocalModel(ollamaBin),
  ]);
  const frontierConfigured = Boolean(process.env.XAI_API_KEY?.trim());
  const midModel = process.env.POLICY_MID_MODEL?.trim() || undefined;
  const degraded = knowledge.ok === false || local.ok === false;
  return {
    ok: true,
    service: "orchestrator",
    version: input.version,
    busy: input.busy,
    degraded,
    knowledge,
    model: {
      local: {
        ok: local.ok,
        bin: ollamaBin,
        model: ollamaModel,
        detail: local.detail,
      },
      frontier: {
        configured: frontierConfigured,
        model: process.env.GROK_MODEL ?? "grok-3",
      },
      mid: {
        configured: Boolean(midModel),
        model: midModel,
      },
    },
    voice: {
      enabled: voice.enabled,
      sttProvider: voice.sttProvider,
      ttsProvider: voice.ttsProvider,
      allowRemoteAudio: voice.allowRemoteAudio,
      language: voice.language,
    },
  };
}
