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
  resolveKnowledgeDbPath,
  hashInput,
} from "./knowledge.js";
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
