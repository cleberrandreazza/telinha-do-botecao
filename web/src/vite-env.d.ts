/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIGNAL_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
