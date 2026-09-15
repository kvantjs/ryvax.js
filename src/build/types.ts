import type { BuildOptions } from '../types.js';

export type RyvaxBuilderName = 'auto' | 'esbuild' | 'rolldown';
export type RyvaxBuildTarget = 'node' | 'browser' | 'edge' | 'worker';

export interface BuildEntry {
  id: string;
  file: string;
  kind: 'route' | 'client' | 'action' | 'worker' | 'edge';
}

export interface BuildContext {
  rootDir: string;
  mode: 'development' | 'production';
  target: RyvaxBuildTarget;
  entries: BuildEntry[];
  options: BuildOptions;
}

export interface BuildOutput {
  file: string;
  backend: Exclude<RyvaxBuilderName, 'auto'>;
  entry: BuildEntry;
}

export interface BuildBackend {
  readonly name: Exclude<RyvaxBuilderName, 'auto'>;
  build(context: BuildContext, entry: BuildEntry, outfile: string): Promise<BuildOutput>;
}

export interface ComplexityReport {
  sourceFiles: number;
  externalDependencies: number;
  dynamicImports: number;
  entryCount: number;
  workspace: boolean;
  score: number;
  selected: Exclude<RyvaxBuilderName, 'auto'>;
  reason: string;
}

export interface BuildProfile {
  backend: Exclude<RyvaxBuilderName, 'auto'>;
  complexity: ComplexityReport;
  startedAt: string;
  durationMs: number;
}
