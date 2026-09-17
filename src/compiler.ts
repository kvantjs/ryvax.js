import { promises as fs } from 'node:fs';
import { dirname, extname, basename, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import chokidar, { type FSWatcher } from 'chokidar';
import { fileToRoutePath, sortRoutes } from './router.js';
import { renderPage } from './render.js';
import { stableActionId } from './actions.js';
import { assertValidClientModule } from './rsc.js';
import { PluginRegistry } from './plugins.js';
import { createProjectGraph } from './introspection.js';
import { createBuildOrchestrator, formatBuildSelection } from './build/orchestrator.js';
import type { BuildOptions, PageModule, RequestContext, RouteDefinition, RouteManifest } from './types.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);

export interface WatchHandle {
  watcher: FSWatcher;
  close(): Promise<void>;
}

export async function discoverRouteFiles(rootDir: string): Promise<string[]> {
  const pagesDir = resolve(rootDir, 'pages');
  const appDir = resolve(rootDir, 'app');
  const roots = await Promise.all([pagesDir, appDir].map(async (directory) => {
    try { await fs.access(directory); return directory; } catch { return undefined; }
  }));
  if (!roots.some(Boolean)) throw new Error(`Neither pages/ nor app/ directory found under ${rootDir}`);
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (SOURCE_EXTENSIONS.has(extname(entry.name)) && !entry.name.startsWith('_')) files.push(fullPath);
    }
  }
  for (const root of roots) if (root) await visit(root);
  return files.sort((a, b) => a.localeCompare(b));
}

