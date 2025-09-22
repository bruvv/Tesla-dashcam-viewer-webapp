import { defineConfig } from 'vite';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/').pop();
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const defaultBasePath = repositoryName ? `/${repositoryName}/` : '/';
const basePath = process.env.VITE_BASE_PATH ?? (isGitHubActions ? defaultBasePath : '/');

export default defineConfig({
  base: basePath,
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
