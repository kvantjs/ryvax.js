import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileToRoutePath, matchRoute, sortRoutes } from '../src/router.js';
import { ResponseCache } from '../src/cache.js';
import { composeMiddleware, validateBody, z } from '../src/middleware.js';
import { buildProject, prepareDeploy } from '../src/compiler.js';
import { createAppServer } from '../src/server.js';
import { createEdgeHandler } from '../src/edge.js';
import { loadConfig } from '../src/config.js';
import { createLogger, createRequestId } from '../src/logger.js';
import { createCsrfToken, createSessionToken, verifyCsrfToken, verifySessionToken } from '../src/auth.js';
import { createRateLimiter, hasPermission, hasRole, requirePermission } from '../src/authz.js';
import { assertRuntimeCapability, createHealthRegistry, getRuntimeCapabilities } from '../src/platform.js';
import { identifier, sql, type SqlClient } from '../src/sql.js';
import { createMigrationRunner } from '../src/migrations.js';
import { InMemoryJobQueue } from '../src/jobs.js';
import { createCircuitBreaker, withRetry } from '../src/resilience.js';
import { assertSafeUrl, createSecureSecurityHeaders } from '../src/security.js';
import { stableActionId } from '../src/actions.js';
import { assertAllowedImageUrl, jsonLd, renderMetadata } from '../src/web.js';
import { edgeDeploymentCapabilities, nodeDeploymentCapabilities, validateDeploymentCapabilities } from '../src/adapters.js';
import { assertRscSerializable, ModuleBoundaryError } from '../src/rsc.js';
import { createDataCache } from '../src/data-cache.js';
import { AuditLog } from '../src/audit.js';
import { PluginRegistry } from '../src/plugins.js';
import { getDeploymentAdapter } from '../src/deployment-adapters.js';
import { renderSitemap, renderRobots, seoFiles } from '../src/seo.js';
import { createProjectGraph, diagnoseManifest } from '../src/introspection.js';
import { benchmarkProject } from '../src/benchmark.js';
import { defineForm } from '../src/forms.js';
import { ApiClientError, createApiClient } from '../src/api.js';
import { boundedStream, createSseStream, encodeSse } from '../src/streaming.js';
import { createRequestTrace, withRequestPhase } from '../src/request-trace.js';
import { createMemoryPubSub } from '../src/realtime.js';
import { createLocalStorage } from '../src/storage.js';

