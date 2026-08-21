/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ORCHESTRATOR_URL?: string;
  readonly VITE_INTEGRATION_HTTP_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
