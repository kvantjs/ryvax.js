# Changelog

## [Unreleased]

- Added the adaptive build orchestrator with deterministic complexity analysis, `--builder=auto|esbuild|rolldown`, `RYVAX_BUILDER`, build profiling, and explicit backend diagnostics.
- Added a Rolldown backend alongside the compatibility-preserving esbuild backend, plus automated selection tests and backend fixture validation.
- Added build-system architecture documentation and migration guidance for future module-graph, code-splitting, cache, and incremental-build work.

## [2.1.3] - 2026-09-11

- Added persisted project graphs, structured route inspection, bundle analysis, and reproducible project benchmarks.
- Added request-scoped data-cache deduplication, preload, tag/path invalidation, and cache statistics.
- Added server/client boundary diagnostics for Node imports and private environment variables.
- Added explicit Node and Edge runtime capability checks and a production Docker deployment adapter.
- Added typed API client, progressive-enhancement forms, bounded streaming, SSE, request lifecycle tracing, local storage, and in-memory pub/sub primitives.
- Added a reference application fixture and conformance coverage for build, routes, API, streaming, and deployment artifacts.

## [2.1.2] - 2026-09-10

- Added static export support for dynamic App Router pages that provide `generateStaticParams` without requiring `getStaticProps`.
- Preserved existing `getStaticProps` and `getStaticPaths` behavior and added integration coverage for generated route output.

## [2.1.0] - 2026-09-09

- Migrated the complete Mintlify documentation source into the canonical Scalar Docs tree under `docs/site/`.
- Added `scalar.config.json`, Scalar navigation, asset mapping, documentation migration notes, and a GitHub Actions workflow for Scalar publication.
- The release workflows authenticate Scalar with `SCALAR_API_KEY` and publish the project slug from `SCALAR_PROJECT_SLUG` (default: `ryvax`); npm supports either `NPM_TOKEN` or configured npm trusted publishing.
- Preserved all existing guides, references, operations pages, images, and MDX content during migration.

- Added initial App Router-compatible route conventions: `app/` pages and route handlers, `page`/`route` files, route groups, optional catch-all segments, `generateStaticParams`, and deterministic specificity ordering, while preserving the existing `pages/` router.
- Added persistent app layouts compiled from `layout` boundaries and applied from the outermost to the innermost route segment.
- Added app `error` and `not-found` boundaries with safe HTTP status handling and legacy fallbacks when boundaries are absent.
- Added `forbidden.tsx` and `unauthorized.tsx` boundaries for page errors carrying HTTP 403/401 status, plus nonce-based CSP and optional Trusted Types security presets.
- Added typed Server Actions under `actions/`, validated invocation through `/_meu/action/:id`, origin checks, serializable payloads, and configurable action limits.
- Added client-side `Link`, router navigation, cancellable prefetch, and refresh primitives.
- Added safe web primitives for responsive images, metadata, scripts, JSON-LD, and deployment capability validation.
- Added server/client module-boundary diagnostics, RSC serializability checks, and scoped request/process/remote data-cache helpers.
- Added bounded `AuditLog`/`AuditSink` primitives for authentication and administrative security events, plus generated `routes.d.ts` build output.
- Added CSRF and timeout enforcement to Server Actions, `loading` boundaries, named parallel slots, plugin lifecycle permissions, deployment adapter presets, SEO file helpers, and the `create-ryvax-app` executable alias.
- Added public deployment compatibility matrix, routing/actions/cache RFC, security threat model, persistent bundle cache configuration, and package subpath exports for web/SEO/adapters.
- Added `ryvax routes --json`, cache `invalidatePath`/`revalidatePath`, and cache `revalidateTag` aliases for scriptable inspection and invalidation.
- Updated the npm release workflow to run on semver tags and publish with npm provenance after verification gates.
- Added a transactional SQL migration runner with checksums, status, rollback, and a migration scaffold command.
- Added retry with jitter, circuit breakers, bounded upstream fetch policy, and SSRF URL validation.
- Added an in-memory job queue reference with idempotency, retries, concurrency, and dead-letter capture.
- Added provider-agnostic metrics and tracing contracts for OpenTelemetry integration.
- Added `ryvax routes` and expanded `ryvax migrate` CLI support.

## [2.0.0] - 2026-09-07

This consolidated release introduces the production platform foundation described in the Ryvax upgrade plan. `RequestContext` now includes a required `AbortSignal`; applications implementing the interface manually must add `signal` when migrating from 1.x.

- Added request cancellation through `AbortSignal` in Node and Edge request contexts.
- Added bounded graceful shutdown with socket draining and a configurable shutdown timeout.
- Added health-check deadlines with deterministic failure reports.
- Added cache policies for stale-while-revalidate, tags, tag invalidation, and concurrent-miss deduplication.
- Added the `ryvax doctor` CLI diagnostic command.
- Added transactional SQL migrations with checksums, status reporting, rollback, and `ryvax migrate create` scaffolding.
- Added retry with jitter, circuit breakers, bounded upstream fetch policy, and SSRF URL validation.
- Added a reference job queue with idempotency, concurrency, retries, and dead-letter capture.
- Added provider-neutral metrics and tracing contracts for OpenTelemetry integration.
- Added the `ryvax routes` diagnostic command and the Kvant ownership/package namespace migration.

## [1.0.0] - 2026-09-06

- Documented the public API with a semantic-versioning compatibility contract.
- Added parameterized SQL with PostgreSQL and SQLite adapters.
- Added role and permission authorization with local rate limiting.
- Added a health/readiness registry and cache, jobs, storage, and metrics contracts.
- Stabilized the React full-stack core with SSR, SSG, streaming, authentication, and production security.

## [0.4.0] - 2026-09-06

- Added configurable body limits and HTTP 413 responses for oversized payloads.
- Added configurable request timeouts in the Node server.
- Added HMAC-SHA-256 sessions, secure cookies, and CSRF tokens.
- Added a typed SaaS starter and a Node 20/22/24 CI matrix.
- Added security policy, contribution guide, code of conduct, adapters, and roadmap documentation.

## [0.3.0] - 2026-09-06

- Added React-first SSR, SSG, and hydration.
- Added streaming SSR with `renderToPipeableStream`.
- Added `hydrate` and `mount` helpers in `@kvantjs/ryvax.js/client`.
- Added a complete React CLI template.
- Added a reproducible React benchmark against the Next.js Pages Router.

[2.1.3]: https://github.com/kvantjs/ryvax.js/releases/tag/v2.1.3
[2.0.0]: https://github.com/kvantjs/ryvax.js/releases/tag/v2.0.0
[1.0.0]: https://github.com/kvantjs/ryvax.js/releases/tag/v1.0.0
[0.4.0]: https://github.com/kvantjs/ryvax.js/releases/tag/v0.4.0
[0.3.0]: https://github.com/kvantjs/ryvax.js/releases/tag/v0.3.0
