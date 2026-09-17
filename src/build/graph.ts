import { promises as fs } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const IMPORT_RE = /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+(?:[^'";]+?\s+from\s+)?)['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export interface ModuleGraphNode {
  id: string;
  file: string;
  imports: string[];
  dynamicImports: string[];
  hash: string;
  mtimeMs: number;
}

export interface ModuleGraph {
  rootDir: string;
  nodes: Map<string, ModuleGraphNode>;
  entries: string[];
  createdAt: string;
}

function isBareSpecifier(value: string): boolean {
  return !value.startsWith('.') && !value.startsWith('/') && !value.startsWith('node:');
}

async function resolveLocalImport(importer: string, specifier: string): Promise<string | undefined> {
  if (isBareSpecifier(specifier)) return undefined;
  const base = resolve(dirname(importer), specifier);
  const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map((extension) => `${base}${extension}`), ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((name) => resolve(base, name))];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile() && SOURCE_EXTENSIONS.has(extname(candidate))) return candidate;
    } catch { /* unresolved optional import */ }
  }
  return undefined;
}

export async function createModuleGraph(rootDir: string, entries: string[]): Promise<ModuleGraph> {
  const resolvedRoot = resolve(rootDir);
  const nodes = new Map<string, ModuleGraphNode>();
  const visit = async (file: string): Promise<void> => {
    const absolute = resolve(file);
    if (nodes.has(absolute)) return;
    const source = await fs.readFile(absolute, 'utf8');
    const stat = await fs.stat(absolute);
    const imports: string[] = [];
    const dependencyFiles: string[] = [];
    const dynamicImports: string[] = [];
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      if (match[2]) dynamicImports.push(specifier);
      const local = await resolveLocalImport(absolute, specifier);
      if (local) {
        dependencyFiles.push(local);
        if (!match[2]) imports.push(local);
      }
    }
    const hash = createHash('sha256').update(source).update(JSON.stringify(imports)).digest('hex');
    nodes.set(absolute, { id: absolute.slice(resolvedRoot.length + 1), file: absolute, imports: [...new Set(imports)], dynamicImports: [...new Set(dynamicImports)], hash, mtimeMs: stat.mtimeMs });
    for (const dependency of dependencyFiles) await visit(dependency);
  };
  for (const entry of entries) await visit(entry);
  return { rootDir: resolvedRoot, nodes, entries: entries.map((entry) => resolve(entry)), createdAt: new Date().toISOString() };
}

export function invalidateModuleGraph(graph: ModuleGraph, changedFiles: Iterable<string>): Set<string> {
  const changed = new Set([...changedFiles].map((file) => resolve(file)));
  const affected = new Set(changed);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of graph.nodes.values()) {
      if (affected.has(node.file)) continue;
      if (node.imports.some((dependency) => affected.has(dependency))) {
        affected.add(node.file);
        expanded = true;
      }
    }
  }
  return affected;
}

export function serializeModuleGraph(graph: ModuleGraph): string {
  return JSON.stringify({ rootDir: graph.rootDir, entries: graph.entries, createdAt: graph.createdAt, nodes: [...graph.nodes.values()] }, null, 2) + '\n';
}
