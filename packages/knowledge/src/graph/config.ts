export interface Neo4jGraphConfig {
  uri: string;
  username: string;
  password: string;
  database: string;
}

export function resolveNeo4jGraphConfig(env: NodeJS.ProcessEnv = process.env): Neo4jGraphConfig {
  return {
    uri: env.KNOWLEDGE_NEO4J_URI?.trim() || "bolt://127.0.0.1:57687",
    username: env.KNOWLEDGE_NEO4J_USER?.trim() || "neo4j",
    password: env.KNOWLEDGE_NEO4J_PASSWORD?.trim() || "workflows-knowledge",
    database: env.KNOWLEDGE_NEO4J_DATABASE?.trim() || "neo4j",
  };
}
