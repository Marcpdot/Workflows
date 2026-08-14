/** Offline WP1 smoke: durable experience spine + tool provenance. */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { createMemory } from "@workflows/memory";
import {
  captureConversationSegment,
  conversationExperienceIds,
  conversationSourceRef,
  type KnowledgeEvent,
  type KnowledgeProposal,
  type KnowledgeStore,
} from "@workflows/knowledge";
import { createBuiltinRegistry } from "@workflows/tools";
import { Orchestrator } from "../src/orchestrator.js";
import type {
  ModelClient,
  OrchestratorConfig,
} from "../src/types.js";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const dbPath = resolve(process.cwd(), "data/_smoke_experience.db");
for (const suffix of ["", "-shm", "-wal"]) {
  if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}

const memory = createMemory({ dbPath });
let completion = 0;
const model: ModelClient = {
  provider: "local",
  async complete(request) {
    completion++;
    if (completion === 1) {
      return {
        content: "",
        model: "fixture-model",
        provider: "local",
        toolCalls: [
          { id: "fixture-call", name: "list_dir", args: { path: "." } },
        ],
      };
    }
    const toolResult = request.messages.find((message) =>
      message.content.startsWith("Tool result for list_dir")
    );
    assert(toolResult, "tool result reaches the model");
    return {
      content: "The workspace listing was inspected.",
      model: "fixture-model",
      provider: "local",
    };
  },
};

const config: OrchestratorConfig = {
  ollamaBin: "ollama",
  ollamaModel: "fixture-model",
  xaiApiKey: "",
  xaiBaseUrl: "https://example.invalid",
  grokModel: "fixture-frontier",
  systemPrompt: "Test assistant.",
  compression: {
    threshold: 20,
    keepRecent: 8,
    maxSummaryChars: 1_500,
    disabled: true,
  },
  retrieval: {
    limit: 4,
    maxChars: 2_000,
    maxChunkChars: 600,
    contextDir: resolve(process.cwd(), "../../context"),
    disabled: true,
  },
  workspaceRoot: process.cwd(),
  workspace: {
    id: "workspace-wp1",
    rootPath: process.cwd(),
    contextDir: resolve(process.cwd(), "../../context"),
    sessionPrefix: "ws:workspace-wp1:",
    logicalSessionId: "experience-smoke",
    sessionId: "ws:workspace-wp1:experience-smoke",
  },
  experienceStore: memory,
  tools: createBuiltinRegistry(),
  toolsEnabled: true,
  toolsMaxSteps: 3,
};

const sessionId = "ws:workspace-wp1:experience-smoke";
const orchestrator = new Orchestrator(config, {
  local: model,
  frontier: model,
});

