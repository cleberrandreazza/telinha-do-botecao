/// <reference types="vite/client" />

/** Versão gravada no bundle. O build também publica o mesmo valor em `/version.json`. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_SIGNAL_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
