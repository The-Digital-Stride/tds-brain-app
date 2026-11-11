import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The client is a static bundle. The Node server in server/ serves dist/client
// itself, so there is no Vite dev server or proxy in normal use.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist/client', emptyOutDir: true, sourcemap: true },
});