async function discoverActionFiles(rootDir: string): Promise<string[]> {
  const directory = resolve(rootDir, 'actions');
  try { await fs.access(directory); } catch { return []; }
  const files: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (SOURCE_EXTENSIONS.has(extname(entry.name)) && /['"]use server['"]/.test(await fs.readFile(full, 'utf8'))) files.push(full);
    }
  }
  await visit(directory);
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Builds into a process-unique staging directory and swaps it into place only
 * after every bundle, manifest, and generated page is complete.
 */
export async function buildProject(options: BuildOptions): Promise<RouteManifest> {
  const rootDir = resolve(options.rootDir);
  const outputDir = resolve(rootDir, options.outDir ?? '.meu');
  const stagingDir = join(dirname(outputDir), `.${basename(outputDir)}.build-${process.pid}-${randomUUID()}`);
  const pagesDir = resolve(rootDir, 'pages');
  const mode = options.mode ?? 'development';
  await fs.mkdir(dirname(outputDir), { recursive: true });
  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.mkdir(join(stagingDir, 'routes'), { recursive: true });

  try {
    const sourceFiles = await discoverRouteFiles(rootDir);
    const orchestrator = await createBuildOrchestrator(options, sourceFiles.length);
    options.builder = orchestrator.backend;
    if (options.profile || process.env.RYVAX_VERBOSE_BUILD === 'true') console.log(`Ryvax build: ${formatBuildSelection(orchestrator.backend, orchestrator.complexity)}`);
    for (const file of sourceFiles) {
      const source = await fs.readFile(file, 'utf8');
      if (/^\s*["']use client["']/.test(source)) await assertValidClientModule(file);
    }
    const routes = await Promise.all(sourceFiles.filter((file) => {
      const appRelative = relative(resolve(rootDir, 'app'), file).split(sep).join('/');
      return !appRelative.startsWith('..') && !appRelative.split('/').some((segment) => segment.startsWith('@')) && /(^|\/)(page|route)\.[^.]+$/.test(appRelative) || file.startsWith(pagesDir + sep);
    }).map(async (file): Promise<RouteDefinition> => {
      const isAppRoute = file.startsWith(resolve(rootDir, 'app') + sep);
      const routeRoot = isAppRoute ? resolve(rootDir, 'app') : pagesDir;
      const routeInfo = fileToRoutePath(file, routeRoot);
      const relativeFile = relative(routeRoot, file).split(sep).join('/');
      const kind = isAppRoute ? (basename(file).replace(/\.[^.]+$/, '') === 'route' ? 'api' : 'ssr') : relativeFile.startsWith('api/') ? 'api' : 'ssr';
      const id = `${isAppRoute ? 'app' : 'pages'}:${relativeFile.replace(/\.[^.]+$/, '').replaceAll(sep, '/')}`;
      const bundle = resolve(stagingDir, 'routes', `${slugify(id)}-${stableHash(id)}.mjs`);
      await bundleModule(file, bundle, options, mode);
      const layouts = isAppRoute && kind !== 'api'
        ? await Promise.all((await findLayoutFiles(resolve(rootDir, 'app'), file)).map((layout, index) =>
          bundleModule(layout, resolve(stagingDir, 'layouts', `${slugify(id)}-layout-${index}-${stableHash(layout)}.mjs`), options, mode)))
        : [];
      const errorBoundaryFile = isAppRoute && kind !== 'api' ? await findBoundaryFile(resolve(rootDir, 'app'), file, 'error') : undefined;
      const errorBoundary = errorBoundaryFile
        ? await bundleModule(errorBoundaryFile, resolve(stagingDir, 'boundaries', `${slugify(id)}-error-${stableHash(errorBoundaryFile)}.mjs`), options, mode)
        : undefined;
      const forbiddenFile = isAppRoute && kind !== 'api' ? await findBoundaryFile(resolve(rootDir, 'app'), file, 'forbidden') : undefined;
      const forbiddenBoundary = forbiddenFile
        ? await bundleModule(forbiddenFile, resolve(stagingDir, 'boundaries', `${slugify(id)}-forbidden-${stableHash(forbiddenFile)}.mjs`), options, mode)
        : undefined;
      const unauthorizedFile = isAppRoute && kind !== 'api' ? await findBoundaryFile(resolve(rootDir, 'app'), file, 'unauthorized') : undefined;
      const unauthorizedBoundary = unauthorizedFile
        ? await bundleModule(unauthorizedFile, resolve(stagingDir, 'boundaries', `${slugify(id)}-unauthorized-${stableHash(unauthorizedFile)}.mjs`), options, mode)
        : undefined;
      const loadingFile = isAppRoute && kind !== 'api' ? await findBoundaryFile(resolve(rootDir, 'app'), file, 'loading') : undefined;
      const loadingBoundary = loadingFile
        ? await bundleModule(loadingFile, resolve(stagingDir, 'boundaries', `${slugify(id)}-loading-${stableHash(loadingFile)}.mjs`), options, mode)
        : undefined;
      const slots = isAppRoute && kind !== 'api' ? await bundleSlots(resolve(rootDir, 'app'), file, stagingDir, options, mode, id) : {};
      return {
        id,
        kind,
        pathname: routeInfo.pathname,
        pattern: routeInfo.pathname,
        file: resolve(file),
        bundle,
        segments: routeInfo.segments,
        dynamic: routeInfo.dynamic,
        catchAll: routeInfo.catchAll,
        ...(layouts.length > 0 ? { layouts } : {}),
        ...(errorBoundary ? { errorBoundary } : {}),
        ...(forbiddenBoundary ? { forbiddenBoundary } : {}),
        ...(unauthorizedBoundary ? { unauthorizedBoundary } : {}),
        ...(loadingBoundary ? { loadingBoundary } : {}),
        ...(Object.keys(slots).length > 0 ? { slots } : {})
      };
    }));

    const actionFiles = await discoverActionFiles(rootDir);
    const actions: Array<{ id: string; name: string; bundle: string; exportName: string }> = [];
    for (const file of actionFiles) {
      const source = await fs.readFile(file, 'utf8');
      const exportNames = [...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)]
        .map((match) => match[1]).filter((name): name is string => Boolean(name));
      const bundle = resolve(stagingDir, 'actions', `${stableActionId(file, 'module')}.mjs`);
      await bundleModule(file, bundle, options, mode);
      for (const exportName of exportNames) actions.push({ id: stableActionId(file, exportName), name: exportName, bundle, exportName });
    }
    const clientEntry = await findClientEntry(rootDir);
    const client = clientEntry ? { entry: await buildClient(clientEntry, stagingDir, options) } : undefined;
    const notFoundFile = await findBoundaryFile(resolve(rootDir, 'app'), resolve(rootDir, 'app'), 'not-found');
    const notFound = notFoundFile
      ? await bundleModule(notFoundFile, resolve(stagingDir, 'boundaries', `not-found-${stableHash(notFoundFile)}.mjs`), options, mode)
      : undefined;
    const generatedAt = process.env.SOURCE_DATE_EPOCH
      ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
      : new Date().toISOString();
    const manifest: RouteManifest = {
      generatedAt,
      runtime: options.runtime ?? 'node',
      outputDir,
      capabilities: {
        api: routes.some((route) => route.kind === 'api'),
        ssr: routes.some((route) => route.kind !== 'api'),
        ssg: routes.some((route) => route.kind !== 'api'),
        streaming: true,
        client: Boolean(client)
      },
      routes: sortRoutes(routes),
      ...(client ? { client } : {}),
      ...(actions.length > 0 ? { actions } : {}),
      ...(notFound ? { notFound } : {})
    };
    manifest.graph = createProjectGraph(manifest, rootDir);
    if (options.plugins?.length) {
      const plugins = new PluginRegistry();
      for (const plugin of options.plugins) plugins.register(plugin);
      await plugins.setup({ rootDir, manifest, capabilities: ['routes', 'actions', 'observability'] });
      const transformed = await plugins.onBuild(manifest, { rootDir, manifest, capabilities: ['routes', 'actions', 'observability'] });
      if (transformed && typeof transformed === 'object') Object.assign(manifest, transformed);
      await plugins.close();
    }
    await fs.writeFile(join(stagingDir, 'routes.d.ts'), generateRouteTypes(manifest));
    await generateStaticPages(manifest, stagingDir, mode);
    const portableManifest = rebaseManifest(manifest, stagingDir, outputDir);
    await fs.writeFile(join(stagingDir, 'manifest.json'), JSON.stringify(portableManifest, null, 2) + '\n');
    await replaceDirectory(stagingDir, outputDir);
    return portableManifest;
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

export async function exportStaticSite(rootDir: string, outDir = 'dist'): Promise<string> {
  const root = resolve(rootDir);
  const target = resolve(root, outDir);
  const buildDir = join(root, `.ryvax-export-${process.pid}-${randomUUID()}`);
  try {
    const manifest = await buildProject({ rootDir: root, outDir: buildDir, mode: 'production', minify: true, sourcemap: false });
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(target, { recursive: true });
    await copyDirectoryIfExists(join(buildDir, 'static'), target);
    await copyDirectoryIfExists(join(root, 'public'), target);
    await fs.writeFile(join(target, 'manifest.json'), JSON.stringify({ generatedAt: manifest.generatedAt, capabilities: manifest.capabilities, routes: manifest.routes.map(({ id, pathname, kind }) => ({ id, pathname, kind })) }, null, 2) + '\n');
    return target;
  } finally {
    await fs.rm(buildDir, { recursive: true, force: true });
  }
}

export async function prepareDeploy(rootDir: string, outDir = 'dist'): Promise<string> {
  const root = resolve(rootDir);
  const target = resolve(root, outDir);
  const buildDir = join(root, `.ryvax-deploy-${process.pid}-${randomUUID()}`);
  try {
    const manifest = await buildProject({ rootDir: root, outDir: buildDir, mode: 'production', minify: true, sourcemap: false });
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(join(target, '.meu'), { recursive: true });
    await copyDirectory(join(buildDir, 'routes'), join(target, '.meu', 'routes'));
    await copyDirectoryIfExists(join(buildDir, 'layouts'), join(target, '.meu', 'layouts'));
    await copyDirectoryIfExists(join(buildDir, 'boundaries'), join(target, '.meu', 'boundaries'));
    await copyDirectoryIfExists(join(buildDir, 'actions'), join(target, '.meu', 'actions'));
    await copyDirectoryIfExists(join(buildDir, 'slots'), join(target, '.meu', 'slots'));
    await copyDirectoryIfExists(join(buildDir, 'static'), join(target, '.meu', 'static'));
    await copyDirectoryIfExists(join(root, 'public'), join(target, 'public'));
    const portableManifest = {
      ...manifest,
      outputDir: join(target, '.meu'),
      routes: manifest.routes.map((route) => ({
        ...route,
        file: route.file.replace(root, target),
        bundle: route.bundle.replace(buildDir, join(target, '.meu')),
        ...(route.layouts ? { layouts: route.layouts.map((layout) => layout.replace(buildDir, join(target, '.meu'))) } : {}),
        ...(route.errorBoundary ? { errorBoundary: route.errorBoundary.replace(buildDir, join(target, '.meu')) } : {}),
        ...(route.forbiddenBoundary ? { forbiddenBoundary: route.forbiddenBoundary.replace(buildDir, join(target, '.meu')) } : {}),
        ...(route.unauthorizedBoundary ? { unauthorizedBoundary: route.unauthorizedBoundary.replace(buildDir, join(target, '.meu')) } : {})
        , ...(route.loadingBoundary ? { loadingBoundary: route.loadingBoundary.replace(buildDir, join(target, '.meu')) } : {})
        , ...(route.slots ? { slots: Object.fromEntries(Object.entries(route.slots).map(([name, slot]) => [name, slot.replace(buildDir, join(target, '.meu'))])) } : {})
      })),
      ...(manifest.notFound ? { notFound: manifest.notFound.replace(buildDir, join(target, '.meu')) } : {}),
      ...(manifest.actions ? { actions: manifest.actions.map((action) => ({ ...action, bundle: action.bundle.replace(buildDir, join(target, '.meu')) })) } : {})
    };
    await fs.writeFile(join(target, '.meu', 'manifest.json'), JSON.stringify(portableManifest, null, 2) + '\n');
    await fs.writeFile(join(target, 'server.mjs'), deployServerSource());
    await fs.writeFile(join(target, 'package.json'), JSON.stringify({ type: 'module', private: true, scripts: { start: 'node server.mjs' }, dependencies: { '@kvantjs/ryvax.js': '^2.3.5', react: '^19.2.8', 'react-dom': '^19.2.8' }, engines: { node: '>=20' } }, null, 2) + '\n');
    return target;
  } finally {
    await fs.rm(buildDir, { recursive: true, force: true });
  }
}

export async function buildClient(entry: string, outDir: string, options: BuildOptions): Promise<string> {
  const staticDir = join(outDir, 'static');
  await fs.mkdir(staticDir, { recursive: true });
  const output = join(staticDir, 'client.js');
  const orchestrator = await createBuildOrchestrator(options, 1);
  await orchestrator.build({ id: 'client', file: entry, kind: 'client' }, output, 'browser');
  return output;
}

async function bundleModule(file: string, outfile: string, options: BuildOptions, mode: 'development' | 'production'): Promise<string> {
  await fs.mkdir(dirname(outfile), { recursive: true });
  const useCache = options.cacheBuilds ?? mode === 'production';
  const source = await fs.readFile(file);
  const cacheKey = createHash('sha256').update(source).update(JSON.stringify({ mode, minify: options.minify, sourcemap: options.sourcemap, target: 'node20' })).digest('hex');
  const cached = join(options.rootDir, '.ryvax-cache', `${cacheKey}.mjs`);
  if (useCache) {
    try { await fs.copyFile(cached, outfile); return outfile; } catch { /* cache miss */ }
  }
  const orchestrator = await createBuildOrchestrator(options, 1);
  await orchestrator.build({ id: file, file, kind: 'route' }, outfile, options.target ?? 'node');
  if (useCache) {
    await fs.mkdir(dirname(cached), { recursive: true });
    await fs.copyFile(outfile, cached);
  }
  return outfile;
}

async function findLayoutFiles(appDir: string, routeFile: string): Promise<string[]> {
  const routeDirectory = dirname(routeFile);
  const relativeDirectory = relative(appDir, routeDirectory).split(sep).filter(Boolean);
  const layouts: string[] = [];
  for (let index = 0; index <= relativeDirectory.length; index += 1) {
    const directory = join(appDir, ...relativeDirectory.slice(0, index));
    for (const extension of ['.tsx', '.ts', '.jsx', '.js', '.mts', '.cts']) {
      const candidate = join(directory, `layout${extension}`);
      try { await fs.access(candidate); layouts.push(candidate); break; } catch { /* optional boundary */ }
    }
  }
  return layouts;
}

async function findBoundaryFile(appDir: string, routeFile: string, name: string): Promise<string | undefined> {
  const routeDirectory = routeFile === appDir ? appDir : dirname(routeFile);
  const relativeDirectory = relative(appDir, routeDirectory).split(sep).filter(Boolean);
  for (let index = relativeDirectory.length; index >= 0; index -= 1) {
    const directory = join(appDir, ...relativeDirectory.slice(0, index));
    for (const extension of ['.tsx', '.ts', '.jsx', '.js', '.mts', '.cts']) {
      const candidate = join(directory, `${name}${extension}`);
      try { await fs.access(candidate); return candidate; } catch { /* optional boundary */ }
    }
  }
  return undefined;
}

async function bundleSlots(appDir: string, routeFile: string, stagingDir: string, options: BuildOptions, mode: 'development' | 'production', id: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let directory = dirname(routeFile);
  const root = resolve(appDir);
  while (directory.startsWith(root)) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('@')) continue;
      for (const fileName of ['page.tsx', 'page.ts', 'page.jsx', 'page.js']) {
        const candidate = join(directory, entry.name, fileName);
        try {
          await fs.access(candidate);
          result[entry.name.slice(1)] = await bundleModule(candidate, resolve(stagingDir, 'slots', `${slugify(id)}-${entry.name.slice(1)}-${stableHash(candidate)}.mjs`), options, mode);
          break;
        } catch { /* optional slot */ }
      }
    }
    if (directory === root) break;
    directory = dirname(directory);
  }
  return result;
}

export async function watchProject(options: BuildOptions, onBuild: (manifest: RouteManifest) => void | Promise<void>): Promise<WatchHandle> {
  const rootDir = resolve(options.rootDir);
  let timer: NodeJS.Timeout | undefined;
  let building = false;
  let queued = false;
  const rebuild = async () => {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    try {
      const manifest = await buildProject({ ...options, mode: 'development', watch: true });
      await onBuild(manifest);
    } finally {
      building = false;
      if (queued) {
        queued = false;
        void rebuild();
      }
    }
  };
  const watcher = chokidar.watch([
    join(rootDir, 'pages'),
    join(rootDir, 'src'),
    join(rootDir, 'framework.config.*'),
    join(rootDir, '.env'),
    join(rootDir, '.env.local')
  ], { ignoreInitial: true });
  watcher.on('all', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 80);
  });
  await rebuild();
  return {
    watcher,
    async close() {
      if (timer) clearTimeout(timer);
      await watcher.close();
    }
  };
}

