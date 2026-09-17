import type { BuildOptions } from '../types.js';
import type { ModuleGraph } from './graph.js';

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
  graph?: ModuleGraph;
}

export interface BuildArtifact {
  file: string;
  kind: 'entry' | 'chunk' | 'asset' | 'sourcemap';
  entryId?: string;
  bytes?: number;
}

export interface BuildManifest {
  schemaVersion: 1;
  backend: Exclude<RyvaxBuilderName, 'auto'>;
  target: RyvaxBuildTarget;
  mode: BuildContext['mode'];
  entries: Record<string, string>;
  artifacts: BuildArtifact[];
  generatedAt: string;
}

export interface BuildOutput {
  file: string;
  backend: Exclude<RyvaxBuilderName, 'auto'>;
  entry: BuildEntry;
  artifacts?: BuildArtifact[];
  manifest?: BuildManifest;
}

export interface BuildBackend {
  readonly name: Exclude<RyvaxBuilderName, 'auto'>;
  build(context: BuildContext, entry: BuildEntry, outfile: string): Promise<BuildOutput>;
  buildBatch?(context: BuildContext, entries: BuildEntry[], outDir: string): Promise<BuildOutput[]>;
  compileConfig?(context: BuildContext, configFile: string): Promise<string>;
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
