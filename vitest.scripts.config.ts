/**
 * Runs one-off scripts under scripts/ with the same module resolution the app
 * uses. Plain `node` cannot execute them: the source imports internal modules
 * without file extensions, which is correct for the bundler and unresolvable
 * for Node's ESM loader. Reusing vitest avoids both adding a runtime
 * dependency and contorting application source to suit a script.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.script.ts'],
    testTimeout: 60_000,
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
