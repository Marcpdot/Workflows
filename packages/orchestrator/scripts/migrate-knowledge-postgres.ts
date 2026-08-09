import {
  migratePostgresKnowledge,
  resolvePostgresKnowledgeConfig,
} from "@workflows/knowledge";

async function main(): Promise<void> {
  const config = resolvePostgresKnowledgeConfig();
  const result = await migratePostgresKnowledge(config);
  console.log(
    JSON.stringify(
      {
        database: new URL(config.connectionString).host,
        applied: result.applied,
        alreadyApplied: result.alreadyApplied,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
