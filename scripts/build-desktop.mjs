import { build } from 'esbuild';
await build({
  entryPoints: ['src/desktop/main.ts'],
  outfile: 'dist-desktop/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: false,
});
await build({
  entryPoints: ['src/desktop/preload.ts'],
  outfile: 'dist-desktop/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
});
