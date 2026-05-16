import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173 },
  build: {
    outDir: 'dist',
    // Rollup's default chunking is preferable here: the previous
    // `manualChunks: { react, maps }` config introduced a circular
    // init order with react-leaflet and produced a TDZ error
    // ("Cannot access 'oe' before initialization") in the minified
    // bundle. Source maps stay on so future runtime errors point at
    // real lines.
    sourcemap: true,
  },
});