export async function loadManifest(rootDir: string, outDir = '.meu'): Promise<RouteManifest> {
  const file = join(resolve(rootDir, outDir), 'manifest.json');
  return JSON.parse(await fs.readFile(file, 'utf8')) as RouteManifest;
}

async function findClientEntry(rootDir: string): Promise<string | undefined> {
  for (const candidate of ['src/client.ts', 'src/client.tsx', 'client.ts', 'client.tsx']) {
    const file = join(rootDir, candidate);
    try {
      await fs.access(file);
      return file;
    } catch {
      // Continua procurando.
    }
  }
  return undefined;
}

async function generateStaticPages(manifest: RouteManifest, outDir: string, mode: 'development' | 'production'): Promise<void> {
  if (mode !== 'production') return;
  for (const route of manifest.routes.filter((candidate) => candidate.kind !== 'api')) {
    const module = await import(`${pathToFileURL(route.bundle).href}?static=${Date.now()}`) as PageModule;
    const hasStaticProps = typeof module.getStaticProps === 'function';
    const hasStaticParams = typeof module.generateStaticParams === 'function' || typeof module.getStaticPaths === 'function';
    if (route.dynamic && !hasStaticParams) continue;
    if (!route.dynamic && !hasStaticProps) continue;
    const paths = route.dynamic
      ? module.generateStaticParams ? await module.generateStaticParams() : module.getStaticPaths ? await module.getStaticPaths() : []
      : [{}];
    for (const params of paths) {
      const pathname = route.dynamic ? materializePath(route.segments, params) : route.pathname;
      const context = createBuildContext(pathname);
      context.params = params;
      const props = hasStaticProps ? await module.getStaticProps?.(context) : params;
      let element = await module.default(props ?? {}, context);
      for (const layoutBundle of route.layouts ?? []) {
        const layout = await import(`${pathToFileURL(layoutBundle).href}?static=${Date.now()}`) as { default: (props: { children: typeof element }, context: RequestContext) => unknown };
        element = await layout.default({ children: element }, context) as typeof element;
      }
      const html = renderPage(element);
      const outputDir = join(outDir, 'static', pathname === '/' ? '' : pathname.slice(1));
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(join(outputDir, 'index.html'), html);
    }
  }
}