test('signs sessions, rejects tampering, and validates CSRF with constant-time comparison', () => {
  const secret = 'a'.repeat(32);
  const token = createSessionToken({ sub: 'user_1', exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  assert.equal(verifySessionToken(token, secret)?.sub, 'user_1');
  assert.equal(verifySessionToken(`${token}x`, secret), null);
  const csrf = createCsrfToken('session_1', secret);
  assert.equal(verifyCsrfToken(csrf, 'session_1', secret), true);
  assert.equal(verifyCsrfToken(csrf, 'session_2', secret), false);
});

test('validates web primitives and deployment capability constraints', () => {
  assert.equal(assertAllowedImageUrl('https://cdn.example.com/a.webp', { allowedHosts: ['cdn.example.com'] }).hostname, 'cdn.example.com');
  assert.throws(() => assertAllowedImageUrl('https://evil.example/a.webp', { allowedHosts: ['cdn.example.com'] }), /Blocked upstream host/);
  assert.match(renderMetadata({ title: 'Ryvax & SaaS', description: 'Framework' }), /Ryvax &amp; SaaS/);
  assert.match(jsonLd({ '<script>': 'safe' }), /application\/ld\+json/);
  assert.equal(validateDeploymentCapabilities(nodeDeploymentCapabilities, ['streaming', 'websocket']).ok, true);
  assert.equal(validateDeploymentCapabilities(edgeDeploymentCapabilities, ['websocket']).ok, false);
  const headers = createSecureSecurityHeaders('fixed-nonce', { trustedTypes: true });
  assert.match(headers['Content-Security-Policy']!, /nonce-fixed-nonce/);
  assert.match(headers['Content-Security-Policy']!, /require-trusted-types-for/);
});

test('exposes explicit runtime capabilities and fails early on unsupported features', () => {
  const edge = getRuntimeCapabilities('edge');
  assert.equal(edge.node, false);
  assert.equal(edge.streaming, true);
  assert.throws(() => assertRuntimeCapability(edge, 'filesystem'), /does not support capability: filesystem/);
  assertRuntimeCapability(getRuntimeCapabilities('node'), 'filesystem');
});

test('rejects non-serializable RSC values and reports client server-only imports', async () => {
  assertRscSerializable({ user: 'ana', items: [1, true] });
  assert.throws(() => assertRscSerializable({ value: BigInt(1) }), /not serializable/);
  const root = await mkdtemp(join(tmpdir(), 'ryvax-rsc-'));
  const file = join(root, 'client.ts');
  await writeFile(file, `'use client'; import fs from 'node:fs'; export default fs;`);
  const error = await import('../src/rsc.js').then(({ assertValidClientModule }) => assertValidClientModule(file)).catch((value) => value);
  assert.ok(error instanceof ModuleBoundaryError);
  const secretFile = join(root, 'secret.ts');
  await writeFile(secretFile, `'use client'; export default process.env.DATABASE_URL;`);
  const secretError = await import('../src/rsc.js').then(({ assertValidClientModule }) => assertValidClientModule(secretFile)).catch((value) => value);
  assert.ok(secretError instanceof ModuleBoundaryError);
  assert.equal(secretError.code, 'RYX-2041');
  assert.deepEqual(secretError.secrets, ['DATABASE_URL']);
  await rm(root, { recursive: true, force: true });
});

test('isolates private data cache entries and memoizes request scope', async () => {
  const store = new Map<string, unknown>();
  const adapter = {
    async get<T>(key: string) { return store.get(key) as T | undefined; },
    async set<T>(key: string, value: T) { store.set(key, value); },
    async delete(key: string) { store.delete(key); }
  };
  const cache = createDataCache(adapter);
  await assert.rejects(() => cache.get('profile', { scope: 'private' }), /requires varyKey/);
  assert.equal(await cache.remember('profile', async () => 'ana', { scope: 'private', varyKey: 'user:1' }), 'ana');
  assert.equal(await cache.get('profile', { scope: 'private', varyKey: 'user:2' }), undefined);
  const requestCache = createDataCache(adapter);
  let calls = 0;
  assert.equal(await requestCache.remember('settings', async () => { calls += 1; return 'x'; }, { scope: 'request' }), 'x');
  assert.equal(await requestCache.remember('settings', async () => { calls += 1; return 'y'; }, { scope: 'request' }), 'x');
  assert.equal(calls, 1);
});

test('records filterable audit events and forwards them to a sink', async () => {
  const persisted: string[] = [];
  const audit = new AuditLog({ write: (event) => { persisted.push(event.id); } }, 3);
  const login = await audit.record({ type: 'auth.login', actorId: 'user_1', metadata: { method: 'password' } });
  await audit.record({ type: 'admin.change', actorId: 'admin_1' });
  await audit.record({ type: 'auth.logout', actorId: 'user_1' });
  assert.equal(persisted.length, 3);
  assert.equal(audit.list({ actorId: 'user_1' }).length, 2);
  assert.equal(audit.list({ type: 'auth.login' })[0]?.id, login.id);
});

test('enforces plugin permissions, deployment capabilities, and SEO output contracts', async () => {
  const registry = new PluginRegistry();
  let built = false;
  registry.register({ name: 'test-plugin', version: '1.0.0', permissions: ['routes'], onBuild: (manifest) => { built = true; return manifest; } });
  await registry.setup({ rootDir: process.cwd(), capabilities: ['routes'] });
  await registry.onBuild({}, { rootDir: process.cwd(), capabilities: ['routes'] });
  assert.equal(built, true);
  assert.equal(getDeploymentAdapter('cloudflare').validate?.(['websocket']).ok, false);
  assert.match(renderSitemap([{ url: 'https://example.com/' }]), /urlset/);
  assert.match(renderRobots({ disallow: ['/admin'] }), /Disallow: \/admin/);
  assert.ok(seoFiles({ robots: {} })['robots.txt']);
});

test('provides parameterized SQL, authorization, and deterministic health checks', async () => {
  const query = sql`select * from users where id = ${'user_1'}`;
  assert.deepEqual(query, { text: 'select * from users where id = $1', values: ['user_1'] });
  assert.equal(identifier('users'), '"users"');
  assert.throws(() => identifier('users;drop table users'));
  const claims = { sub: 'user_1', exp: 9999999999, roles: ['editor'], permissions: ['post:write'] };
  assert.equal(hasRole(claims, 'editor'), true);
  assert.equal(hasPermission(claims, 'post:write'), true);
  assert.equal(requirePermission(claims, 'post:write').sub, 'user_1');
  assert.throws(() => requirePermission(claims, 'billing:write'));
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.check('ip').allowed, true);
  assert.equal(limiter.check('ip').allowed, true);
  assert.equal(limiter.check('ip').allowed, false);
  const health = createHealthRegistry();
  health.register('database', () => ({ status: 'ok' }));
  assert.equal((await health.report()).status, 'ok');
});

test('converts files into static, dynamic, and catch-all routes', () => {
  const pages = '/tmp/app/pages';
  assert.deepEqual(fileToRoutePath('/tmp/app/pages/index.ts', pages).pathname, '/');
  assert.deepEqual(fileToRoutePath('/tmp/app/pages/users/[id].tsx', pages).segments, ['users', ':id']);
  assert.deepEqual(fileToRoutePath('/tmp/app/pages/docs/[...slug].ts', pages).segments, ['docs', '*slug']);
});

test('supports app route conventions without changing grouped URLs', () => {
  const app = '/tmp/app/app';
  assert.deepEqual(fileToRoutePath('/tmp/app/app/(marketing)/about/page.tsx', app), {
    pathname: '/about', segments: ['about'], dynamic: false, catchAll: false
  });
  assert.deepEqual(fileToRoutePath('/tmp/app/app/api/users/route.ts', app).pathname, '/api/users');
  assert.deepEqual(fileToRoutePath('/tmp/app/app/docs/[[...slug]]/page.tsx', app).segments, ['docs', '*slug?']);
  assert.deepEqual(fileToRoutePath('/tmp/app/app/@modal/(.)photos/[id]/page.tsx', app).pathname, '/photos/:id');
});

test('sorts overlapping routes by deterministic specificity', () => {
  const make = (pathname: string, segments: string[], dynamic: boolean, catchAll: boolean) => ({ id: pathname, kind: 'ssr' as const, pathname, pattern: pathname, file: '', bundle: '', segments, dynamic, catchAll });
  const routes = sortRoutes([
    make('/users/:id', ['users', ':id'], true, false),
    make('/users/settings', ['users', 'settings'], false, false),
    make('/users/*rest', ['users', '*rest'], true, true)
  ]);
  assert.deepEqual(routes.map((route) => route.pathname), ['/users/settings', '/users/:id', '/users/*rest']);
});

test('matches and decodes dynamic parameters', () => {
  const route = { id: 'users_id', kind: 'ssr' as const, pathname: '/users/:id', pattern: '/users/:id', file: '', bundle: '', segments: ['users', ':id'], dynamic: true, catchAll: false };
  assert.deepEqual(matchRoute(route, '/users/ana%20silva')?.params, { id: 'ana silva' });
});

test('expires cache entries by TTL', async () => {
  const cache = new ResponseCache();
  cache.set('key', 'value', 0.01);
  assert.equal(cache.get('key'), 'value');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(cache.get('key'), undefined);
});

test('supports stale cache entries, tag invalidation, and stampede protection', async () => {
  const cache = new ResponseCache();
  let calls = 0;
  const compute = () => cache.remember('profile', async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { id: 'user_1' };
  }, { ttl: 0.001, staleWhileRevalidate: 0.05, tags: ['user:user_1'] });
  const [first, second] = await Promise.all([compute(), compute()]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  assert.deepEqual(cache.get('profile'), { id: 'user_1' });
  assert.equal(cache.invalidateTag('user:user_1'), 1);
  assert.equal(cache.get('profile'), undefined);
  cache.set('page:/dashboard:tenant-a', 'cached', { ttl: 60 });
  assert.equal(cache.revalidatePath('/dashboard'), 1);
  cache.set('data:invoices', 'cached', { ttl: 60, tags: ['invoices'] });
  assert.equal(cache.revalidateTag('invoices'), 1);
});

test('data cache deduplicates request work and invalidates tagged entries', async () => {
  const { createDataCache, createMemoryCacheAdapter } = await import('../src/data-cache.js');
  const cache = createDataCache(createMemoryCacheAdapter());
  let calls = 0;
  const load = () => cache.remember('user:1', async () => { calls += 1; return { id: 1 }; }, { tags: ['user:1'], ttl: 60 });
  const [first, second] = await Promise.all([load(), load()]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  assert.equal(cache.stats().deduplicated, 1);
  assert.equal(await cache.revalidateTag('user:1'), 1);
  assert.equal(await cache.get('user:1'), undefined);
});

test('forms validate input and remain renderable without client JavaScript', async () => {
  const form = defineForm<{ email: string }, { accepted: boolean }>({
    action: '/signup',
    validate: (input) => input.email.includes('@') ? [] : [{ field: 'email', message: 'Invalid email' }],
    handler: async () => ({ accepted: true })
  });
  assert.equal((await form.submit({ email: 'bad' })).status, 422);
  assert.deepEqual(await form.submit({ email: 'ana@example.com' }), { ok: true, data: { accepted: true }, errors: [] });
  assert.equal(form.action, '/signup');
  assert.equal(form.method, 'POST');
});

test('typed API client encodes route inputs and exposes structured errors', async () => {
  type Routes = {
    '/users/:id': { params: { id: string }; query: { verbose?: boolean }; response: { id: string } };
    '/users': { body: { name: string }; response: { id: string } };
  };
  const client = createApiClient<Routes>({
    baseUrl: 'https://example.test',
    fetch: async (input, init) => {
      assert.equal(String(input), 'https://example.test/users/ana%20silva?verbose=true');
      assert.equal(init?.method, 'GET');
      return new Response(JSON.stringify({ id: 'ana' }), { headers: { 'content-type': 'application/json' } });
    }
  });
  assert.deepEqual(await client.get('/users/:id', { params: { id: 'ana silva' }, query: { verbose: true } }), { id: 'ana' });
  const failing = createApiClient<{ '/users': { response: never } }>({ fetch: async () => new Response(JSON.stringify({ code: 'BAD' }), { status: 422, headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(() => failing.get('/users'), (error: unknown) => error instanceof ApiClientError && error.status === 422 && (error.details as { code: string }).code === 'BAD');
});

test('streaming primitives encode SSE and enforce bounded output', async () => {
  assert.equal(new TextDecoder().decode(encodeSse({ ok: true }, { event: 'message' })), 'event: message\ndata: {"ok":true}\n\n');
  async function* source() { yield { id: 1 }; yield { id: 2 }; }
  const chunks: Uint8Array[] = [];
  for await (const chunk of createSseStream(source(), { maxEvents: 1 })) chunks.push(chunk);
  assert.equal(chunks.length, 1);
  async function* bytes() { yield new Uint8Array([1, 2]); yield new Uint8Array([3]); }
  const bounded: Uint8Array[] = [];
  for await (const chunk of boundedStream(bytes(), { maxBytes: 3 })) bounded.push(chunk);
  assert.equal(bounded.length, 2);
  await assert.rejects(async () => { for await (const _chunk of boundedStream(bytes(), { maxBytes: 2 })) { /* consume */ } }, /maxBytes=2/);
});

test('request trace records lifecycle phases and structured failures', async () => {
  let tick = 0;
  const trace = createRequestTrace('req-1', () => ++tick);
  await withRequestPhase(trace, 'data', async () => 'ok', { cache: 'hit' });
  await assert.rejects(() => withRequestPhase(trace, 'render', async () => { throw new Error('render failed'); }), /render failed/);
  const samples = trace.snapshot();
  assert.equal(samples[0]?.phase, 'data');
  assert.equal(samples[0]?.attributes?.cache, 'hit');
  assert.equal(samples[1]?.phase, 'render');
  assert.equal(samples[1]?.error, 'render failed');
});

test('realtime pubsub delivers typed events and honors abort signals', async () => {
  const bus = createMemoryPubSub();
  const subscription = bus.subscribe<{ ok: boolean }>('updates');
  await bus.publish('updates', { ok: true });
  assert.deepEqual((await subscription.next()).payload, { ok: true });
  const controller = new AbortController();
  const pending = bus.subscribe('pending', { signal: controller.signal }).next();
  controller.abort(new Error('stopped'));
  await assert.rejects(pending, /stopped/);
  bus.close();
});

test('local storage streams objects and rejects path traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-storage-'));
  try {
    const storage = createLocalStorage(root);
    const saved = await storage.put('nested/data.txt', new TextEncoder().encode('hello'), { contentType: 'text/plain' });
    assert.equal(saved.size, 5);
    const loaded = await storage.get('nested/data.txt');
    assert.ok(loaded);
    const chunks: Uint8Array[] = [];
    for await (const chunk of loaded.body) chunks.push(chunk);
    assert.equal(new TextDecoder().decode(chunks[0]), 'hello');
    await assert.rejects(() => storage.put('../escape', new Uint8Array([1])), /escapes/);
    await storage.delete('nested/data.txt');
    assert.equal(await storage.get('nested/data.txt'), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('composes middleware and validates request bodies', async () => {
  const handler = composeMiddleware([
    validateBody(z.object({ name: z.string().min(2) }))
  ], async (context) => ({ json: { ok: true, body: context.body } }));
  const base = { request: {} as never, response: {} as never, signal: new AbortController().signal, url: new URL('http://localhost'), params: {}, query: new URLSearchParams(), headers: {}, body: { name: 'Ana' }, runtime: 'node' as const, state: {}, env: {} };
  assert.deepEqual(await handler(base), { json: { ok: true, body: { name: 'Ana' } } });
  const invalid = { ...base, body: { name: 'A' } };
  assert.equal((await handler(invalid)).status, 422);
});

test('buildProject generates a manifest and executable bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-'));
  await mkdir(join(root, 'pages', 'api'), { recursive: true });
  await writeFile(join(root, 'pages', 'index.ts'), 'export default () => "<h1>ok</h1>";');
  await writeFile(join(root, 'pages', 'api', 'health.ts'), 'export function GET() { return { json: { ok: true } }; }');
  const manifest = await buildProject({ rootDir: root, mode: 'production' });
  assert.equal(manifest.routes.length, 2);
  assert.equal(manifest.graph?.routeCount, 2);
  assert.equal(manifest.graph?.apiRouteCount, 1);
  assert.equal(JSON.parse(await readFile(join(root, '.meu', 'manifest.json'), 'utf8')).routes.length, 2);
  assert.ok((await readdir(join(root, '.ryvax-cache'))).length >= 2);
  await buildProject({ rootDir: root, mode: 'production' });
  await rm(root, { recursive: true, force: true });
});

test('benchmarkProject reports deterministic project metrics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-benchmark-'));
  await mkdir(join(root, 'pages'), { recursive: true });
  await writeFile(join(root, 'pages', 'index.ts'), 'export default () => "<h1>benchmark</h1>";');
  const report = await benchmarkProject(root);
  assert.equal(report.framework, 'ryvax');
  assert.equal(report.routeCount, 1);
  assert.equal(report.bundleCount, 1);
  assert.ok(report.buildMs >= 0);
  assert.ok(report.bundleBytes > 0);
  await rm(root, { recursive: true, force: true });
});

test('exports dynamic pages from generateStaticParams without getStaticProps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-static-params-'));
  await mkdir(join(root, 'app', 'docs', '[slug]'), { recursive: true });
  await writeFile(join(root, 'app', 'docs', '[slug]', 'page.ts'), `export async function generateStaticParams() { return [{ slug: 'routing' }, { slug: 'cache' }]; } export default (props) => '<h1>' + props.slug + '</h1>';`);
  const manifest = await buildProject({ rootDir: root, mode: 'production' });
  assert.equal(manifest.routes.some((route) => route.pathname === '/docs/:slug'), true);
  assert.match(await readFile(join(root, '.meu', 'static', 'docs', 'routing', 'index.html'), 'utf8'), /<h1>routing<\/h1>/);
  assert.match(await readFile(join(root, '.meu', 'static', 'docs', 'cache', 'index.html'), 'utf8'), /<h1>cache<\/h1>/);
  await rm(root, { recursive: true, force: true });
});

