import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Identidade deste build. O bundle e o `version.json` usam o mesmo valor. */
const appVersion = new Date().toISOString()

function versionManifest(version: string): Plugin {
  return {
    name: 'telinha-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version })}\n`,
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), versionManifest(appVersion)],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: true,
  },
})
