export interface MemoryFact {
  id: string;
  key?: string;
  content: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  source?: string;
}

export interface RememberInput {
  content: string;
  key?: string;
  tags?: string[];
  source?: string;
}

export interface RecallQuery {
  key?: string;
  /** Keyword match on content */
  text?: string;
  tags?: string[];
  limit?: number;
}

export interface LongTermMemory {
  remember(input: RememberInput): Promise<MemoryFact>;
  recall(query: RecallQuery): Promise<MemoryFact[]>;
  list(limit?: number): Promise<MemoryFact[]>;
  forget(idOrKey: string): Promise<boolean>;
  close(): void;
}

export interface LongTermMemoryConfig {
  /** Path to SQLite file (created if missing). Parent dirs created. */
  dbPath: string;
}

export interface LongTermSettings {
  dbPath: string;
  /** When true, top recall hits may be injected into handle() system prompt */
  autoInject: boolean;
  injectMaxChars: number;
  injectLimit: number;
}
