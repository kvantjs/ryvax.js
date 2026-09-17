import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createModuleGraph, invalidateModuleGraph } from '../src/build/graph.js';

test('module graph tracks local imports and dynamic imports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-graph-'));
  try {
    await writeFile(join(root, 'entry.ts'), "import { value } from './shared.js'; export const result = value; export const load = () => import('./lazy.js');\n");
    await writeFile(join(root, 'shared.js'), 'export const value = 42;\n');
    await writeFile(join(root, 'lazy.js'), 'export const lazy = true;\n');
    const graph = await createModuleGraph(root, [join(root, 'entry.ts')]);
    const entry = graph.nodes.get(join(root, 'entry.ts'));
    assert.ok(entry);
    assert.deepEqual(entry.imports, [join(root, 'shared.js')]);
    assert.deepEqual(entry.dynamicImports, ['./lazy.js']);
    assert.equal(graph.nodes.size, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('module graph invalidation propagates to importers', () => {
  const graph = {
    rootDir: '/tmp/project',
    entries: ['/tmp/project/entry.ts'],
    createdAt: new Date().toISOString(),
    nodes: new Map([
      ['/tmp/project/entry.ts', { id: 'entry.ts', file: '/tmp/project/entry.ts', imports: ['/tmp/project/shared.ts'], dynamicImports: [], hash: 'a', mtimeMs: 1 }],
      ['/tmp/project/shared.ts', { id: 'shared.ts', file: '/tmp/project/shared.ts', imports: ['/tmp/project/base.ts'], dynamicImports: [], hash: 'b', mtimeMs: 1 }],
      ['/tmp/project/base.ts', { id: 'base.ts', file: '/tmp/project/base.ts', imports: [], dynamicImports: [], hash: 'c', mtimeMs: 1 }]
    ])
  };
  assert.deepEqual([...invalidateModuleGraph(graph, ['/tmp/project/base.ts'])].sort(), ['/tmp/project/base.ts', '/tmp/project/entry.ts', '/tmp/project/shared.ts']);
});
