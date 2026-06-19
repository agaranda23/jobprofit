import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// https://vite.dev/config/

/**
 * injectSwCacheId — Vite closeBundle plugin
 *
 * After Vite writes dist/, reads dist/index.html (which contains Vite's
 * content-hashed asset filenames), takes the first 8 hex chars of its
 * SHA-256, and replaces the __BUILD_ID__ placeholder in dist/sw.js.
 *
 * Result: the SW cache name changes iff the built output changes.
 * No manual version bumps needed or safe — see feat/sw-cache-autoversion.
 *
 * In `vite dev` this hook is never called (dev server doesn't write dist/),
 * so public/sw.js is served verbatim with the placeholder as the cache name
 * — a harmless valid string, not a ReferenceError.
 */
function injectSwCacheId() {
  return {
    name: 'inject-sw-cache-id',
    // closeBundle fires after all output files have been written to dist/
    closeBundle() {
      const outDir = resolve(__dirname, 'dist')
      const swPath = resolve(outDir, 'sw.js')
      const indexPath = resolve(outDir, 'index.html')

      if (!existsSync(swPath)) {
        // sw.js is not in public/ or the build skipped it — nothing to do
        return
      }

      // Derive a content-based id from dist/index.html.
      // index.html references every Vite content-hashed chunk filename, so its
      // own content changes iff any built asset changes.
      let buildId = 'dev'
      if (existsSync(indexPath)) {
        const hash = createHash('sha256')
          .update(readFileSync(indexPath))
          .digest('hex')
        buildId = hash.slice(0, 8)
      }

      const original = readFileSync(swPath, 'utf8')
      if (!original.includes('__BUILD_ID__')) {
        // Already injected (e.g. a second closeBundle call in watch mode) — skip
        return
      }
      const injected = original.replace(/__BUILD_ID__/g, buildId)
      writeFileSync(swPath, injected, 'utf8')

      // Log so the build output makes the injection visible
      console.log(`[injectSwCacheId] CACHE_NAME → jobprofit-${buildId}`)
    },
  }
}

// __dirname is not defined in ESM; derive it from import.meta.url via a small
// workaround that stays compatible with Node 18+.
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), injectSwCacheId()],
})
