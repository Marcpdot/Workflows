/**
 * Offline smoke for Milestone 3A long-term memory.
 * Uses a temp DB path and deletes it after.
 */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createLongTermMemory } from "@workflows/memory/longterm";

async function main(): Promise<void> {
  const dbPath = resolve(
    process.cwd(),
    "data",
    `_smoke_longterm_${Date.now()}.db`
  );

  const ltm = createLongTermMemory({ dbPath });

  try {
    // 1. remember + recall by key
    const a = await ltm.remember({
      content: "Preferred name is Ada",
      key: "user.preferred_name",
      tags: ["profile"],
      source: "user",
    });
    if (!a.id || a.key !== "user.preferred_name") {
      throw new Error("remember key failed");
    }
    const byKey = await ltm.recall({ key: "user.preferred_name" });
    if (byKey.length !== 1 || !byKey[0]!.content.includes("Ada")) {
      throw new Error("recall by key failed");
    }
    console.log("OK: remember + recall by key");

    // 2. remember without key + recall by text
    await ltm.remember({
      content: "Project Workflows uses Ollama locally",
      tags: ["project"],
    });
    const byText = await ltm.recall({ text: "Ollama", limit: 10 });
    if (!byText.some((f) => f.content.includes("Ollama"))) {
      throw new Error("recall by text failed");
    }
    console.log("OK: remember without key + recall by text");

    // 3. upsert same key updates content
    const updated = await ltm.remember({
      content: "Preferred name is Ada Lovelace",
      key: "user.preferred_name",
    });
    if (updated.id !== a.id) {
      throw new Error("upsert should keep same id");
    }
    if (!updated.content.includes("Lovelace")) {
      throw new Error("upsert content not updated");
    }
    const again = await ltm.recall({ key: "user.preferred_name" });
    if (again.length !== 1 || !again[0]!.content.includes("Lovelace")) {
      throw new Error("upsert recall mismatch");
    }
    console.log("OK: upsert by key");

    // 4. list
    const listed = await ltm.list(10);
    if (listed.length < 2) throw new Error("list expected >= 2 facts");
    console.log(`OK: list (${listed.length})`);

    // 5. forget
    const forgotKey = await ltm.forget("user.preferred_name");
    if (!forgotKey) throw new Error("forget by key failed");
    const after = await ltm.recall({ key: "user.preferred_name" });
    if (after.length !== 0) throw new Error("fact still present after forget");

    const noKey = listed.find((f) => !f.key);
    if (noKey) {
      const forgotId = await ltm.forget(noKey.id);
      if (!forgotId) throw new Error("forget by id failed");
    }
    console.log("OK: forget");

    // tag filter
    await ltm.remember({
      content: "Tagged only",
      key: "tmp.tag",
      tags: ["x"],
    });
    const tagged = await ltm.recall({ text: "Tagged", tags: ["x"] });
    if (tagged.length !== 1) throw new Error("tag filter failed");
    await ltm.forget("tmp.tag");
    console.log("OK: tag filter");

    console.log("All long-term memory smoke checks passed.");
  } finally {
    ltm.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) {
        try {
          rmSync(p, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
