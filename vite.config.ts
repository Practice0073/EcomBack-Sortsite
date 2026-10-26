import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'web'),
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'shared') } },
  build: { outDir: path.resolve(import.meta.dirname, 'dist/web'), emptyOutDir: true, sourcemap: true },
});
