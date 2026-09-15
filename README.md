![Ryvax By Kbant](https://imgdb.io/i/Kmqwxlc.png)
---
Package: `@kvantjs/ryvax.js` · CLI: `ryvax` · Node.js: `>=20`

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/kvantjs/ryvax.js)
[![](https://data.jsdelivr.com/v1/package/npm/@kvantjs/ryvax.js/badge)](https://www.jsdelivr.com/package/npm/@kvantjs/ryvax.js)

The StackBlitz project installs and builds the local framework under `example/framework`, then starts the repository's runnable example on port `3000`.

**Public package page:** [ryvax package page](https://jeffersoncampos12p-dev.github.io/ryvax/)

The package page mirrors the public npm package layout and reads production metadata directly from the npm Registry, npm Downloads API, GitHub, and unpkg. It does not use simulated package statistics.

**Ryvax** is a React-first full-stack TypeScript framework for SaaS products, APIs, internal platforms, and other applications with substantial frontend, backend, data, and operational needs. It combines file-based routing, React SSR/SSG, hydration, streaming, deterministic API routes, jobs, cache contracts, health checks, metrics hooks, authentication primitives, and portable Node deployment.

> Ryvax keeps the runtime explicit. Each layer can be replaced without requiring a proprietary hosting platform.

Ryvax is suitable for teams that may operate **millions of applications or tenants over time**, but the framework does not promise a universal capacity number. Throughput and reliability depend on application code, database design, queues, cache topology, proxy, hardware, workload, and operational discipline. Measure a complete deployment before making performance claims; this repository does not claim that Ryvax is "one billion times better" without reproducible benchmarks.

## Installation

```bash
npx ryvax create my-app
cd my-app
npm install
npm run dev
```

For a production-oriented SaaS boundary:

```bash
npx ryvax create my-saas --template=saas
```

For an open-source documentation platform starter with Supabase Auth/data and Stripe Checkout:

```bash
npx ryvax create my-docs --template=docs
```

The `docs` starter is a complete development template with public documentation routes, an authenticated workspace, a Supabase migration, signed Stripe webhook handling, `.env.example`, a local `.env` demo configuration, and deployment workflows for Ryvax's Node Vercel output and static GitHub Pages export. It uses no Next.js.

The starter includes React SSR, hydration, API health, a signed-session inspection route, TypeScript strict mode, security limits, and extension points for database, cache, jobs, and storage adapters.

For a dedicated API documentation website with a modern reference UI:

```bash
npx ryvax create my-api-docs --template=api-docs
```

The `api-docs` starter uses only Ryvax.js and includes a responsive navigation shell, endpoint groups, HTTP method badges, search, request and response examples, parameter tables, copy-to-clipboard controls, authentication guidance, pagination and error sections, a visual Try it state, and static-export support. The example is frontend-first; connect real requests through server-side Ryvax routes before production.

### App Router compatibility

In addition to the established `pages/` convention, Ryvax can discover `app/` page and route-handler files. Use `page.tsx` for a page, `route.ts` for an HTTP handler, `layout.tsx` for a persistent layout, `error.tsx` for a segment render boundary, `forbidden.tsx` and `unauthorized.tsx` for typed 403/401 page errors, `not-found.tsx` for a custom 404 page, route groups such as `(marketing)` to organize files without changing the URL, and `generateStaticParams` for dynamic static pages. Layouts are composed from the app root toward the leaf route. The existing `pages/` convention remains supported and takes no migration dependency on `app/`.

New applications can opt into the nonce-based security preset with `security: { trustedTypes: true }`; `security.cspNonce` can be supplied when the application also renders nonce-bearing scripts.

The build also recognizes `loading.tsx` boundaries and named parallel slots under directories such as `@modal`. Deployment presets are available through `getDeploymentAdapter('node' | 'docker' | 'cloudflare' | 'vercel' | 'netlify' | 'cloudRun')`, and plugin extensions must declare their permissions before setup. SEO helpers generate sitemap, robots, web-app manifest, and font preload output without accepting unescaped markup.

Server mutations can live in `actions/` modules containing the `"use server"` directive. Ryvax assigns stable action IDs during build and exposes a bounded, origin-checked POST transport at `/_meu/action/:id`. Inputs and outputs must be JSON-serializable. On the client, use `Link`, `createRouter`, and `prefetch` from `@kvantjs/ryvax.js/client` for cancellable same-origin navigation.

## What Ryvax provides
![Ryvax By Kbant](https://imgdb.io/i/mu5-TT0.png)
| Layer | Responsibility |
| --- | --- |
| UI and rendering | React 19, TSX, SSR, SSG, hydration, HTML streaming, and client bundles |
| HTTP and APIs | File-based routes, typed `RequestContext`, JSON/body/redirect/stream responses, middleware, `OPTIONS`, safe `HEAD`, request deadlines, and abort propagation |
| Platform | SQL contracts, sessions, CSRF, authorization, rate limiting, local cache, health/readiness, and observability hooks |
| Long-running work | `JobQueue` contract with delay, idempotency keys, tags, retry metadata, and bounded shutdown hooks |
| Operations | Deterministic route discovery, isolated `--out-dir` builds, portable deploy artifacts, structured logs, request IDs, metrics hooks, and CI release gates |
| Extensibility | Provider-neutral cache, queue, storage, database, metrics, frontend, AI, and deployment integrations |

## Ecosystem foundation

Ryvax now exposes `createIntegrationRegistry`, `RyvaxIntegration`, `integrationCatalog`, and `findIntegrations` as public APIs. Integrations are independent lifecycle modules with IDs, semantic versions, categories, runtime support, setup/teardown hooks, and explicit peer-dependency boundaries. The core never bundles vendor SDKs, so providers can publish adapters independently and teams can operate them without coupling the framework to one platform.

The catalog currently covers database, cache, queue, storage, identity, frontend, AI, observability, testing, and deployment families. Catalog entries are discoverability metadata; a listed provider is not automatically an implemented official adapter. Official adapters must ship contract tests, security notes, support policy, compatibility matrices, and failure semantics.

React Server Components are an explicit experimental track. Ryvax 1.1 supports SSR, SSG, hydration, and streaming; a future RSC adapter will own the Flight protocol and client reference manifest while Ryvax owns routing, abort propagation, HTTP limits, caching, and deployment lifecycle. This boundary lets the ecosystem grow without making experimental React APIs mandatory for every application.

## Request and response contracts

Every Node request receives an `AbortSignal` through `RequestContext.signal`. The signal aborts when the client disconnects, the request deadline expires, or the response closes. Pass it to database drivers, model clients, storage, and custom streaming code.

Malformed JSON with an `application/json` content type returns HTTP `400` with a stable JSON error. Bodies remain bounded by `limits.bodyBytes` and return `413` when the limit is exceeded. `OPTIONS` automatically returns `Allow` when a route exports methods. `HEAD` uses an explicit `HEAD` handler or the `GET` handler and never sends a body. Async byte streams are written incrementally and stop on abort or close.

```ts
import type { ApiHandler } from '@kvantjs/ryvax.js';

export const POST: ApiHandler = async ({ body, signal }) => {
  await validateAndPersist(body, { signal });
  return { status: 201, json: { created: true } };
};
```

Applications can supply a health registry to expose JSON `/health` and `/ready` endpoints. A non-`ok` report returns `503`, and the report includes check status, latency, tags when provided, and an ISO timestamp.

## Streaming, agents, and training workflows

Ryvax supports streaming as an explicit transport primitive. An API can return an `AsyncIterable<Uint8Array>` for NDJSON, SSE, token output, progress, or another byte protocol. React pages and API responses can also use React's server streaming renderer. This makes Ryvax useful as a deterministic boundary around AI agents, inference, evaluation, and training orchestration: jobs can submit or resume durable work, and streams can expose progress or partial output to connected clients.

Ryvax does **not** include a model provider, train a model automatically, guarantee model quality, or turn a request into durable work by magic. Persist checkpoints and outputs in durable storage, use queue idempotency keys, propagate cancellation, and define data governance, retention, consent, secret handling, evaluation, and failure recovery in the application.

```ts
export async function POST({ signal }: RequestContext) {
  async function* progress() {
    yield new TextEncoder().encode('{"event":"started"}\n');
    await runEvaluation({ signal });
    yield new TextEncoder().encode('{"event":"completed"}\n');
  }
  return { stream: progress(), headers: { 'Content-Type': 'application/x-ndjson' } };
}
```

## Cache and platform adapters

The local `ResponseCache` supports TTL, `getFresh`, stale-while-revalidate, concurrent-miss deduplication, tags, tag invalidation, path invalidation through `invalidatePath`/`revalidatePath`, a configurable entry limit, and basic counters. It is process-scoped and disposable. Multi-instance deployments should use a distributed adapter.

For data caching across instances, `createDataCache` accepts a `CacheAdapter` and makes scope explicit: `request`, `public`, or `private`. Private entries require a `varyKey`, preventing accidental sharing between users. `assertValidClientModule` and `assertRscSerializable` provide build-time/runtime diagnostics for the supported server/client boundary.

The public `CacheAdapter`, `JobQueue`, `StorageAdapter`, and `MetricsAdapter` interfaces are intentionally small. Optional methods add fresh reads, tag invalidation, abort signals, idempotency metadata, gauges, flush, and bounded close behavior without invalidating the original `get`, `set`, `delete`, `enqueue`, or metric methods.

| Area | Development | Production |
| --- | --- | --- |
| Database | SQLite or a test adapter | PostgreSQL, managed SQL, Prisma, Drizzle, or another reviewed adapter |
| Cache | Process-local memory | Redis or another distributed cache |
| Jobs | Local fake | Durable queue with retries and dead-letter handling |
| Files | Temporary local storage | S3-compatible or managed object storage |
| Observability | Structured console logs | Metrics/tracing exporter and centralized logs |

## Configuration

Ryvax loads `framework.config.ts`, `framework.config.mts`, `framework.config.js`, or `framework.config.mjs`. TypeScript configuration is compiled with esbuild. `.env` and `.env.local` values are available without replacing variables already defined by the process.

```ts
import type { AppConfig } from '@kvantjs/ryvax.js';

export default {
  poweredBy: false,
  cache: { enabled: true, defaultTtl: 30, staleWhileRevalidate: 60, maxEntries: 10_000 },
  observability: { requestId: true, requestLogging: false },
  limits: { bodyBytes: 2 * 1024 * 1024, requestTimeoutMs: 60_000, shutdownTimeoutMs: 10_000 }
} satisfies AppConfig;
```

## CLI commands

| Command | Result |
| --- | --- |
| `ryvax create <name>` | Creates a React TypeScript application |
| `ryvax create <name> --template saas` | Creates the SaaS starter |
| `ryvax dev --port 3000 --out-dir .meu-dev` | Builds, starts, and watches with HMR |
| `ryvax build --out-dir .meu` | Builds production bundles and SSG pages |
| `ryvax start --out-dir .meu --port 3000` | Starts a selected production manifest |
| `ryvax export --out-dir dist` | Generates a static site for a CDN |
| `ryvax deploy --out-dir dist` | Generates a portable Node deployment package |
| `ryvax routes --json` | Emits a scriptable route manifest projection |
| `ryvax doctor --out-dir .meu` | Checks Node, dependencies, routes, scripts, and manifest health |

Use different `--out-dir` values for concurrent processes. Unknown options and invalid ports fail early rather than being silently ignored. `ryvax doctor` reports warnings for optional or missing build artifacts and exits non-zero for missing prerequisites.

## Deployment

The `deploy` command creates a conventional Node artifact with `server.mjs`, `.meu/manifest.json`, route bundles, public files, and a minimal package manifest.

```bash
npm run deploy
PORT=8080 node dist/server.mjs
```

Only SSG pages are exported to static hosting. API routes, SSR, streaming, and dynamic pages without generated paths require the Node runtime. Use a durable queue and distributed cache when running multiple instances.

## Development and quality gates

```bash
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
npm audit --audit-level=high
```

CI verifies Node.js 20, 22, and 24, package contents, a packed-package smoke import, and the security audit. This repository deliberately does not claim a lint or format command unless the corresponding tool is installed and configured.

## Compatibility

The documented exports of `@kvantjs/ryvax.js` and `@kvantjs/ryvax.js/client` follow semantic versioning. Existing fields and methods remain supported in the 1.x line; new optional fields and methods are additive. Read [API-COMPATIBILITY.md](./API-COMPATIBILITY.md), [CHANGELOG.md](./CHANGELOG.md), [SECURITY.md](./SECURITY.md), and the [operations documentation](./docs/site/operations/release-checks.mdx) before a future release. The canonical documentation source is maintained in [`docs/site/`](./docs/site/).

## References

- [Node.js HTTP API](https://nodejs.org/api/http.html)
- [esbuild API](https://esbuild.github.io/api/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [React server rendering](https://react.dev/reference/react-dom/server)
- [Zod](https://zod.dev/)