test('buildProject discovers app pages and route handlers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-app-router-'));
  await mkdir(join(root, 'app', '(marketing)', 'about'), { recursive: true });
  await mkdir(join(root, 'app', 'api', 'health'), { recursive: true });
  await mkdir(join(root, 'app', 'broken'), { recursive: true });
  await mkdir(join(root, 'app', 'restricted'), { recursive: true });
  await mkdir(join(root, 'app', '@modal'), { recursive: true });
  await writeFile(join(root, 'app', 'layout.ts'), 'export default ({ children }) => "<div data-layout>" + children + "</div>";');
  await writeFile(join(root, 'app', 'not-found.ts'), 'export default () => "<h1>custom not found</h1>";');
  await writeFile(join(root, 'app', 'error.ts'), 'export default ({ error }) => "<h1>custom error</h1><p>" + error.message + "</p>";');
  await writeFile(join(root, 'app', 'loading.ts'), 'export default () => "loading";');
  await writeFile(join(root, 'app', '@modal', 'page.ts'), 'export default () => "modal";');
  await writeFile(join(root, 'app', 'forbidden.ts'), 'export default () => "<h1>custom forbidden</h1>";');
  await writeFile(join(root, 'app', 'unauthorized.ts'), 'export default () => "<h1>custom unauthorized</h1>";');
  await writeFile(join(root, 'app', '(marketing)', 'about', 'page.ts'), 'export default () => "<h1>about</h1>";');
  await writeFile(join(root, 'app', 'broken', 'page.ts'), 'export default () => { throw new Error("broken page"); };');
  await writeFile(join(root, 'app', 'restricted', 'page.ts'), 'export default () => { const error = new Error("denied"); error.status = 403; throw error; };');
  await writeFile(join(root, 'app', 'api', 'health', 'route.ts'), 'export function GET() { return { json: { app: true } }; }');
  const manifest = await buildProject({ rootDir: root, mode: 'production' });
  assert.deepEqual(manifest.routes.map((route) => [route.kind, route.pathname]), [['api', '/api/health'], ['ssr', '/about'], ['ssr', '/broken'], ['ssr', '/restricted']]);
  assert.equal(manifest.routes.find((route) => route.pathname === '/about')?.layouts?.length, 1);
  assert.ok(manifest.routes.find((route) => route.pathname === '/about')?.loadingBoundary);
  assert.ok(manifest.routes.find((route) => route.pathname === '/about')?.slots?.modal);
  const app = createAppServer(manifest, { rootDir: root, observability: { requestLogging: false } });
  await app.listen(0, '127.0.0.1');
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/about`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /data-layout.*about/);
    const notFound = await fetch(`http://127.0.0.1:${address.port}/missing`);
    assert.equal(notFound.status, 404);
    assert.match(await notFound.text(), /custom not found/);
    const broken = await fetch(`http://127.0.0.1:${address.port}/broken`);
    assert.equal(broken.status, 500);
    assert.match(await broken.text(), /custom error/);
    const forbidden = await fetch(`http://127.0.0.1:${address.port}/restricted`);
    assert.equal(forbidden.status, 403);
    assert.match(await forbidden.text(), /custom forbidden/);
  } finally {
    await app.close();
  }
  await rm(root, { recursive: true, force: true });
});

