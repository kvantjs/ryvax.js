import { promises as fs } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, extname, resolve } from 'node:path';

export type ModuleBoundary = 'server' | 'client' | 'shared';

export interface ModuleAnalysis {
  file: string;
  boundary: ModuleBoundary;
  imports: string[];
  /** Local modules reached from this file, including the entry module. */
  dependencies: string[];
  invalidClientImports: string[];
  invalidClientSecrets: string[];
}

export class ModuleBoundaryError extends Error {
  readonly code = 'RYX-2041';
  readonly severity = 'error' as const;
  readonly suggestions: string[];

  constructor(public readonly file: string, public readonly imports: string[], public readonly secrets: string[] = []) {
    const problems = [
      imports.length ? `server-only imports ${imports.join(', ')}` : '',
      secrets.length ? `server secrets ${secrets.join(', ')}` : ''
    ].filter(Boolean).join('; ');
    super(`Invalid Client Component boundary in ${file}: ${problems}. Move server work to a Server Component or expose a validated server action.`);
    this.name = 'ModuleBoundaryError';
    this.suggestions = [
      'Move the server-only dependency behind a server boundary.',
      'Expose only an explicit, validated server function.',
      'Use a public environment variable prefix for values safe to ship to browsers.'
    ];
  }

  toJSON(): { code: string; severity: 'error'; file: string; message: string; suggestions: string[] } {
    return { code: this.code, severity: this.severity, file: this.file, message: this.message, suggestions: this.suggestions };
  }
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const serverOnlyPackages = new Set(['fs', 'fs/promises', 'child_process', 'net', 'tls', 'http', 'https', 'worker_threads', 'module', 'node:fs', 'node:fs/promises', 'node:child_process', 'node:net', 'node:tls', 'node:http', 'node:https', 'node:worker_threads', 'node:module']);

function parseImports(source: string): string[] {
  const values = [
    ...source.matchAll(/\bimport\s+(?:type\s+)?(?:[^'"`]+?\sfrom\s*)?['"]([^'"`]+)['"]/g),
    ...source.matchAll(/\bexport\s+[^'"`]+?\sfrom\s*['"]([^'"`]+)['"]/g),
    ...source.matchAll(/\brequire\(\s*['"]([^'"`]+)['"]\s*\)/g)
  ].map((match) => match[1]).filter((value): value is string => Boolean(value));
  return [...new Set(values)];
}

async function resolveLocalImport(from: string, specifier: string): Promise<string | undefined> {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(from), specifier);
  const sourceBase = /\.(?:js|jsx|mjs|cjs)$/.test(base) ? base.replace(/\.(?:js|jsx|mjs|cjs)$/, '') : base;
  const candidates = [base, sourceBase, ...SOURCE_EXTENSIONS.map((extension) => `${sourceBase}${extension}`), ...SOURCE_EXTENSIONS.map((extension) => resolve(sourceBase, `index${extension}`))];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch { /* unresolved optional import */ }
  }
  return undefined;
}

export async function analyzeModule(file: string): Promise<ModuleAnalysis> {
  const entry = resolve(file);
  const visited = new Set<string>();
  const dependencies: string[] = [];
  const invalidClientImports = new Set<string>();
  const invalidClientSecrets = new Set<string>();
  let entryBoundary: ModuleBoundary = 'shared';

  async function visit(current: string, isEntry = false): Promise<void> {
    const absolute = resolve(current);
    if (visited.has(absolute)) return;
    visited.add(absolute);
    dependencies.push(absolute);
    const source = await fs.readFile(absolute, 'utf8');
    const boundary: ModuleBoundary = /^\s*["']use client["']/.test(source) ? 'client' : /^\s*["']use server["']/.test(source) ? 'server' : 'shared';
    if (isEntry) entryBoundary = boundary;
    const imports = parseImports(source);
    for (const value of imports) {
      if (entryBoundary === 'client' && (builtins.has(value) || serverOnlyPackages.has(value) || value.endsWith('.server') || value.includes('.server.'))) invalidClientImports.add(value);
      const local = await resolveLocalImport(absolute, value);
      if (local) {
        const localSource = await fs.readFile(local, 'utf8');
        if (entryBoundary === 'client' && (/^\s*["']use server["']/.test(localSource) || /(?:^|[./])server(?:[./]|$)/.test(value))) invalidClientImports.add(local);
        await visit(local);
      }
    }
    if (entryBoundary === 'client') {
      for (const name of [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]).filter((value): value is string => Boolean(value))) {
        if (!name.startsWith('PUBLIC_') && !name.startsWith('NEXT_PUBLIC_')) invalidClientSecrets.add(name);
      }
    }
  }

  await visit(entry, true);
  const source = await fs.readFile(entry, 'utf8');
  return {
    file: entry,
    boundary: entryBoundary,
    imports: parseImports(source),
    dependencies,
    invalidClientImports: [...invalidClientImports],
    invalidClientSecrets: [...invalidClientSecrets]
  };
}

export async function assertValidClientModule(file: string): Promise<ModuleAnalysis> {
  const analysis = await analyzeModule(file);
  if (analysis.invalidClientImports.length > 0 || analysis.invalidClientSecrets.length > 0) {
    throw new ModuleBoundaryError(file, analysis.invalidClientImports, analysis.invalidClientSecrets);
  }
  return analysis;
}

export function assertRscSerializable(value: unknown, path = '$'): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (Number.isFinite(value)) return; throw new TypeError(`RSC value at ${path} is not finite`); }
  if (Array.isArray(value)) { value.forEach((item, index) => assertRscSerializable(item, `${path}[${index}]`)); return; }
  if (typeof value === 'object') { for (const [key, item] of Object.entries(value as Record<string, unknown>)) assertRscSerializable(item, `${path}.${key}`); return; }
  throw new TypeError(`RSC value at ${path} is not serializable`);
}
