import {
  importSqliteKnowledge,
  resolveKnowledgeDbPath,
  resolvePostgresKnowledgeConfig,
} from "@workflows/knowledge";

async function main(): Promise<void> {
  const sqliteDbPath = resolveKnowledgeDbPath();
  const result = await importSqliteKnowledge({
    sqliteDbPath,
    postgresConfig: resolvePostgresKnowledgeConfig(),
  });
  console.log(JSON.stringify({ sqliteDbPath, imported: result }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
