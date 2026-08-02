export type {
  ExtractionResult,
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
