import { promises as fs } from 'node:fs';
import { brotliCompress, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { buildProject, loadManifest } from './compiler.js';
import { createProjectGraph, diagnoseManifest } from './introspection.js';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

export interface BundleMeasurement {
  file: string;
  kind: 'server' | 'client' | 'action';
  bytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

export interface ProjectBenchmark {
  schemaVersion: 2;
  framework: 'ryvax';
  node: string;
  mode: 'production';
  rootDir: string;
  buildMs: number;
  routeCount: number;
  bundleCount: number;
  bundleBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  clientBytes: number;
  serverBytes: number;
  clientBundleCount: number;
  zeroClientJsRoutes: number;
  bundles: BundleMeasurement[];
  graph: ReturnType<typeof createProjectGraph>;
  diagnostics: ReturnType<typeof diagnoseManifest>;
}

async function measure(file: string, kind: BundleMeasurement['kind']): Promise<BundleMeasurement> {
  const content = await fs.readFile(file);
  const [compressedGzip, compressedBrotli] = await Promise.all([gzipAsync(content), brotliAsync(content)]);
  return { file, kind, bytes: content.byteLength, gzipBytes: compressedGzip.byteLength, brotliBytes: compressedBrotli.byteLength };
}

async function collectMeasurements(manifest: Awaited<ReturnType<typeof buildProject>>): Promise<BundleMeasurement[]> {
  const entries = [
    ...manifest.routes.map((route) => ({ file: route.bundle, kind: 'server' as const })),
    ...(manifest.actions ?? []).map((action) => ({ file: action.bundle, kind: 'action' as const })),
    ...(manifest.client ? [{ file: manifest.client.entry, kind: 'client' as const }] : [])
  ];
  return Promise.all(entries.map(({ file, kind }) => measure(file, kind)));
}

async function createReport(rootDir: string, manifest: Awaited<ReturnType<typeof buildProject>>, buildMs: number): Promise<ProjectBenchmark> {
  const bundles = await collectMeasurements(manifest);
  const clientRoutes = manifest.client ? 0 : manifest.routes.filter((route) => route.kind !== 'api').length;
  return {
    schemaVersion: 2,
    framework: 'ryvax',
    node: process.version,
    mode: 'production',
    rootDir: resolve(rootDir),
    buildMs,
    routeCount: manifest.routes.length,
    bundleCount: bundles.length,
    bundleBytes: bundles.reduce((sum, bundle) => sum + bundle.bytes, 0),
    gzipBytes: bundles.reduce((sum, bundle) => sum + bundle.gzipBytes, 0),
    brotliBytes: bundles.reduce((sum, bundle) => sum + bundle.brotliBytes, 0),
    clientBytes: bundles.filter((bundle) => bundle.kind === 'client').reduce((sum, bundle) => sum + bundle.bytes, 0),
    serverBytes: bundles.filter((bundle) => bundle.kind !== 'client').reduce((sum, bundle) => sum + bundle.bytes, 0),
    clientBundleCount: bundles.filter((bundle) => bundle.kind === 'client').length,
    zeroClientJsRoutes: clientRoutes,
    bundles,
    graph: createProjectGraph(manifest, rootDir),
    diagnostics: diagnoseManifest(manifest, rootDir)
  };
}

export async function benchmarkProject(rootDir: string, options: { outDir?: string; minify?: boolean } = {}): Promise<ProjectBenchmark> {
  const started = performance.now();
  const manifest = await buildProject({
    rootDir: resolve(rootDir),
    mode: 'production',
    outDir: options.outDir,
    minify: options.minify ?? true,
    sourcemap: false
  });
  return createReport(rootDir, manifest, Number((performance.now() - started).toFixed(2)));
}

export async function benchmarkManifest(rootDir: string, outDir = '.meu'): Promise<ProjectBenchmark | undefined> {
  try {
    const manifest = await loadManifest(resolve(rootDir), outDir);
    return createReport(rootDir, manifest, 0);
  } catch {
    return undefined;
  }
}
