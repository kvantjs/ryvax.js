#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildProject, exportStaticSite, loadManifest, prepareDeploy, watchProject } from '../compiler.js';
import { buildDocker, buildNetlify, buildVercel } from '../deployment-build.js';
import { createAppServer, createHmrHub } from '../server.js';
import { loadConfig } from '../config.js';
import { createProjectGraph, diagnoseManifest } from '../introspection.js';
import { benchmarkProject } from '../benchmark.js';

const [command = 'help', ...args] = process.argv.slice(2);

try {
  if (command === 'create') await createCommand(args);
  else if (command === 'dev') await runCommand('development', args);
  else if (command === 'build') await runCommand('production', args);
  else if (command === 'build:vercel') await adapterBuildCommand('vercel', args);
  else if (command === 'build:netlify') await adapterBuildCommand('netlify', args);
  else if (command === 'build:docker') await adapterBuildCommand('docker', args);
  else if (command === 'export') await exportCommand(args);
  else if (command === 'deploy') await deployCommand(args);
  else if (command === 'start') await startCommand(args);
  else if (command === 'doctor') await doctorCommand(args);
  else if (command === 'routes') await routesCommand(args);
  else if (command === 'analyze') await analyzeCommand(args);
  else if (command === 'inspect') await inspectCommand(args);
  else if (command === 'benchmark') await benchmarkCommand(args);
  else if (command === 'migrate') await migrateCommand(args);
  else printHelp();
} catch (error) {
  console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function createCommand(args: string[]): Promise<void> {
  const projectName = args.find((arg) => !arg.startsWith('-'));
  if (!projectName) throw new Error('Provide a project name: npx ryvax create my-app');
  const useTailwind = !args.includes('--no-tailwind');
  const templateArg = args.find((arg) => arg.startsWith('--template='))?.split('=')[1] ?? 'react';
  if (templateArg !== 'react' && templateArg !== 'saas' && templateArg !== 'saas-ui' && templateArg !== 'docs' && templateArg !== 'api-docs') throw new Error('Invalid template. Use --template=react, --template=saas, --template=saas-ui, --template=docs, or --template=api-docs');
  const target = resolve(process.cwd(), projectName);
  if (existsSync(target)) throw new Error(`The directory ${projectName} already exists`);
  await fs.mkdir(target, { recursive: true });
  await writeTemplate(target, projectName, useTailwind, templateArg);
  console.log(`\nProject ${projectName} created.`);
  console.log(`\n  cd ${projectName}`);
  console.log('  npm install');
  console.log('  npm run dev\n');
}

async function runCommand(mode: 'development' | 'production', args: string[]): Promise<void> {
  const rootDir = resolve(process.cwd());
  const port = numberArg(args, '--port') ?? (Number(process.env.PORT) || 3000);
  const userConfig = await loadConfig(rootDir);
  const builder = builderArg(args);
  const profile = args.includes('--profile');
  if (mode === 'production') {
    const manifest = await buildProject({ rootDir, mode, minify: true, sourcemap: false, plugins: userConfig.plugins, builder, profile });
    console.log(`Build complete: ${manifest.routes.length} routes.`);
    return;
  }

  const hmr = createHmrHub();
  let app = createAppServer(await buildProject({ rootDir, mode, plugins: userConfig.plugins, builder, profile }), { ...userConfig, rootDir, port }, hmr);
  await app.listen(port);
  console.log(`Ryvax running at http://localhost:${port}`);
  console.log('HMR active at /_meu/hmr');
  const watch = await watchProject({ rootDir, mode, plugins: userConfig.plugins, builder, profile }, async (manifest) => {
    const refreshedConfig = await loadConfig(rootDir);
    await app.close();
    app = createAppServer(manifest, { ...refreshedConfig, rootDir, port }, hmr);
    await app.listen(port);
    hmr.broadcast();
    console.log(`Rebuild complete: ${manifest.routes.length} routes.`);
  });
  const shutdown = async () => {
    await watch.close();
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await new Promise<void>(() => undefined);
}

async function adapterBuildCommand(target: 'vercel' | 'netlify' | 'docker', args: string[]): Promise<void> {
  const rootDir = resolve(process.cwd());
  const outDir = stringArg(args, '--out-dir');
  const userConfig = await loadConfig(rootDir);
  await buildProject({ rootDir, mode: 'production', minify: true, sourcemap: false, plugins: userConfig.plugins });
  const result = target === 'vercel'
    ? await buildVercel({ rootDir, outDir })
    : target === 'netlify' ? await buildNetlify({ rootDir, outDir }) : await buildDocker({ rootDir, outDir });
  console.log(`${target} deployment output written to ${result.outDir}`);
  console.log(`${result.manifest.routes.length} routes normalized for ${result.manifest.runtime} runtime.`);
}

async function startCommand(args: string[]): Promise<void> {
  const rootDir = resolve(process.cwd());
  const port = numberArg(args, '--port') ?? (Number(process.env.PORT) || 3000);
  const manifest = await loadManifest(rootDir);
  const userConfig = await loadConfig(rootDir);
  const app = createAppServer(manifest, { ...userConfig, rootDir, port });
  await app.listen(port);
  console.log(`Ryvax running in production at http://localhost:${port}`);
  await new Promise<void>(() => undefined);
}

async function exportCommand(args: string[]): Promise<void> {
  const outDir = stringArg(args, '--out-dir') ?? 'dist';
  const output = await exportStaticSite(resolve(process.cwd()), outDir);
  console.log(`Static export completed at ${output}`);
}

async function deployCommand(args: string[]): Promise<void> {
  const outDir = stringArg(args, '--out-dir') ?? 'dist';
  const output = await prepareDeploy(resolve(process.cwd()), outDir);
  console.log(`Node deployment package completed at ${output}`);
  console.log('Configure the build command as "npm run deploy" and the start command as "node dist/server.mjs".');
}

async function doctorCommand(args: string[] = []): Promise<void> {
  const rootDir = resolve(process.cwd());
  const checks: Array<[string, boolean, string]> = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(['Node.js', major >= 20, `v${process.versions.node} (requires Node.js 20+)`]);
  checks.push(['package.json', existsSync(join(rootDir, 'package.json')), rootDir]);
  checks.push(['pages/', existsSync(join(rootDir, 'pages')), join(rootDir, 'pages')]);
  checks.push(['framework config', ['framework.config.ts', 'framework.config.mts', 'framework.config.js', 'framework.config.mjs'].some((name) => existsSync(join(rootDir, name))), 'optional']);
  checks.push(['builder', ['auto', 'esbuild', 'rolldown'].includes(builderArg(args) ?? process.env.RYVAX_BUILDER ?? 'auto'), builderArg(args) ?? process.env.RYVAX_BUILDER ?? 'auto']);
  if (existsSync(join(rootDir, 'package.json'))) {
    const packageJson = JSON.parse(await fs.readFile(join(rootDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const dependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
    checks.push(['Ryvax dependency', Object.keys(dependencies).some((name) => name === '@kvantjs/ryvax.js' || name === 'ryvax'), 'package.json']);
  }
  if (args.includes('--json')) {
    const manifestPath = join(rootDir, '.meu', 'manifest.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(await fs.readFile(manifestPath, 'utf8')) : undefined;
    console.log(JSON.stringify({ schemaVersion: 1, ok: !checks.some(([, passed]) => !passed), checks: checks.map(([name, passed, detail]) => ({ name, passed, detail })), diagnostics: manifest ? diagnoseManifest(manifest, rootDir) : [] }, null, 2));
    if (checks.some(([name, passed]) => !passed && (name === 'Node.js' || name === 'package.json'))) process.exitCode = 1;
    return;
  }
  console.log('Ryvax doctor\n');
  for (const [name, passed, detail] of checks) console.log(`${passed ? 'PASS' : 'WARN'}  ${name}: ${detail}`);
  if (checks.some(([name, passed]) => !passed && (name === 'Node.js' || name === 'package.json'))) {
    process.exitCode = 1;
  }
}

async function routesCommand(args: string[] = []): Promise<void> {
  const rootDir = resolve(process.cwd());
  const manifest = await loadManifest(rootDir);
  if (args.includes('--json')) {
    console.log(JSON.stringify({ schemaVersion: 1, graph: manifest.graph ?? createProjectGraph(manifest, rootDir), routes: manifest.routes.map(({ id, kind, pathname, pattern, segments, dynamic, catchAll, layouts, errorBoundary, forbiddenBoundary, unauthorizedBoundary, loadingBoundary, slots }) => ({ id, kind, pathname, pattern, segments, dynamic, catchAll, ...(layouts ? { layouts } : {}), ...(errorBoundary ? { errorBoundary } : {}), ...(forbiddenBoundary ? { forbiddenBoundary } : {}), ...(unauthorizedBoundary ? { unauthorizedBoundary } : {}), ...(loadingBoundary ? { loadingBoundary } : {}), ...(slots ? { slots } : {}) })) }, null, 2));
    return;
  }
  console.log('Ryvax routes\n');
  for (const route of manifest.routes) console.log(`${route.kind.toUpperCase().padEnd(4)} ${route.pathname.padEnd(32)} ${route.file}`);
}

async function analyzeCommand(args: string[] = []): Promise<void> {
  const rootDir = resolve(process.cwd());
  const manifest = await loadManifest(rootDir, stringArg(args, '--out-dir') ?? '.meu');
  const entries = [...manifest.routes.map((route) => ({ type: 'route', id: route.id, file: route.bundle })), ...(manifest.actions ?? []).map((action) => ({ type: 'action', id: action.id, file: action.bundle }))];
  const rows = await Promise.all(entries.map(async (entry) => ({ ...entry, bytes: (await fs.stat(entry.file)).size })));
  const diagnostics = diagnoseManifest(manifest, rootDir);
  const summary = { schemaVersion: 1, graph: manifest.graph ?? createProjectGraph(manifest, rootDir), totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0), largestBundle: rows.slice().sort((a, b) => b.bytes - a.bytes)[0] ?? null, rows, diagnostics };
  if (args.includes('--json')) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log('Ryvax bundle analysis\n');
    for (const row of rows) console.log(`${row.type.toUpperCase().padEnd(7)} ${String(row.bytes).padStart(8)} bytes  ${row.id}`);
    console.log(`\nTotal: ${summary.totalBytes} bytes across ${rows.length} bundles.`);
    if (summary.largestBundle) console.log(`Largest: ${summary.largestBundle.id} (${summary.largestBundle.bytes} bytes)`);
    if (diagnostics.length) console.log(`Diagnostics: ${diagnostics.length}`);
  }
}

async function inspectCommand(args: string[] = []): Promise<void> {
  const rootDir = resolve(process.cwd());
  const manifest = await loadManifest(rootDir, stringArg(args, '--out-dir') ?? '.meu');
  const graph = createProjectGraph(manifest, rootDir);
  const diagnostics = diagnoseManifest(manifest, rootDir);
  if (args.includes('--json')) {
    console.log(JSON.stringify({ graph, diagnostics }, null, 2));
    return;
  }
  console.log('Ryvax project inspection\n');
  console.log(`Runtime: ${graph.runtime}`);
  console.log(`Routes: ${graph.routeCount} (${graph.apiRouteCount} API, ${graph.pageRouteCount} page, ${graph.dynamicRouteCount} dynamic)`);
  console.log(`Actions: ${graph.actionCount}`);
  for (const route of graph.routes) console.log(`${route.kind.toUpperCase().padEnd(4)} ${route.pathname.padEnd(32)} layouts=${route.layouts} boundaries=${route.boundaries.join(',') || 'none'}`);
  if (diagnostics.length) {
    console.log('\nDiagnostics:');
    for (const diagnostic of diagnostics) console.log(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`);
  }
}

async function migrateCommand(args: string[]): Promise<void> {
  const action = args[0] ?? 'help';
  if (action !== 'create') {
    console.log('Usage: ryvax migrate create <name>');
    return;
  }
  const name = args[1]?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!name) throw new Error('Provide a migration name: ryvax migrate create add_users');
  const directory = resolve(process.cwd(), 'migrations');
  await fs.mkdir(directory, { recursive: true });
  const existing = (await fs.readdir(directory)).filter((file) => /^\d+[-_].+\.up\.sql$/.test(file));
  const id = String(existing.length + 1).padStart(4, '0');
  await fs.writeFile(join(directory, `${id}_${name}.up.sql`), '-- Write the forward migration here.\n');
  await fs.writeFile(join(directory, `${id}_${name}.down.sql`), '-- Write the rollback migration here.\n');
  console.log(`Migration ${id}_${name} created in migrations/.`);
}

async function benchmarkCommand(args: string[] = []): Promise<void> {
  const rootDir = resolve(process.cwd());
  const report = await benchmarkProject(rootDir, { outDir: stringArg(args, '--out-dir'), minify: !args.includes('--no-minify') });
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('Ryvax benchmark\n');
  console.log(`Build: ${report.buildMs} ms`);
  console.log(`Routes: ${report.routeCount}`);
  console.log(`Bundles: ${report.bundleCount}`);
  console.log(`Bundle bytes: ${report.bundleBytes}`);
  if (report.diagnostics.length) console.log(`Diagnostics: ${report.diagnostics.length}`);
  console.log(`Node: ${report.node}`);
}

async function writeTemplate(target: string, projectName: string, useTailwind: boolean, template: 'react' | 'saas' | 'saas-ui' | 'docs' | 'api-docs'): Promise<void> {
  if (template === 'saas-ui' || template === 'docs' || template === 'api-docs') {
    const templateDirectory = template === 'docs' ? 'docs-platform' : template === 'api-docs' ? 'api-docs' : 'saas-ui';
    const candidates = [
      new URL(`../../templates/${templateDirectory}/`, import.meta.url),
      new URL(`../../../templates/${templateDirectory}/`, import.meta.url)
    ];
    let source: URL | undefined;
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        source = candidate;
        break;
      } catch {
        // Try the next layout: source execution and compiled package use different depths.
      }
    }
    if (!source) throw new Error(`The ${templateDirectory} template is not included in this Ryvax distribution`);
    await fs.cp(source, target, { recursive: true });
    const packageFile = join(target, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageFile, 'utf8')) as Record<string, unknown>;
    packageJson.name = projectName;
    packageJson.private = true;
    if (template === 'docs' || template === 'api-docs') {
      const dependencies = packageJson.dependencies as Record<string, string> | undefined;
      if (dependencies) dependencies['@kvantjs/ryvax.js'] = '^2.1.3';
    }
    await fs.writeFile(packageFile, JSON.stringify(packageJson, null, 2) + '\n');
    return;
  }
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: projectName,
      private: true,
      type: 'module',
      scripts: useTailwind
        ? { dev: 'npm run css:build && ryvax dev', build: 'npm run css:build && ryvax build', 'build:vercel': 'npm run css:build && ryvax build:vercel', 'build:netlify': 'npm run css:build && ryvax build:netlify', deploy: 'npm run css:build && ryvax deploy', start: 'ryvax start', 'css:build': 'tailwindcss -i ./src/styles.css -o ./public/styles.css --minify', typecheck: 'tsc --noEmit' }
        : { dev: 'ryvax dev', build: 'ryvax build', 'build:vercel': 'ryvax build:vercel', 'build:netlify': 'ryvax build:netlify', deploy: 'ryvax deploy', start: 'ryvax start', typecheck: 'tsc --noEmit' },
      dependencies: { '@kvantjs/ryvax.js': '^2.1.0', react: '^19.2.8', 'react-dom': '^19.2.8' },
      devDependencies: { '@types/node': '^22.0.0', '@types/react': '^19.2.18', '@types/react-dom': '^19.2.7', tsx: '^4.19.0', typescript: '^5.7.0', ...(useTailwind ? { tailwindcss: '^3.4.0', postcss: '^8.4.0', autoprefixer: '^10.4.0' } : {}) }
    }, null, 2) + '\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, types: ['node'] }, include: ['pages', 'src', 'framework.config.ts'] }, null, 2) + '\n',
    'framework.config.ts': `import type { AppConfig } from '@kvantjs/ryvax.js';\n\nexport default {\n  cache: { enabled: true, defaultTtl: 0, staleWhileRevalidate: 60 },\n  poweredBy: false,\n  observability: { requestLogging: false }\n} satisfies AppConfig;\n`,
    'pages/index.tsx': `import type { PageModule } from '@kvantjs/ryvax.js';
import { App } from '../src/App.js';

export const revalidate = 60;

export const getStaticProps = async () => ({ title: 'High-performance SaaS' });

const page: PageModule<{ title: string }> = {
  default(props) {
    return <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <div id="root"><App title={props.title} /></div>
        <script type="module" src="/_meu/static/client.js"></script>
      </body>
    </html>;
  }
};

export default page.default;
`,
    'src/App.tsx': `export function App({ title }: { title: string }) {
  return <main className="shell">
    <span className="eyebrow">Ryvax by Kvant · React-first</span>
    <h1>{title}</h1>
    <p>SSR, hydration, typed APIs, SSG, and HMR for complete SaaS products.</p>
    <a href="/api/health">Check the API →</a>
  </main>;
}
`,
    'pages/api/health.ts': `import type { ApiHandler } from '@kvantjs/ryvax.js';\n\nexport const GET: ApiHandler = async ({ env }) => ({\n  json: { ok: true, service: 'saas', node: process.version, environment: env.NODE_ENV ?? 'development' }\n});\n`,
    'src/client.tsx': `import { hydrate, installHmr } from '@kvantjs/ryvax.js/client';\nimport { App } from './App.js';\n\nhydrate(<App title="High-performance SaaS" />);\ninstallHmr();\n`,
    'public/styles.css': `:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #e2e8f0; background: #020617; }\n* { box-sizing: border-box; }\nbody { margin: 0; min-height: 100vh; }\n.shell { max-width: 760px; margin: 0 auto; padding: 15vh 24px; }\n.eyebrow { color: #38bdf8; text-transform: uppercase; letter-spacing: .14em; font-size: .75rem; font-weight: 700; }\nh1 { font-size: clamp(3rem, 8vw, 6.8rem); line-height: .95; letter-spacing: -.07em; margin: 1rem 0 1.5rem; }\np { max-width: 560px; color: #94a3b8; font-size: 1.2rem; line-height: 1.7; }\na { display: inline-block; margin-top: 1.5rem; color: #020617; background: #38bdf8; padding: .85rem 1.1rem; border-radius: .7rem; text-decoration: none; font-weight: 700; }\n`,
    'src/env.d.ts': `/// <reference types="node" />\n`,
    '.env.example': `NODE_ENV=development\nDATABASE_URL=\n`,
    '.gitignore': `node_modules/\n.meu/\n.env\ndist/\n`
  };
  if (template === 'saas') {
    files['pages/api/session.ts'] = `import { getSession } from '@kvantjs/ryvax.js';
import type { ApiHandler } from '@kvantjs/ryvax.js';

export const GET: ApiHandler = ({ request, env }) => {
  const session = getSession(request, env.RYVAX_SESSION_SECRET ?? '');
  return { json: { authenticated: Boolean(session), userId: session?.sub ?? null } };
};
`;
    files['.env.example'] = `NODE_ENV=development\nRYVAX_SESSION_SECRET=replace-with-at-least-32-random-characters\nDATABASE_URL=\nREDIS_URL=\n`;
    files['README.md'] = '# ' + projectName + '\\n\\nReact-first SaaS starter created with Ryvax by Kvant.\\n\\n## Development\\n\\n```bash\\nnpm install\\nnpm run dev\\n```\\n\\nThe starter includes React SSR, hydration, an API health endpoint, a signed-session endpoint, security limits, and extension points for database, cache, and storage adapters. Never use the example secret in production.\\n';
  }
  if (useTailwind) {
    files['src/styles.css'] = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }\n.shell { max-width: 760px; margin: 0 auto; padding: 15vh 24px; }\n`;
    files['tailwind.config.ts'] = `import type { Config } from 'tailwindcss';\nexport default { content: ['./pages/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'], theme: { extend: {} }, plugins: [] } satisfies Config;\n`;
    files['postcss.config.cjs'] = `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n`;
  }
  for (const [file, contents] of Object.entries(files)) {
    const destination = join(target, file);
    await fs.mkdir(join(destination, '..'), { recursive: true });
    await fs.writeFile(destination, contents);
  }
}

function numberArg(args: string[], name: string): number | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

function stringArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function builderArg(args: string[]): 'auto' | 'esbuild' | 'rolldown' | undefined {
  const value = stringArg(args, '--builder') ?? args.find((arg) => arg.startsWith('--builder='))?.split('=')[1];
  if (!value) return undefined;
  if (value === 'auto' || value === 'esbuild' || value === 'rolldown') return value;
  throw new Error(`Invalid builder '${value}'. Use auto, esbuild, or rolldown.`);
}

function printHelp(): void {
  console.log(`Ryvax\n\nCommands:\n  ryvax create <name> [--template=react|saas|saas-ui|docs|api-docs] [--no-tailwind]\n  ryvax dev [--port 3000] [--builder auto|esbuild|rolldown] [--profile]\n  ryvax build [--builder auto|esbuild|rolldown] [--profile]\n  ryvax build:vercel [--out-dir .vercel/output]\n  ryvax build:netlify [--out-dir dist]\n  ryvax build:docker [--out-dir dist/docker]\n  ryvax export [--out-dir dist]\n  ryvax deploy [--out-dir dist]\n  ryvax start [--port 3000]\n  ryvax doctor [--json] [--builder auto|esbuild|rolldown]\n  ryvax routes [--json]\n  ryvax inspect [--json] [--out-dir .meu]\n  ryvax analyze [--json] [--out-dir .meu]\n  ryvax benchmark [--json] [--out-dir .meu] [--no-minify]\n  ryvax migrate create <name>`);
}
