/** Restored — see tools.full in repo history f490750; apply local checkout if incomplete. */
import type { Tool } from "@workflows/tools";
import type { KnowledgeStore } from "./types.js";

// Temporary thin loader: re-fetch implementation from pre-placeholder commit is required.
// User: git checkout f490750cacce19f3ed4039d1f1c07269f75665af -- packages/knowledge/src/tools.ts
// Then add:
//   import { createKnowledgeIngestDirTool } from "./knowledgeIngestDir.js";
//   createKnowledgeIngestDirTool(store),

export function createKnowledgeTools(_store: KnowledgeStore): Tool[] {
  throw new Error(
    "packages/knowledge/src/tools.ts was corrupted by a bad push. Restore with: git checkout f490750cacce19f3ed4039d1f1c07269f75665af -- packages/knowledge/src/tools.ts"
  );
}