test('buildProject registers and serves validated server actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-actions-'));
  await mkdir(join(root, 'pages'), { recursive: true });
  await mkdir(join(root, 'actions'), { recursive: true });
  await writeFile(join(root, 'pages', 'index.ts'), 'export default () => "ok";');
  await writeFile(join(root, 'actions', 'math.ts'), `'use server'; export async function add(input) { return { sum: input.a + input.b }; }`);
  const manifest = await buildProject({ rootDir: root, mode: 'production' });
  assert.equal(manifest.actions?.length, 1);
  const id = stableActionId(join(root, 'actions', 'math.ts'), 'add');
  const app = createAppServer(manifest, { rootDir: root, actions: { allowedOrigins: ['http://127.0.0.1'], csrf: { expectedToken: 'csrf-ok' } }, limits: { actionBytes: 1024 }, observability: { requestLogging: false } });
  await app.listen(0, '127.0.0.1');
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const result = await fetch(`http://127.0.0.1:${address.port}/_meu/action/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1', 'x-csrf-token': 'csrf-ok' }, body: JSON.stringify({ a: 2, b: 3 })
    });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { ok: true, result: { sum: 5 } });
    const csrfInvalid = await fetch(`http://127.0.0.1:${address.port}/_meu/action/${id}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1' }, body: JSON.stringify({ a: 1, b: 1 }) });
    assert.equal(csrfInvalid.status, 403);
    const invalid = await fetch(`http://127.0.0.1:${address.port}/_meu/action/${id}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.test' }, body: JSON.stringify({ a: 1, b: 1 }) });
    assert.equal(invalid.status, 403);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('prepareDeploy carries app layouts, boundaries, and action bundles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-deploy-'));
  await mkdir(join(root, 'app'), { recursive: true });
  await mkdir(join(root, 'actions'), { recursive: true });
  await writeFile(join(root, 'app', 'layout.ts'), 'export default ({ children }) => children;');
  await writeFile(join(root, 'app', 'not-found.ts'), 'export default () => "missing";');
  await writeFile(join(root, 'app', 'page.ts'), 'export default () => "home";');
  await writeFile(join(root, 'actions', 'ping.ts'), `'use server'; export function ping() { return { ok: true }; }`);
  const output = await prepareDeploy(root, 'deploy');
  const deployed = JSON.parse(await readFile(join(output, '.meu', 'manifest.json'), 'utf8')) as { notFound?: string; actions?: Array<{ bundle: string }>; routes: Array<{ layouts?: string[] }> };
  assert.ok(deployed.routes[0]?.layouts?.[0]?.includes(`${join(output, '.meu')}/layouts`));
  assert.ok(deployed.notFound?.includes(`${join(output, '.meu')}/boundaries`));
  assert.ok(deployed.actions?.[0]?.bundle.includes(`${join(output, '.meu')}/actions`));
  await rm(root, { recursive: true, force: true });
});

test('HTTP server executes SSR, API, SSG, assets, and security headers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-http-'));
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await symlink(join(process.cwd(), 'node_modules', 'react'), join(root, 'node_modules', 'react'), 'junction');
  await mkdir(join(root, 'pages', 'api'), { recursive: true });
  await mkdir(join(root, 'pages', 'users'), { recursive: true });
  await mkdir(join(root, 'public'), { recursive: true });
  await writeFile(join(root, 'public', 'app.css'), 'body { color: red; }');
  await writeFile(join(root, 'pages', 'index.ts'), `export const getStaticProps = async () => ({ title: 'SSG real' }); export default (props) => '<h1>' + props.title + '</h1>';`);
  await writeFile(join(root, 'pages', 'react.tsx'), `import { createElement } from 'react'; export default () => createElement('main', { id: 'react-app' }, createElement('h1', null, 'React real'));`);
  await writeFile(join(root, 'pages', 'users', '[id].ts'), `export async function getServerSideProps(ctx) { return { id: ctx.params.id }; } export default (props) => '<p>User:' + props.id + '</p>';`);
  await writeFile(join(root, 'pages', 'api', 'echo.ts'), `export const middleware = [async (ctx, next) => { ctx.state.fromMiddleware = true; return next(); }]; export async function POST(ctx) { return { status: 201, json: { received: ctx.body, middleware: ctx.state.fromMiddleware } }; }`);
  await writeFile(join(root, 'pages', 'api', 'react-stream.tsx'), `import { createElement } from 'react'; export function GET() { return { react: createElement('section', { id: 'streamed' }, createElement('strong', null, 'React stream')) }; }`);
  await writeFile(join(root, 'pages', 'api', 'raw.ts'), `export async function POST(ctx) { return { json: { raw: ctx.rawBody, parsed: ctx.body } }; }`);

  const manifest = await buildProject({ rootDir: root, mode: 'production' });
  const app = createAppServer(manifest, { rootDir: root, limits: { bodyBytes: 64 } });
  await app.listen(0, '127.0.0.1');
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /SSG real/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

    const dynamic = await fetch(`${base}/users/ana%20silva`);
    assert.equal(dynamic.status, 200);
    assert.match(await dynamic.text(), /User:ana silva/);

    const react = await fetch(`${base}/react`);
    assert.equal(react.status, 200);
    assert.match(await react.text(), /<main id="react-app"><h1>React real<\/h1><\/main>/);

    const api = await fetch(`${base}/api/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) });
    assert.equal(api.status, 201);
    assert.deepEqual(await api.json(), { received: { ok: true }, middleware: true });

    const raw = await fetch(`${base}/api/raw`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signed: true }) });
    assert.equal(raw.status, 200);
    assert.deepEqual(await raw.json(), { raw: '{"signed":true}', parsed: { signed: true } });

    const oversized = await fetch(`${base}/api/echo`, { method: 'POST', body: 'x'.repeat(128) });
    assert.equal(oversized.status, 413);

    const streamed = await fetch(`${base}/api/react-stream`);
    assert.equal(streamed.status, 200);
    assert.equal(streamed.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await streamed.text(), /<section id="streamed"><strong>React stream<\/strong><\/section>/);

    const asset = await fetch(`${base}/app.css`);
    assert.equal(asset.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.match(await asset.text(), /color: red/);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('reuses route bundles and allows request IDs and request logging to be disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-module-cache-'));
  await mkdir(join(root, 'pages', 'api'), { recursive: true });
  await writeFile(join(root, 'pages', 'api', 'module-load.ts'), `const state = globalThis as typeof globalThis & { __ryvaxModuleLoads?: number }; state.__ryvaxModuleLoads = (state.__ryvaxModuleLoads ?? 0) + 1; export function GET() { return { json: { loads: state.__ryvaxModuleLoads } }; }`);
  const manifest = await buildProject({ rootDir: root, mode: 'production' });
  const app = createAppServer(manifest, { rootDir: root, observability: { requestId: false, requestLogging: false } });
  await app.listen(0, '127.0.0.1');
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/module-load`;
  try {
    const first = await fetch(url);
    const second = await fetch(url);
    assert.equal(first.headers.get('x-request-id'), null);
    assert.deepEqual(await first.json(), { loads: 1 });
    assert.deepEqual(await second.json(), { loads: 1 });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Edge adapter executes an API route through the Fetch API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-edge-'));
  await mkdir(join(root, 'pages', 'api'), { recursive: true });
  await writeFile(join(root, 'pages', 'api', 'status.ts'), 'export function GET() { return { json: { edge: true } }; }');
  const manifest = await buildProject({ rootDir: root, mode: 'development' });
  const response = await createEdgeHandler(manifest)(new Request('https://edge.test/api/status'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { edge: true });
  await rm(root, { recursive: true, force: true });
});

test('loads framework.config.ts and environment files without requiring tsx in the consumer project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-config-'));
  await writeFile(join(root, '.env'), 'APP_SECRET="from-env"\n');
  await writeFile(join(root, 'framework.config.ts'), 'export default { cache: { enabled: true, defaultTtl: 12 }, env: { APP_NAME: "configured" } };');
  const config = await loadConfig(root);
  assert.equal(config.cache?.defaultTtl, 12);
  assert.equal(config.env?.APP_SECRET, 'from-env');
  assert.equal(config.env?.APP_NAME, 'configured');
  await rm(root, { recursive: true, force: true });
});

test('logger respects levels and JSON format and redacts sensitive data', () => {
  const lines: string[] = [];
  const logger = createLogger({ level: 'info', format: 'json', service: 'test', destination: { debug: () => undefined, info: (line) => lines.push(line), warn: () => undefined, error: () => undefined } });
  logger.debug('ignored');
  logger.info('started', { token: 'secret-value', nested: { password: 'hidden' }, requestId: 'req-1' });
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]!);
  assert.equal(event.level, 'info');
  assert.equal(event.service, 'test');
  assert.equal(event['[REDACTED]'], '[REDACTED]');
  assert.equal(event.nested['[REDACTED]'], '[REDACTED]');
  assert.equal(createRequestId('client-request'), 'client-request');
  assert.ok(createRequestId());
});

test('health checks time out without blocking the complete report', async () => {
  const health = createHealthRegistry();
  health.register('slow', () => new Promise(() => undefined));
  const report = await health.report({ timeoutMs: 5 });
  assert.equal(report.status, 'down');
  assert.match(report.checks.slow?.detail ?? '', /timed out/);
});

test('protects upstream requests from private network targets', () => {
  assert.throws(() => assertSafeUrl('http://127.0.0.1/internal'));
  assert.throws(() => assertSafeUrl('https://example.com', { allowedHosts: ['api.example.com'] }));
  assert.equal(assertSafeUrl('https://api.example.com', { allowedHosts: ['api.example.com'] }).hostname, 'api.example.com');
});

test('retries transient work and opens a circuit after repeated failures', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('temporary');
    return 'ok';
  }, { maxAttempts: 3, baseDelayMs: 0 });
  assert.equal(result, 'ok');
  const breaker = createCircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 100 });
  await assert.rejects(() => breaker.execute(async () => { throw new Error('down'); }));
  await assert.rejects(() => breaker.execute(async () => { throw new Error('down'); }));
  assert.equal(breaker.state(), 'open');
  await assert.rejects(() => breaker.execute(async () => 'blocked'), /open/);
});

test('processes jobs with retries, idempotency, and dead letters', async () => {
  let calls = 0;
  const queue = new InMemoryJobQueue({ handler: async () => { calls += 1; if (calls < 2) throw new Error('temporary'); } });
  const first = await queue.enqueue('email', { to: 'user@example.com' }, { idempotencyKey: 'email-1', maxAttempts: 2, retryDelayMs: 0 });
  const duplicate = await queue.enqueue('email', { to: 'user@example.com' }, { idempotencyKey: 'email-1' });
  assert.equal(first.id, duplicate.id);
  await queue.process();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 2);
  await queue.close();
});

test('runs versioned migrations transactionally and detects checksum changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ryvax-migrations-'));
  await writeFile(join(root, '0001_users.up.sql'), 'CREATE TABLE users (id TEXT);');
  await writeFile(join(root, '0001_users.down.sql'), 'DROP TABLE users;');
  const executed: string[] = [];
  const rows: Array<{ id: string; name: string; checksum: string; applied_at: string }> = [];
  const client: SqlClient = {
    async query<T = unknown>(text: string, values: readonly unknown[] = []) {
      executed.push(text);
      if (/SELECT id/.test(text)) return { rows: rows as T[], rowCount: rows.length };
      if (/INSERT INTO/.test(text)) rows.push({ id: String(values[0]), name: String(values[1]), checksum: String(values[2]), applied_at: String(values[3]) });
      if (/DELETE FROM/.test(text)) rows.splice(0, 1);
      return { rows: [] as T[], rowCount: 1 };
    },
    async transaction<T>(work: (transactionClient: SqlClient) => Promise<T>) { return work(client); }
  };
  const runner = createMigrationRunner({ directory: root, client });
  assert.equal((await runner.up()).length, 1);
  assert.equal((await runner.status()).pending.length, 0);
  await writeFile(join(root, '0001_users.up.sql'), 'CREATE TABLE users (id TEXT, email TEXT);');
  await assert.rejects(() => runner.up(), /checksum mismatch/);
  assert.ok(executed.length > 0);
  await rm(root, { recursive: true, force: true });
});
test('exposes a stable project graph and actionable diagnostics', () => {
  const manifest = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    runtime: 'node' as const,
    routes: [{ id: 'pages:index', kind: 'ssr' as const, pathname: '/', pattern: '/', file: '/tmp/pages/index.ts', bundle: '/tmp/missing.mjs', segments: [], dynamic: false, catchAll: false }],
    capabilities: { api: false, ssr: true, ssg: false, streaming: true, client: false }
  };
  const graph = createProjectGraph(manifest, '/tmp/app');
  assert.deepEqual({ routeCount: graph.routeCount, pageRouteCount: graph.pageRouteCount, apiRouteCount: graph.apiRouteCount, dynamicRouteCount: graph.dynamicRouteCount }, { routeCount: 1, pageRouteCount: 1, apiRouteCount: 0, dynamicRouteCount: 0 });
  assert.equal(graph.schemaVersion, 1);
  const diagnostics = diagnoseManifest(manifest, '/tmp/app');
  assert.equal(diagnostics.some((diagnostic) => diagnostic.code === 'RYX-1003'), true);
});


test('selects an adaptive bundler deterministically and honors explicit overrides', async () => {
  const { analyzeProjectComplexity } = await import('../src/build/complexity.js');
  const { createBuildOrchestrator } = await import('../src/build/orchestrator.js');
  const root = await mkdtemp(join(tmpdir(), 'ryvax-builder-selection-'));
  try {
    await mkdir(join(root, 'pages'), { recursive: true });
    await writeFile(join(root, 'pages', 'index.ts'), 'export default () => "ok";\n');
    const complexity = await analyzeProjectComplexity({ rootDir: root, mode: 'production' }, 1);
    assert.equal(complexity.selected, 'esbuild');
    const forced = await createBuildOrchestrator({ rootDir: root, mode: 'production', builder: 'rolldown' }, 1);
    assert.equal(forced.backend, 'rolldown');
    const automatic = await createBuildOrchestrator({ rootDir: root, mode: 'production', builder: 'auto' }, 1);
    assert.equal(automatic.backend, 'esbuild');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