async function replaceDirectory(stagingDir: string, outputDir: string): Promise<void> {
  const backupDir = `${outputDir}.previous-${process.pid}-${randomUUID()}`;
  let movedExisting = false;
  try {
    try {
      await fs.rename(outputDir, backupDir);
      movedExisting = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await fs.rename(stagingDir, outputDir);
  } finally {
    if (movedExisting) await fs.rm(backupDir, { recursive: true, force: true });
  }
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else await fs.copyFile(from, to);
  }
}

async function copyDirectoryIfExists(source: string, target: string): Promise<void> {
  try { await fs.access(source); } catch { return; }
  await copyDirectory(source, target);
}

function rebaseManifest(manifest: RouteManifest, from: string, to: string): RouteManifest {
  return {
    ...manifest,
    outputDir: to,
    routes: manifest.routes.map((route) => ({
      ...route,
      bundle: route.bundle.replace(from, to),
      ...(route.layouts ? { layouts: route.layouts.map((layout) => layout.replace(from, to)) } : {}),
      ...(route.errorBoundary ? { errorBoundary: route.errorBoundary.replace(from, to) } : {}),
      ...(route.forbiddenBoundary ? { forbiddenBoundary: route.forbiddenBoundary.replace(from, to) } : {}),
      ...(route.unauthorizedBoundary ? { unauthorizedBoundary: route.unauthorizedBoundary.replace(from, to) } : {}),
      ...(route.loadingBoundary ? { loadingBoundary: route.loadingBoundary.replace(from, to) } : {}),
      ...(route.slots ? { slots: Object.fromEntries(Object.entries(route.slots).map(([name, slot]) => [name, slot.replace(from, to)])) } : {})
    })),
    ...(manifest.notFound ? { notFound: manifest.notFound.replace(from, to) } : {}),
    ...(manifest.actions ? { actions: manifest.actions.map((action) => ({ ...action, bundle: action.bundle.replace(from, to) })) } : {}),
    ...(manifest.client ? { client: { entry: manifest.client.entry.replace(from, to) } } : {})
  };
}

