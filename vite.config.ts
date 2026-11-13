import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// The client is a static bundle. The Node server in server/ serves dist/client
// itself, so there is no Vite dev server or proxy in normal use.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  // The page's own version, so it can tell when the server has been updated (client/src/build-version.ts).
  // Left empty under `vite build --watch` (`pnpm dev`): the watcher never re-reads package.json, so a
  // version bump mid-session would otherwise leave the banner stuck on.
  define: { __APP_VERSION__: JSON.stringify(process.argv.includes('--watch') ? '' : version) },
  build: { outDir: '../dist/client', emptyOutDir: true, sourcemap: true },
});
