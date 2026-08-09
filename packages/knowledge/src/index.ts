export type {
  ContradictionPair,
  ExtractionResult,
  KnowledgeAlias,
  KnowledgeEdge,
  KnowledgeEvent,
  KnowledgeEvidence,
  KnowledgeNode,
  KnowledgeNodeType,
  KnowledgeObservation,
  KnowledgeObservationKind,
  KnowledgeProposal,
  KnowledgeRelation,
  KnowledgeStatus,
  KnowledgeStore,
  MergeNodesResult,
  ProjectLinkRelation,
  ProjectStatus,
} from "./types.js";
export {
  validateCanonicalGraph,
  type CanonicalGraphValidation,
} from "./canonicalGraph.js";
export {
  createKnowledgeStore,
  hashInput,
  type KnowledgeStoreConfig,
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
  createPostgresVectorRepository,
  KNOWLEDGE_VECTOR_DIMENSION,
  PostgresVectorRepository,
  type PostgresVectorRepositoryConfig,
} from "./postgres/vectorRepository.js";
export { createPostgresSpatialRepository, PostgresSpatialRepository, type PostgresSpatialRepositoryConfig } from "./postgres/spatialRepository.js";
export { resolveNeo4jGraphConfig, type Neo4jGraphConfig } from "./graph/config.js";
export { createNeo4jGraphRepository, Neo4jGraphRepository } from "./graph/neo4jRepository.js";
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
  canonicalSemanticText,
  processVectorProjectionOutbox,
  rebuildSemanticVectorProjection,
  semanticVectorRecordId,
  type SemanticEmbeddingProvider,
  type VectorOutboxResult,
  type VectorProjectionResult,
} from "./semanticProjection.js";
export {
  processGraphProjectionOutbox,
  rebuildGraphProjection,
  type GraphOutboxResult,
  type GraphProjectionResult,
} from "./graphProjection.js";
export {
  CanonicalRetrievalUnavailableError,
  createHybridKnowledgeRetrievalService,
  HybridKnowledgeRetrievalService,
  type HybridRetrievalDependencies,
  type HybridRetrievalItem,
  type HybridRetrievalRequest,
  type HybridRetrievalResult,
  type RetrievalOrigin,
  type RetrievalStrategyReport,
  type RetrievalStrategyState,
} from "./hybridRetrieval.js";
export {
  createKnowledgeAgent,
  KnowledgeAgentService,
  KNOWLEDGE_CURATOR_POLICY,
  KNOWLEDGE_NAVIGATOR_POLICY,
  type KnowledgeAgentAuditEvent,
  type KnowledgeAgentAuditor,
  type KnowledgeAgentDecision,
  type KnowledgeAgentDependencies,
  type KnowledgeAgentLimits,
  type KnowledgeAgentMode,
  type KnowledgeAgentModelAdapter,
  type KnowledgeAgentModelInput,
  type KnowledgeAgentOutcome,
  type KnowledgeAgentRunRequest,
  type KnowledgeAgentRunResult,
  type KnowledgeAgentToolResult,
  type KnowledgeAgentToolSchema,
} from "./knowledgeAgent.js";
export {
  STRUCTURED_CAPTURE_SCHEMA,
  extractStructuredConversation,
  normalizeStructuredCapture,
  type NormalizedCapture,
} from "./structuredCapture.js";
