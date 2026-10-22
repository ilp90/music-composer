// Bundles the API (including the TypeScript-source @mc/shared package) into a single ESM file for the container image.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Native addon: can't be bundled; installed alongside dist/ in the container image.
  external: ['bcrypt'],
  // Some bundled dependencies are CommonJS and call require(); give them one in ESM output.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
