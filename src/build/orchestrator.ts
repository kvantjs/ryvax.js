import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { analyzeProjectComplexity } from './complexity.js';
import { createModuleGraph, serializeModuleGraph } from './graph.js';
import { esbuildBackend } from './backends/esbuild.js';
import { rolldownBackend } from './backends/rolldown.js';
import type { BuildBackend, BuildContext, BuildEntry, BuildOutput, BuildProfile, RyvaxBuilderName, RyvaxBuildTarget } from './types.js';
import type { BuildOptions } from '../types.js';

const backends: Record<Exclude<RyvaxBuilderName, 'auto'>, BuildBackend> = { esbuild: esbuildBackend, rolldown: rolldownBackend };
const complexityCache = new WeakMap<BuildOptions, Awaited<ReturnType<typeof analyzeProjectComplexity>>>();

export async function createBuildOrchestrator(options: BuildOptions, entryCount: number): Promise<{
  backend: Exclude<RyvaxBuilderName, 'auto'>;
  complexity: Awaited<ReturnType<typeof analyzeProjectComplexity>>;
  profile: BuildProfile;
  build(entry: BuildEntry, outfile: string, target?: RyvaxBuildTarget): Promise<BuildOutput>;
}> {
  const started = performance.now();
  let complexity = complexityCache.get(options);
  if (!complexity) {
    complexity = await analyzeProjectComplexity(options, entryCount);
    complexityCache.set(options, complexity);
  }
  const requested = options.builder ?? (process.env.RYVAX_BUILDER as RyvaxBuilderName | undefined) ?? 'auto';
  if (!['auto', 'esbuild', 'rolldown'].includes(requested)) throw new Error(`Unknown Ryvax builder '${requested}'. Use auto, esbuild, or rolldown.`);
  const backend = requested === 'auto' ? complexity.selected : requested;
  const profile: BuildProfile = {
    backend,
    complexity,
    startedAt: new Date().toISOString(),
    durationMs: 0
  };
  return {
    backend,
    complexity,
    profile,
    async build(entry, outfile, target = entry.kind === 'client' ? 'browser' : 'node') {
      const graph = await createModuleGraph(options.rootDir, [entry.file]);
      const context: BuildContext = { rootDir: resolve(options.rootDir), mode: options.mode ?? 'development', target, entries: [entry], options, graph };
      await fs.mkdir(dirname(outfile), { recursive: true });
      const result = await backends[backend].build(context, entry, outfile);
      const outDir = resolve(options.rootDir, options.outDir ?? '.meu');
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(resolve(outDir, 'module-graph.json'), serializeModuleGraph(graph));
      if (result.manifest) await fs.writeFile(resolve(outDir, 'build-manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n');
      profile.durationMs = Number((performance.now() - started).toFixed(3));
      if (options.profile) {
        const profileFile = resolve(options.rootDir, options.outDir ?? '.meu', 'build-profile.json');
        await fs.mkdir(dirname(profileFile), { recursive: true });
        await fs.writeFile(profileFile, JSON.stringify(profile, null, 2) + '\n');
      }
      return result;
    }
  };
}

export function formatBuildSelection(backend: Exclude<RyvaxBuilderName, 'auto'>, complexity: Awaited<ReturnType<typeof analyzeProjectComplexity>>): string {
  return `builder=${backend} ${complexity.reason}`;
}
