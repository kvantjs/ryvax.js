import * as esbuild from 'esbuild';
import type { BuildBackend, BuildContext, BuildEntry, BuildOutput } from '../types.js';

export const esbuildBackend: BuildBackend = {
  name: 'esbuild',
  async build(context: BuildContext, entry: BuildEntry, outfile: string): Promise<BuildOutput> {
    const browser = context.target === 'browser' || context.target === 'worker';
    await esbuild.build({
      entryPoints: [entry.file],
      outfile,
      bundle: true,
      platform: browser ? 'browser' : 'node',
      format: 'esm',
      target: browser ? 'es2022' : 'node20',
      jsx: 'automatic',
      jsxImportSource: 'react',
      packages: browser ? undefined : 'external',
      sourcemap: context.options.sourcemap ?? context.mode === 'development',
      minify: context.options.minify ?? context.mode === 'production',
      legalComments: 'none',
      logLevel: 'warning'
    });
    return { file: outfile, backend: 'esbuild', entry };
  }
};
