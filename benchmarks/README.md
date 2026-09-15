# Ryvax benchmarks

The HTTP harness reports throughput, p50, p95, p99, error count, warmup count, and elapsed time. It does not claim general framework superiority. Record Node.js version, operating system, CPU, memory, route work, payload, concurrency model, and whether the run is loopback or networked alongside every result.

```bash
node benchmarks/http-harness.mjs http://127.0.0.1:3000/ 1000 100
```

Comparisons are valid only when the competing applications perform equivalent work and use the same runtime, payload, warmup, request count, concurrency model, and measurement method.

## Project scaling harness

After building the repository, run the deterministic route-scaling harness:

```bash
npm run build
node benchmarks/project-harness.mjs
```

It measures production build time for applications with 10, 100, and 1,000 generated routes. The output includes the Node.js version and generated route count so results can be reproduced and compared fairly. These measurements describe this repository and workload only; they are not a general claim about framework superiority.

The CLI benchmark also reports raw, gzip, and Brotli bundle bytes, plus the client/server split and the number of routes that require no client JavaScript:

```bash
npm run build
node dist/src/cli/index.js benchmark --json
```

The client-byte number is the framework's initial client entry measurement. It does not claim that every route is free of browser JavaScript when a shared client entry exists. Use route-level bundle analysis and browser metrics such as LCP and INP for product decisions.
