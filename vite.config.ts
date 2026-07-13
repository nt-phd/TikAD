import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

const buildDate = new Date().toISOString().slice(0, 10);
const buildPatch = execSync('git rev-list --count HEAD').toString().trim();

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
    __BUILD_PATCH__: JSON.stringify(buildPatch),
  },
});
