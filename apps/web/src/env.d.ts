interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SESSION_DURATION_SECONDS?: string;
  readonly VITE_SOMNIA_INDEXER_URL?: string;
  readonly VITE_SOMNIA_RPC_URL?: string;
  readonly VITE_SOMNIA_WS_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
