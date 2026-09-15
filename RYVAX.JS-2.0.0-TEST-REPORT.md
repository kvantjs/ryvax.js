# Ryvax 2.0.0 Test Report

## Scope

This report records the validation performed against Ryvax 2.0.0 (`@kvantjs/ryvax.js`) on 9 September 2026. The validation covers the local source checkout and a clean consumer installation of the public npm package. It is not a claim of multi-region production readiness or a replacement for an independent benchmark on application-specific workloads.

## Results

| Area | Result | Evidence |
| --- | --- | --- |
| TypeScript typecheck | Passed | `npm run typecheck` |
| Unit/integration suite | Passed | 18 tests passed, 0 failed |
| Production build | Passed | `npm run build` |
| Dependency audit | Passed | `npm audit --audit-level=high`: 0 vulnerabilities |
| CLI doctor | Passed | Node.js and project checks completed |
| Migration scaffolding | Passed | Created `0001_add_users.up.sql` and `.down.sql` |
| Public package smoke test | Passed | Clean install of `@kvantjs/ryvax.js@2.0.0` |
| Client subpath smoke test | Passed | `@kvantjs/ryvax.js/client` exports `hydrate` and `mount` |
| HTTP load test, 1,000 requests | Passed | 50 concurrent clients, 0 failures |
| HTTP load test, 5,000 requests | Passed | 100 concurrent clients, 0 failures |

## Functional coverage

The existing test suite exercised signed sessions, tamper rejection, CSRF verification, parameterized SQL, authorization, rate limiting, health checks, static and dynamic routing, catch-all routing, cache expiration, stale-while-revalidate, tag invalidation, stampede protection, middleware, body validation, build manifests, SSR, SSG, React rendering, streaming responses, static assets, module caching, the Edge adapter, environment loading, structured logging, redaction, health deadlines, SSRF protection, retry, circuit breaking, jobs, idempotency, dead letters, migrations, and checksum detection.

## Load measurements

The local HTTP load test used a generated `/api/ping` route and loopback networking. It measured complete request latency from the Node.js client.

| Run | Requests | Concurrency | Failures | Throughput | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 1,000 | 50 | 0 | 1,073 req/s | 37.13 ms | 70.12 ms | 294.52 ms |
| B | 5,000 | 100 | 0 | 1,586 req/s | 51.04 ms | 75.41 ms | 573.64 ms |

These numbers are **local single-process measurements**, not a comparison with Next.js and not a guarantee for production traffic. The p99 tail increased under higher concurrency, so production capacity planning should include application rendering cost, database latency, external providers, memory limits, and multiple process/instance behavior.

## Public package verification

A clean temporary consumer installed `@kvantjs/ryvax.js@2.0.0` from the npm registry and successfully imported the following server exports:

- `createAppServer`
- `createHealthRegistry`
- `createMigrationRunner`
- `InMemoryJobQueue`
- `withRetry`
- `assertSafeUrl`

The client subpath also imported `hydrate` and `mount` successfully.

## Security verification

The checks confirmed session signature validation, CSRF token comparison, request body limits, security headers, private-network SSRF rejection, host allowlisting, health-check deadlines, retry/circuit behavior, structured-log redaction, and graceful request cancellation contracts. This is automated regression coverage, not a penetration test or formal security audit.

## Limitations and next tests

The current results do not establish behavior under distributed queues, durable database contention, real TLS termination, reverse proxies, multi-process clustering, long-lived streaming connections, malicious HTTP parser traffic, browser compatibility matrices, or sustained multi-hour load. Those areas require an environment representative of the intended deployment and should be tested before making a high-traffic production commitment.

## Conclusion

Ryvax 2.0.0 passed all automated checks executed in this validation cycle. The public npm package is installable and its primary server and client entry points are usable from a clean consumer project. The load tests completed with zero request failures at 1,000 and 5,000 request workloads, while the observed p99 latency demonstrates that additional production-scale capacity testing remains appropriate.
