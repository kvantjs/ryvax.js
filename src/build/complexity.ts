import { promises as fs } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { BuildOptions } from '../types.js';
import type { ComplexityReport, RyvaxBuilderName } from './types.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);

export async function analyzeProjectComplexity(options: BuildOptions, entryCount: number): Promise<ComplexityReport> {
  const rootDir = resolve(options.rootDir);
  let sourceFiles = 0;
  let dynamicImports = 0;
  const external = new Set<string>();
  async function visit(directory: string): Promise<void> {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === '.meu' || entry.name.startsWith('.ryvax-') || entry.name.startsWith('.') && entry.name !== '.env') continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
        sourceFiles += 1;
        const source = await fs.readFile(file, 'utf8').catch(() => '');
        dynamicImports += (source.match(/\bimport\s*\(/g) ?? []).length;
        for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^.'"/][^'"/]*)/g)) {
          const dependency = match[1];
          if (dependency) external.add(dependency);
        }
      }
    }
  }
  await visit(rootDir);
  let workspace = false;
  try {
    const packageJson = JSON.parse(await fs.readFile(join(rootDir, 'package.json'), 'utf8')) as { workspaces?: unknown };
    workspace = Boolean(packageJson.workspaces);
  } catch { /* optional */ }
  const score = sourceFiles + external.size * 4 + dynamicImports * 8 + entryCount * 6 + (workspace ? 30 : 0);
  const selected: Exclude<RyvaxBuilderName, 'auto'> = score >= 120 || dynamicImports >= 5 || entryCount >= 8 ? 'rolldown' : 'esbuild';
  const reason = selected === 'rolldown'
    ? `complexity score=${score} (modules=${sourceFiles}, externals=${external.size}, dynamicImports=${dynamicImports}, entries=${entryCount}, workspace=${workspace})`
    : `small graph score=${score} (modules=${sourceFiles}, externals=${external.size}, dynamicImports=${dynamicImports}, entries=${entryCount})`;
  return { sourceFiles, externalDependencies: external.size, dynamicImports, entryCount, workspace, score, selected, reason };
}
