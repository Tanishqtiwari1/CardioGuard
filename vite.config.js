import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset paths in production builds. GitHub Pages serves the Actions artifact
// (site root = Frontend/dist, built by .github/workflows/deploy-pages.yml); old links ending
// in /Frontend/dist/ are redirected by Frontend/public/Frontend/dist/index.html.
export default defineConfig(({ command }) => ({
  root: 'Frontend',
  base: command === 'build' ? './' : '/',
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
}));
