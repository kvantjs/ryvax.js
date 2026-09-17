import * as esbuild from 'esbuild';
import { promises as fs } from 'node:fs';
import type { BuildArtifact, BuildBackend, BuildContext, BuildEntry, BuildOutput } from '../types.js';

function targetOptions(context: BuildContext): { platform: 'browser' | 'node'; target: string } {
  const browser = context.target === 'browser' || context.target === 'worker' || context.target === 'edge';
  return { platform: browser ? 'browser' : 'node', target: browser ? 'es2022' : 'node20' };
}

export const esbuildBackend: BuildBackend = {
  name: 'esbuild',
  async build(context: BuildContext, entry: BuildEntry, outfile: string): Promise<BuildOutput> {
    const target = targetOptions(context);
    await esbuild.build({
      entryPoints: [entry.file],
      outfile,
      bundle: true,
      platform: target.platform,
      format: 'esm',
      target: target.target,
      jsx: 'automatic',
      jsxImportSource: 'react',
      packages: target.platform === 'browser' ? undefined : 'external',
      sourcemap: context.options.sourcemap ?? context.mode === 'development',
      minify: context.options.minify ?? context.mode === 'production',
      metafile: true,
      legalComments: 'none',
      logLevel: 'warning'
    });
    const stat = await fs.stat(outfile);
    const artifacts: BuildArtifact[] = [{ file: outfile, kind: 'entry', entryId: entry.id, bytes: stat.size }];
    if (context.options.sourcemap ?? context.mode === 'development') artifacts.push({ file: `${outfile}.map`, kind: 'sourcemap' as const, entryId: entry.id });
    return { file: outfile, backend: 'esbuild', entry, artifacts, manifest: { schemaVersion: 1, backend: 'esbuild', target: context.target, mode: context.mode, entries: { [entry.id]: outfile }, artifacts, generatedAt: new Date().toISOString() } };
  },
  async compileConfig(context, configFile): Promise<string> {
    const result = await esbuild.build({ entryPoints: [configFile], bundle: true, platform: 'node', format: 'esm', target: 'node20', packages: 'external', write: false, logLevel: 'silent' });
    return result.outputFiles[0]?.text ?? '';
  }
};
