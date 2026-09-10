import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api to the Express process, so the browser sees a
// single origin. That is why the session cookie "just works" in development
// without any CORS or SameSite fiddling. The API also sends CORS headers (see
// server/src/app.js) for the case where the client is served from elsewhere.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
    },
  },
});
