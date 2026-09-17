# Build system — Phase 1

## Status

Phase 1 introduces the first stable internal boundary between Ryvax.js semantics and bundler engines. It is intentionally incremental: existing route, SSR, SSG, action, deployment, and CLI behavior remains compatible while the framework gains a graph and artifact vocabulary that later phases can extend.

## What changed

### Bundler contract

`src/build/types.ts` now defines the internal vocabulary used by the orchestrator and backend adapters:

- `BuildContext` describes root, mode, target, entries, options, and the optional module graph;
- `BuildArtifact` distinguishes entries, chunks, assets, and source maps;
- `BuildManifest` gives the framework a backend-neutral output description;
- `BuildOutput` can carry artifacts and a manifest;
- `BuildBackend` may compile framework configuration through an adapter.

The rest of Ryvax does not need to call an esbuild or Rolldown API directly for ordinary application builds.

### Module graph

`src/build/graph.ts` provides a deliberately small graph implementation for the first phase. It records:

- module identity and path;
- static local imports;
- dynamic import specifiers;
- source/import hashes;
- modification time;
- entrypoints and project root.

`invalidateModuleGraph()` propagates a changed module to importers. Dynamic imports are included as graph nodes but remain separate from the static dependency list, which is required for future code-splitting decisions.

### Orchestrator integration

The build orchestrator now creates a graph for each entry and writes backend-neutral diagnostics to the configured output directory:

- `module-graph.json`;
- `build-manifest.json`, when the backend returns one.

The graph is metadata owned by Ryvax. A backend can still decide how to link, split, tree-shake, minify, and emit files.

### Configuration loading

Framework configuration compilation now goes through the esbuild adapter rather than importing esbuild directly from `src/config.ts`. This keeps the current configuration path stable while making the compiler boundary explicit. Configuration compilation remains esbuild-backed in Phase 1 as a compatibility and transition path.

## Current backend policy

- `esbuild` remains the stable compatibility backend.
- `rolldown` remains selectable and validated through the existing backend harness.
- `auto` continues to choose deterministically from project complexity.
- The framework does not yet claim that Rolldown is superior for every workload.

Select a backend explicitly when investigating behavior:

```bash
ryvax build --builder=esbuild
ryvax build --builder=rolldown
ryvax build --builder=auto
```

## Validation

The Phase 1 acceptance loop is:

```bash
npm ci
npm run typecheck
npm test
npm run build
node scripts/validate-build-backends.mjs
```

The current repository validation passes with 47 tests, TypeScript compilation, production build, and the `esbuild`, `auto`, and `rolldown` backend fixture checks.

## Deliberate non-goals

Phase 1 does not yet implement multi-entry batch linking, shared chunk policy, persistent graph caching, CSS/asset manifest ownership, HMR invalidation through the graph, or worker/edge-specific output policies. Those features require more evidence and are planned as separate phases rather than being hidden behind a superficial bundler rename.

## Next phase

Phase 2 should add a batch build API and normalized output manifest. It should then introduce shared chunks, dynamic-import boundaries, source-map and asset records, and cache keys that include source, configuration, framework version, backend version, target, plugins, and relevant environment inputs.
