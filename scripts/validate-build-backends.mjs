import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProject } from '../dist/src/compiler.js';

const root = await mkdtemp(join(tmpdir(), 'ryvax-build-backends-'));
try {
  await mkdir(join(root, 'pages', 'api'), { recursive: true });
  await writeFile(join(root, 'pages', 'index.ts'), 'export default () => "<html><body><h1>Ryvax backend fixture</h1></body></html>";\n');
  await writeFile(join(root, 'pages', 'api', 'health.ts'), 'export const GET = () => ({ json: { ok: true } });\n');
  for (const builder of ['esbuild', 'auto', 'rolldown']) {
    const outDir = `.meu-${builder}`;
    const manifest = await buildProject({ rootDir: root, outDir, mode: 'production', builder, minify: true, sourcemap: false });
    const output = await readFile(join(root, outDir, 'routes', `${manifest.routes[0].id.replaceAll(':', '_').replaceAll('/', '_')}-${'unused'}.mjs`), 'utf8').catch(() => '');
    if (manifest.routes.length !== 2) throw new Error(`${builder}: expected 2 routes, received ${manifest.routes.length}`);
    if (!manifest.routes.every((route) => route.bundle.endsWith('.mjs'))) throw new Error(`${builder}: invalid route output`);
    console.log(`${builder}: ok (${manifest.routes.length} routes)`);
    void output;
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
