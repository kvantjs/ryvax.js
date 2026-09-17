# TypeScript and IDE integration

Ryvax provides an optional TypeScript Server Plugin and a deterministic type-generation fallback. The plugin is a development-time enhancement; it is never imported by the runtime and the application remains functional when an editor does not load it.

## Enable the plugin

Add the official plugin to the consumer project's `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@kvantjs/ryvax.js/typescript-plugin" }]
  }
}
```

The plugin uses the TypeScript Language Service APIs. It discovers the workspace from the active project, reads `pages/` and `app/`, adds route completions inside `route("...")`, and warns when a route module exports neither a default page handler nor an HTTP method handler. It does not change runtime compilation, route matching, or package execution.

Because TypeScript plugins are editor features, `tsc` does not execute them. Use generated declarations for CI and environments without tsserver plugin support:

```bash
npx ryvax generate
```

The command creates `.ryvax/routes.d.ts` and `.ryvax/config.d.ts`. These files are generated, deterministic, and must not be edited manually. Add `.ryvax/` to the project's `tsconfig.json` includes only if the project needs to reference the declarations explicitly.

## Typed configuration

Use `defineConfig` to preserve inference and constrain framework settings:

```ts
import { defineConfig } from '@kvantjs/ryvax.js';

export default defineConfig({
  host: '0.0.0.0',
  port: 3000,
  observability: { requestLogging: false }
});
```

The existing `framework.config.*` loader remains compatible. `defineConfig` is an identity function at runtime and therefore cannot make the plugin a runtime dependency.

## Environment behavior

VS Code and Cursor generally load TypeScript plugins through the workspace TypeScript version. Replit and Codespaces can use the same npm package and generated declarations. TypeScript CLI checks remain independent of the plugin. If an editor does not support plugins, route types and the normal compiler remain the fallback.

## Design boundaries

The current plugin intentionally does not claim full semantic inference for every route parameter, redirects, rewrites, or editor-specific navigation. The compiler remains authoritative for route discovery. Future enhancements should extend the generated declaration contract rather than duplicate runtime routing logic.

## References

[1]: https://www.typescriptlang.org/tsconfig/#plugins "TypeScript compiler plugin configuration"
[2]: https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin "Writing a TypeScript Language Service Plugin"
[3]: https://github.com/kvantjs/ryvax.js/blob/main/src/dx-generate.ts "Ryvax generated DX types"