function generateRouteTypes(manifest: RouteManifest): string {
  const paths = [...new Set(manifest.routes.map((route) => route.pathname))].sort();
  return `// Generated by Ryvax. Do not edit.\nexport type RyvaxRoute = ${paths.length ? paths.map((path) => JSON.stringify(path)).join(' | ') : 'never'};\nexport function route(path: RyvaxRoute): RyvaxRoute;\n`;
}

function deployServerSource(): string {
  return `import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, createAppServer } from '@kvantjs/ryvax.js';
const rootDir = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const manifest = await loadManifest(rootDir, '.meu');
const app = createAppServer(manifest, { rootDir, port, poweredBy: false });
await app.listen(port, process.env.HOST || '0.0.0.0');
console.log('Ryvax production server listening on ' + port);
`;
}

function createBuildContext(pathname: string): RequestContext {
  return {
    request: {} as RequestContext['request'],
    response: {} as RequestContext['response'],
    signal: new AbortController().signal,
    url: new URL(`http://static.local${pathname}`),
    params: {},
    query: new URLSearchParams(),
    headers: {},
    body: undefined,
    runtime: 'node',
    state: {},
    env: process.env
  };
}

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'index';
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function materializePath(segments: string[], params: Record<string, string | string[]>): string {
  const parts = segments.flatMap((segment) => {
    if (!segment.startsWith(':') && !segment.startsWith('*')) return [segment];
    const name = segment.replace(/^\*/, '').replace(/^:/, '').replace(/\?$/, '');
    const value = params[name];
    if (value === undefined) return [];
    return Array.isArray(value) ? value.map(encodeURIComponent) : [encodeURIComponent(value)];
  });
  return `/${parts.join('/')}`.replace(/\/+/g, '/') || '/';
}
