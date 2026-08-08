export type {
  ContradictionPair,
  ExtractionResult,
  KnowledgeAlias,
  KnowledgeEdge,
  KnowledgeEvent,
  KnowledgeEvidence,
  KnowledgeNode,
  KnowledgeNodeType,
  KnowledgeProposal,
  KnowledgeRelation,
  KnowledgeStatus,
  KnowledgeStore,
  KnowledgeStoreConfig,
  MergeNodesResult,
  ProjectLinkRelation,
  ProjectStatus,
} from "./types.js";
export {
  createKnowledgeStore,
  createSqliteKnowledgeRepository,
  resolveKnowledgeDbPath,
  hashInput,
} from "./knowledge.js";
export type {
  CanonicalKnowledgeRepository,
  GeoJsonGeometry,
  GraphPath,
  GraphRepository,
  GraphTraversalOptions,
  KnowledgeRepositories,
  KnowledgeRepositoryBackend,
  RepositoryHealth,
  SemanticVectorHit,
  SemanticVectorRecord,
  SpatialHit,
  SpatialRecord,
  SpatialRepository,
  VectorRepository,
} from "./storage/contracts.js";
export {
  resolveKnowledgeMigrationsDir,
  resolvePostgresKnowledgeConfig,
  type PostgresKnowledgeConfig,
} from "./postgres/config.js";
export {
  loadKnowledgeMigrations,
  runKnowledgeMigrations,
  type KnowledgeMigration,
  type MigrationResult,
  type PostgresMigrationClient,
  type PostgresQueryResult,
} from "./postgres/migrations.js";
export {
  createKnowledgePostgresPool,
  migratePostgresKnowledge,
} from "./postgres/runtime.js";
export {
  createPostgresCanonicalKnowledgeRepository,
  PostgresCanonicalKnowledgeRepository,
  type PostgresCanonicalRepositoryConfig,
} from "./postgres/repository.js";
export {
  importSqliteKnowledge,
  type SqliteKnowledgeImportOptions,
  type SqliteKnowledgeImportResult,
} from "./postgres/importSqlite.js";
export {
  EXTRACTION_SCHEMA,
  extractionToProposalItems,
  applyExtractionResult,
  runExtraction,
} from "./extract.js";
export {
  formatNeighborhood,
  simpleQueryTokens,
} from "./formatNeighborhood.js";
export { createKnowledgeTools } from "./tools.js";
export { buildKnowledgeInjectBlock } from "./inject.js";
export {
  ingestText,
  ingestFile,
  heuristicExtract,
  filterDuplicateNodeProposals,
  formatChatSegment,
  type IngestTextInput,
  type IngestFileInput,
  type IngestResult,
} from "./ingest.js";
export { normalizeLabel, labelsMatch } from "./identity.js";
export {
  FIRST_PRINCIPLES_STEPS,
  FIRST_PRINCIPLES_SCHEMA,
  heuristicFirstPrinciples,
  firstPrinciplesToExtraction,
  runFirstPrinciplesAnalysis,
  type FirstPrinciplesResult,
  type RunFirstPrinciplesInput,
  type RunFirstPrinciplesOutput,
} from "./firstPrinciples.js";
export {
  createKnowledgeReader,
  toNodeDto,
  toEdgeDto,
  type KnowledgeReader,
  type KnowledgeNodeDto,
  type KnowledgeEdgeDto,
  type NeighborhoodRead,
  type SubgraphRead,
  type SearchRead,
  type ContradictionsRead,
  type ProposalsRead,
} from "./read.js";
export {
  renderNodeTable,
  renderNodeList,
  renderSubgraph,
  renderNeighborhoodRead,
  renderSearchRead,
  renderProjectStatusReport,
  renderContradictionsRead,
  renderKnowledgeBrowseHtml,
} from "./render.js";
export {
  captureConversationSegment,
  proposalToSummary,
  listPendingForSession,
  conversationSourceRef,
  type CaptureConversationInput,
  type CaptureConversationResult,
  type KnowledgeProposalSummary,
} from "./capture.js";
export {
  conversationHeuristicExtract,
  isLowSubstanceUserMessage,
  rankAndCapItems,
  scoreProposalItem,
  type LimitKind,
} from "./conversationExtract.js";
export {
  STRUCTURED_CAPTURE_SCHEMA,
  extractStructuredConversation,
  normalizeStructuredCapture,
  type NormalizedCapture,
} from "./structuredCapture.js";
