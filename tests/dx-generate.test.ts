import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { defineConfig } from '../src/define-config.js';
import { generateDxTypes } from '../src/dx-generate.js';

test('defineConfig preserves the supplied configuration at runtime', () => {
  const config = defineConfig({ port: 4310, host: '127.0.0.1' });
  assert.deepEqual(config, { port: 4310, host: '127.0.0.1' });
});

test('generateDxTypes emits deterministic routes and dynamic parameter declarations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-dx-'));
  try {
    await mkdir(join(root, 'pages', 'users'), { recursive: true });
    await mkdir(join(root, 'app', 'dashboard'), { recursive: true });
    await writeFile(join(root, 'pages', 'index.ts'), 'export default () => "home";');
    await writeFile(join(root, 'pages', 'users', '[id].tsx'), 'export default () => "user";');
    await writeFile(join(root, 'app', 'dashboard', 'page.tsx'), 'export default () => "dashboard";');
    await writeFile(join(root, 'app', 'dashboard', 'layout.tsx'), 'export default ({ children }) => children;');
    const first = await generateDxTypes(root);
    const routes = await readFile(first.routesFile, 'utf8');
    assert.match(routes, /"\/"/);
    assert.match(routes, /"\/users\/:id"/);
    assert.match(routes, /UsersIdRouteParams/);
    assert.match(routes, /id: string/);
    const before = routes;
    const second = await generateDxTypes(root);
    assert.equal(await readFile(second.routesFile, 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
