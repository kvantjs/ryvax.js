import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BuildBackend, BuildContext, BuildEntry, BuildOutput } from '../types.js';

export const rolldownBackend: BuildBackend = {
  name: 'rolldown',
  async build(context: BuildContext, entry: BuildEntry, outfile: string): Promise<BuildOutput> {
    let rolldown: typeof import('rolldown');
    try {
      rolldown = await import('rolldown');
    } catch (error) {
      throw new Error(`Rolldown backend selected but the rolldown package is unavailable. Install rolldown or use --builder=esbuild. ${error instanceof Error ? error.message : String(error)}`);
    }
    await mkdir(dirname(outfile), { recursive: true });
    const bundle = await rolldown.rolldown({
      input: entry.file,
      platform: context.target === 'browser' || context.target === 'worker' ? 'browser' : 'node',
      external: context.target === 'browser' ? undefined : [/^node:/, /^[^./]/]
    });
    await bundle.write({
      file: outfile,
      format: 'esm',
      sourcemap: context.options.sourcemap ?? context.mode === 'development',
      minify: context.options.minify ?? context.mode === 'production'
    });
    return { file: outfile, backend: 'rolldown', entry };
  }
};
