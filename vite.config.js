import { defineConfig } from 'vite';

const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const defaultBasePath = isGitHubActions ? './' : '/';
const basePath = process.env.VITE_BASE_PATH ?? defaultBasePath;

export default defineConfig({
  base: basePath,
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