try {
  const result = await orchestrator.handle("Inspect the workspace.", {
    sessionId,
    interactionMode: "neutral",
    experienceSource: { type: "smoke", ref: "turn-1" },
  });

  assert(result.reply === "The workspace listing was inspected.", "final reply");
  assert(result.experiences?.input, "input experience id");
  assert(result.experiences.output, "output experience id");
  assert(result.experiences.toolCalls.length === 1, "one tool-call experience");
  assert(result.experiences.toolResults.length === 1, "one tool-result experience");

  const history = await memory.getHistory(sessionId);
  assert(history.length === 2, "only source user/final assistant enter chat history");
  assert(history[0]?.content === "Inspect the workspace.", "exact user source");
  assert(history[1]?.content === result.reply, "exact assistant source");
  const historyRecords = await memory.getHistoryRecords(sessionId);
  assert(
    historyRecords[0]?.experienceId === result.experiences.input &&
      historyRecords[1]?.experienceId === result.experiences.output,
    "history compatibility rows retain their exact experience ids"
  );

  const captureSourceRef = conversationSourceRef(
    sessionId,
    result.experiences.input,
    [
      result.experiences.input,
      ...result.experiences.toolResults,
      result.experiences.output,
    ]
  );
  assert(
    conversationExperienceIds(captureSourceRef).length === 3,
    "knowledge capture source reference retains exact experience ids"
  );

  let createdEvent: KnowledgeEvent | undefined;
  const captureStore = {
    async listProposals() {
      return [];
    },
    async resolveCanonical() {
      return null;
    },
    async findNodes() {
      return [];
    },
    async createEvent(input: {
      sourceType: KnowledgeEvent["sourceType"];
      sourceRef: string;
      model?: string;
      inputHash?: string;
    }) {
      createdEvent = {
        id: "capture-event",
        ...input,
        createdAt: Date.now(),
      };
      return createdEvent;
    },
    async addProposals(
      eventId: string,
      items: Array<{
        kind: KnowledgeProposal["kind"];
        payload: Record<string, unknown>;
      }>
    ) {
      return items.map((item, index) => ({
        id: `proposal-${index}`,
        eventId,
        kind: item.kind,
        payload: item.payload,
        status: "pending" as const,
        createdAt: Date.now(),
      }));
    },
  } as unknown as KnowledgeStore;
  const capture = await captureConversationSegment({
    store: captureStore,
    sessionId,
    force: true,
    experienceIds: [result.experiences.input, result.experiences.output],
    messages: [
      { role: "user", content: "Copper loss increases winding temperature." },
      { role: "assistant", content: "That is a testable technical claim." },
    ],
    complete: async () =>
      JSON.stringify({
        concepts: [{ label: "copper loss" }],
        claims: [],
        relations: [],
        assumptions: [],
        openQuestions: [],
      }),
  });
  assert(capture.proposals.length === 1, "capture creates a pending proposal");
  assert(createdEvent, "capture creates a provenance event");
  assert(
    conversationExperienceIds(createdEvent.sourceRef).join(",") ===
      [result.experiences.input, result.experiences.output].join(","),
    "proposal event traces to the exact source experiences"
  );

  const toolResultId = result.experiences.toolResults[0]!;
  const toolResult = await memory.getExperience(toolResultId);
  assert(toolResult?.kind === "tool_result", "tool result has durable kind");
  assert(
    toolResult.content === result.toolSteps?.[0]?.result.output,
    "durable tool result is the exact output used by the model"
  );
  assert(
    toolResult.parentExperienceIds[0] === result.experiences.toolCalls[0],
    "tool result points to its exact call"
  );

  const correction = await memory.recordExperience({
    kind: "human_correction",
    sessionId,
    workspaceId: "workspace-wp1",
    content: "The inspected directory was the package root, not the repo root.",
    source: { type: "human" },
    parentExperienceIds: [result.experiences.output],
  });
  assert(correction.kind === "human_correction", "correction supported");

  const external = await memory.recordExperience({
    kind: "external_observation",
    payloadRef: "file:///private/large-observation.bin",
    source: { type: "file", ref: "large-observation.bin" },
  });
  assert(!external.sessionId, "project/session container is optional");
  assert(external.payloadRef?.startsWith("file:"), "external payload pointer");

  memory.close();
  const reopened = createMemory({ dbPath });
  try {
    const restartedHistory = await reopened.getHistory(sessionId);
    assert(restartedHistory.length === 2, "conversation survives restart");
    const restartedRecords = await reopened.getHistoryRecords(sessionId);
    assert(
      restartedRecords[0]?.experienceId === result.experiences.input &&
        restartedRecords[1]?.experienceId === result.experiences.output,
      "message-to-experience identities survive restart"
    );
    assert(
      (await reopened.getExperience(toolResultId))?.content === toolResult.content,
      "tool source identity and exact content survive restart"
    );
    assert(
      (await reopened.getExperience(correction.id))?.kind === "human_correction",
      "correction survives restart"
    );
    assert(
      (await reopened.getExperience(external.id))?.payloadRef === external.payloadRef,
      "external source pointer survives restart"
    );
  } finally {
    reopened.close();
  }
} finally {
  orchestrator.close();
  try {
    memory.close();
  } catch {
    // It may already be closed before the restart assertion.
  }
  for (const suffix of ["", "-shm", "-wal"]) {
    if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  }
}

const legacyDbPath = resolve(process.cwd(), "data/_smoke_experience_legacy.db");
for (const suffix of ["", "-shm", "-wal"]) {
  if (existsSync(legacyDbPath + suffix)) rmSync(legacyDbPath + suffix);
}
try {
  const legacyDb = new Database(legacyDbPath);
  legacyDb.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO messages (session_id, role, content, created_at)
    VALUES ('legacy-session', 'user', 'legacy exact message', 1234);
  `);
  legacyDb.close();

  const migrated = createMemory({ dbPath: legacyDbPath });
  const migratedRecord = (await migrated.getHistoryRecords("legacy-session"))[0];
  assert(migratedRecord?.experienceId, "legacy message receives experience id");
  assert(
    (await migrated.getExperience(migratedRecord.experienceId))?.content ===
      "legacy exact message",
    "legacy message is backfilled as an exact experience"
  );
  const stableId = migratedRecord.experienceId;
  migrated.close();

  const migratedAgain = createMemory({ dbPath: legacyDbPath });
  assert(
    (await migratedAgain.getHistoryRecords("legacy-session"))[0]?.experienceId ===
      stableId,
    "legacy backfilled experience id remains stable across restart"
  );
  migratedAgain.close();
} finally {
  for (const suffix of ["", "-shm", "-wal"]) {
    if (existsSync(legacyDbPath + suffix)) rmSync(legacyDbPath + suffix);
  }
}

console.log("All durable-experience WP1 smoke checks passed.");
