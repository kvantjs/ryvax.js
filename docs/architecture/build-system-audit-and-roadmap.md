# Auditoria e plano de evolução do sistema de build do Ryvax.js

**Data da auditoria:** 14 de setembro de 2026  
**Versão auditada:** `@kvantjs/ryvax.js@2.1.3`  
**Escopo:** arquitetura de compilação, bundling, runtime, desenvolvimento, compatibilidade e preparação para aplicações de grande escala.

## Conclusão executiva

O Ryvax.js possui uma base de runtime madura para o escopo atualmente testado: a auditoria local passou em **41 testes**, `typecheck` e `build`. Entretanto, o sistema de bundling ainda está fortemente acoplado ao esbuild em um compilador localizado em `example/framework/src/compiler.ts`. Esse compilador gera bundles independentes por rota, um bundle opcional de cliente e um manifesto, mas ainda não constitui uma camada de bundler substituível para o framework publicado.

A migração correta não é trocar diretamente esbuild por outro pacote. A recomendação é introduzir primeiro um contrato interno de build do Ryvax, preservar o backend esbuild como implementação estável, adicionar observabilidade e testes de equivalência, e só depois integrar Rolldown atrás desse contrato. Rolldown é o candidato prioritário para o backend seguinte porque possui API standalone, code splitting, tree shaking, resolução ESM/CJS e compatibilidade próxima com Rollup. Seus recursos de `watch`, build incremental e minificação devem ser tratados como capacidades sujeitas a validação na versão fixada.

Rspack é uma alternativa tecnicamente forte para um protótipo posterior, especialmente se o Ryvax precisar de uma cobertura maior do ecossistema webpack. Turbopack não é recomendado como backend primário neste momento, pois sua superfície pública documentada continua centrada em Next.js e não oferece um contrato standalone de compilação e plugins adequado ao Ryvax.

Nenhum código de produção foi alterado nesta etapa. Nenhuma versão foi incrementada ou publicada.

## Estado atual auditado

| Área | Evidência encontrada | Diagnóstico |
|---|---|---|
| Pacote publicado | `package.json` na versão `2.1.3` | O pacote principal expõe runtime, tipos e CLI; a camada de compilação precisa ser formalizada antes de ampliar o backend. |
| Compilador | `example/framework/src/compiler.ts` | Concentra descoberta de rotas, chamadas ao esbuild, manifesto, export estático, deploy e watch. |
| Bundling de servidor | `esbuild.build()` por arquivo de rota | Cada rota é empacotada individualmente para Node/ESM, com `packages: external`. |
| Bundling de cliente | `buildClient()` usa `esbuild.build()` | Há um único bundle `static/client.js`; não existe política geral de entries, chunks, manifestos de assets ou workers. |
| Desenvolvimento | `chokidar` + debounce de 80 ms + rebuild completo | O watcher evita builds concorrentes, mas a mudança invalida a aplicação inteira; não há grafo incremental persistente. |
| Runtime | Manifesto com rotas e bundles | O runtime conhece caminhos de bundles e importa módulos gerados, mas não conhece uma abstração de bundler. |
| Testes | `tests/framework.test.ts`, `tests/conformance.test.ts`, `tests/deployment-build.test.ts` | Há cobertura funcional significativa, porém não há matriz de backends, snapshots de chunks, testes de equivalência ou benchmarks do bundler. |
| Dependências | `esbuild` é dependência direta; `chokidar` também | Rolldown, Rspack e Rollup ainda não fazem parte do contrato do pacote. |
| Publicação | `prepublishOnly` executa `npm run build` | A publicação deve aguardar a implementação, testes e configuração do trusted publishing para a versão aprovada. |

## Mapa atual de execução

```text
Projeto do usuário
      ↓
Descoberta de pages/
      ↓
fileToRoutePath() e classificação API/SSR
      ↓
esbuild.build() uma vez por rota
      ↓
.meu/routes/*.mjs
      ↓
Manifesto de rotas
      ↓
Runtime Node/Edge e geração estática
```

Para o cliente, o fluxo atual é:

```text
src/client.ts(x)
      ↓
findClientEntry()
      ↓
esbuild.build(platform=browser, format=esm)
      ↓
.meu/static/client.js
```

O watch atual é:

```text
Mudança de arquivo
      ↓
chokidar
      ↓
debounce de 80 ms
      ↓
buildProject() completo
      ↓
onBuild(manifest)
```

## Pontos de acoplamento identificados

1. `example/framework/src/compiler.ts` importa diretamente `esbuild`.
2. `buildProject()` conhece a forma exata de configurar `entryPoints`, `outfile`, `platform`, `format`, `target`, `packages`, `sourcemap`, `minify` e `legalComments` do esbuild.
3. `buildClient()` assume que um único `outfile` é suficiente para o cliente.
4. O manifesto guarda caminhos de arquivos produzidos, mas não descreve chunks, imports dinâmicos, assets, integridade, targets ou relação entry/chunk.
5. `watchProject()` reconstrói todo o projeto e não recebe eventos de invalidation por módulo.
6. `exportStaticSite()` e `prepareDeploy()` dependem da organização `.meu/routes` e `.meu/static`, sem uma camada de artefatos independente do bundler.
7. A configuração pública ainda não possui opções de `target`, `splitting`, `minify`, `sourcemap`, `builder`, `cache` ou `profile` traduzidas por um orquestrador.
8. O código compilador encontrado está dentro do exemplo de framework. Antes de publicar um novo backend, ele deve ser promovido ou conectado explicitamente à implementação distribuída pelo pacote principal.

## Arquitetura alvo

```text
Ryvax Framework
├── Application Semantics
│   ├── routing
│   ├── SSR / CSR / SSG
│   ├── hydration
│   ├── server/client/worker/edge boundaries
│   ├── actions and middleware
│   └── asset semantics
├── Compiler
│   ├── source discovery
│   ├── framework transforms
│   ├── boundary analysis
│   ├── entry generation
│   └── diagnostics
├── Module Graph
│   ├── resolved modules
│   ├── dynamic imports
│   ├── invalidation
│   ├── cache keys
│   └── entries/chunks/assets
├── Build Orchestrator
│   ├── project complexity analysis
│   ├── backend selection
│   ├── lifecycle and concurrency
│   ├── profiling
│   └── normalized artifacts
├── Optimizer
│   ├── minification
│   ├── tree-shaking policy
│   ├── chunk policy
│   └── asset optimization
├── Dev Infrastructure
│   ├── watcher
│   ├── incremental rebuild
│   ├── HMR boundary
│   └── error overlay/reporting
└── Bundler Adapter
    ├── EsbuildBackend
    ├── RolldownBackend
    ├── future RspackBackend
    └── future backend
```

O restante do Ryvax deve consumir um resultado normalizado. Ele não deve importar tipos ou opções específicas do esbuild, Rolldown ou Rspack.

## Contratos internos propostos

Os contratos abaixo são mockups arquiteturais. Eles não devem ser copiados sem adaptar aos tipos existentes.

```ts
export type RyvaxBuildTarget = 'node' | 'browser' | 'edge' | 'worker';
export type RyvaxBuildMode = 'development' | 'production';
export type RyvaxBuilderName = 'auto' | 'esbuild' | 'rolldown' | 'rspack';

export interface RyvaxBuildContext {
  rootDir: string;
  outDir: string;
  mode: RyvaxBuildMode;
  target: RyvaxBuildTarget;
  entries: RyvaxEntry[];
  config: RyvaxBuildConfig;
  graph?: RyvaxModuleGraph;
  cache?: RyvaxBuildCache;
  diagnostics?: RyvaxDiagnostics;
}

export interface RyvaxEntry {
  id: string;
  file: string;
  kind: 'route' | 'client' | 'server' | 'worker' | 'edge';
}

export interface RyvaxBundler {
  readonly name: Exclude<RyvaxBuilderName, 'auto'>;
  build(context: RyvaxBuildContext): Promise<RyvaxBuildResult>;
  watch?(context: RyvaxBuildContext, callbacks: RyvaxWatchCallbacks): Promise<RyvaxBuildWatcher>;
}

export interface RyvaxBuildResult {
  backend: string;
  entries: RyvaxOutputEntry[];
  chunks: RyvaxOutputChunk[];
  assets: RyvaxOutputAsset[];
  diagnostics: RyvaxDiagnostic[];
  profile: RyvaxBuildProfile;
}
```

A configuração pública deve permanecer orientada ao Ryvax:

```ts
export interface RyvaxBuildConfig {
  builder?: 'auto' | 'esbuild' | 'rolldown' | 'rspack';
  target?: RyvaxBuildTarget;
  splitting?: boolean;
  minify?: boolean;
  sourcemap?: boolean;
  cache?: boolean | 'memory' | 'filesystem';
  profile?: boolean;
  externals?: string[];
}
```

O override de CLI pode ser:

```text
ryvax build --builder=esbuild
ryvax build --builder=rolldown
ryvax build --builder=auto --profile
```

A forma `--ryvax-builder=rollup-down` não deve ser adotada como API principal: além de conter uma grafia ambígua, mistura o nome de uma estratégia com o nome de uma implementação. Recomenda-se `--builder=rolldown` e `RYVAX_BUILDER=rolldown`.

## Seleção automática de backend

A seleção automática deve ser determinística, explicável e observável. Não deve depender apenas do número de arquivos.

### Sinais de complexidade

| Sinal | Exemplo de medição |
|---|---|
| Módulos locais | Contagem de arquivos alcançáveis por entrypoint |
| Dependências externas | Pacotes resolvidos no grafo |
| Dynamic imports | Quantidade e profundidade dos split points |
| Entrypoints | Rotas, cliente, servidor, workers e edge |
| Monorepo | Workspaces, symlinks e boundaries de pacote |
| Targets | Quantidade de ambientes e formatos de saída |
| CSS/assets | Volume de imports e arquivos processados |
| Runtime boundaries | Server/client/worker/edge crossings |
| Cache | Existência de cache válido e taxa histórica de hit |
| Requisitos avançados | Splitting, manifest, source maps e plugins |

A primeira implementação deve produzir um relatório de decisão antes de executar o build:

```text
Ryvax build: builder=auto
Ryvax build: modules=42 externalDependencies=8 dynamicImports=0 entries=3
Ryvax build: selected backend=esbuild reason="small graph, one target, no advanced splitting"
```

Para um projeto grande:

```text
Ryvax build: builder=auto
Ryvax build: modules=18420 externalDependencies=126 dynamicImports=37 entries=28
Ryvax build: selected backend=rolldown reason="multi-entry graph with dynamic splitting"
```

Os limiares devem ser configuráveis e inicialmente tratados como heurística experimental. O override explícito sempre vence a seleção automática.

## Estratégia de backends

| Backend | Decisão | Motivo |
|---|---|---|
| esbuild | Manter como backend estável e fallback | API agnóstica, rápida, TypeScript/JSX, ESM/CJS, tree shaking e watch; code splitting avançado e HMR de JavaScript têm limitações documentadas. |
| Rolldown | Priorizar como segundo backend | API standalone, code splitting, tree shaking, ESM/CJS e compatibilidade próxima com Rollup. Watch, incremental e minificação devem ser validados na versão fixada. |
| Rspack | Manter como alternativa de pesquisa | Forte em aplicações grandes, chunks, watch/incremental e ecossistema webpack; exige cuidado com ciclo de vida do Compiler e compatibilidade parcial de plugins. |
| Turbopack | Não adotar como backend primário agora | A superfície oficial continua centrada no Next.js; não há contrato standalone geral de build, watch, targets e plugins para o Ryvax. |

A recomendação é fixar versões exatas dos backends durante a fase experimental e só ampliar o intervalo de versões depois de uma matriz de compatibilidade automatizada.

## Roadmap de implementação

### Fase 1 — Auditoria e contratos

Criar o mapa de build, promover os tipos de build para um módulo próprio e introduzir `RyvaxBuildConfig`, `RyvaxBuildContext`, `RyvaxBuildResult` e `RyvaxBundler`. O backend atual deve ser embrulhado em `EsbuildBackend` sem mudar a saída pública.

Arquivos prováveis:

```text
src/build/types.ts
src/build/orchestrator.ts
src/build/backends/esbuild.ts
src/build/complexity.ts
src/build/diagnostics.ts
example/framework/src/compiler.ts
src/config.ts
src/cli/index.ts
```

### Fase 2 — Compatibilidade do backend atual

Mover a lógica de configuração do esbuild para o adapter. Normalizar rotas, client bundle, manifest, export e deploy para consumirem artefatos do contrato Ryvax. Adicionar snapshots dos manifestos e testes de equivalência com a saída anterior.

### Fase 3 — Module graph mínimo

Implementar descoberta e resolução de módulos com metadados leves: source, importer, imports estáticos, dynamic imports, entrypoints, target e invalidation key. A resolução deve reutilizar o backend quando possível, em vez de reinventar Node package exports.

O cache inicial deve ser filesystem-backed e ter chaves baseadas em conteúdo, versão do framework, versão do backend, configuração normalizada, target, modo, plugins e ambiente relevante. A invalidação deve remover somente módulos afetados e dependentes transitivos.

### Fase 4 — Backend Rolldown experimental

Adicionar `RolldownBackend` atrás do mesmo contrato. Começar com um único entry de cliente e uma compilação de produção simples. Em seguida validar múltiplos entries, imports dinâmicos, ESM/CJS, source maps, assets e manifest.

Não habilitar Rolldown automaticamente até que os seguintes testes passem:

- equivalência funcional de rotas SSR e API;
- imports dinâmicos e ordem de execução;
- tree shaking respeitando `sideEffects`;
- source maps;
- client/server boundary;
- output Node, browser, edge e worker;
- export estático;
- reexecução em CI e em monorepo.

### Fase 5 — Seleção automática e CLI

Adicionar o analisador de complexidade, `--builder`, `RYVAX_BUILDER`, relatório `--profile` e mensagens de diagnóstico. O modo `auto` deve continuar escolhendo esbuild para projetos pequenos até que os dados mostrem vantagem real de outro backend.

### Fase 6 — Code splitting e assets

Expandir o manifesto para entries, chunks, imports, assets, hash, tamanho, source map e preload hints. Implementar política route-based splitting, dynamic import splitting e shared chunks. Medir tamanho transferido e quantidade de chunks, não apenas tempo de build.

### Fase 7 — Dev server incremental e HMR

Substituir o rebuild integral por invalidation no grafo. Manter compiladores/watchers de longa duração quando o backend suportar incrementalidade. A camada HMR deve ser responsabilidade do Ryvax, não presumida pelo backend.

### Fase 8 — Validação em escala

Adicionar fixtures minimal, medium, large, huge, monorepo, SSR, CSR, hybrid, worker e edge. Medir cold build, warm build, incremental rebuild, HMR, RAM, número de chunks, JS transferido, output total e latência SSR.

### Fase 9 — Release e depreciação

Somente após a matriz de compatibilidade e os benchmarks: documentar o backend padrão, marcar APIs antigas, atualizar migration guide, revisar dependências e então preparar uma versão minor. A versão `2.3.0` deve ser publicada apenas quando houver uma mudança de API e comportamento suficientemente validada; não deve ser usada como rótulo para um protótipo incompleto.

## Testes e benchmarks necessários

### Testes unitários

Devem cobrir seleção de backend, normalização de configuração, resolução, graph, cache keys, invalidation, plugins, targets, chunk policy, manifest e diagnostics.

### Testes de integração

Devem construir aplicações com SSR, CSR, SSG, hydration, streaming, dynamic imports, CSS, assets, API routes, server actions, edge e workers. Cada fixture deve ser executada pelo esbuild e pelo backend experimental quando a capacidade for suportada.

### Benchmarks

O relatório deve conter pelo menos:

| Métrica | Baseline esbuild | Rolldown | Rspack, se prototipado |
|---|---:|---:|---:|
| Cold build | Medir | Medir | Medir |
| Warm build | Medir | Medir | Medir |
| Incremental rebuild | Medir | Medir | Medir |
| HMR latency | Medir | Medir | Medir |
| Memória máxima | Medir | Medir | Medir |
| Client JS transferido | Medir | Medir | Medir |
| Server bundle | Medir | Medir | Medir |
| Número de chunks | Medir | Medir | Medir |
| Output total | Medir | Medir | Medir |

Nenhuma conclusão de superioridade deve ser publicada sem preencher essa tabela com workloads reais.

## Release e publicação

A publicação da próxima versão deve ocorrer somente depois de:

1. `npm ci` em checkout limpo;
2. `npm run typecheck`;
3. `npm test`;
4. `npm run build`;
5. testes de fixtures e smoke tests dos artefatos;
6. `npm pack --dry-run`;
7. `npm audit --audit-level=high`;
8. validação da matriz de backends;
9. revisão do changelog e migration guide;
10. configuração/validação do npm Trusted Publishing no GitHub Actions.

A publicação pública é uma operação separada da implementação. Nenhuma versão deve ser publicada automaticamente apenas porque o código compila.

## Riscos e limitações atuais

A maior limitação não é a velocidade do esbuild. É a ausência de um contrato de artefatos e de um grafo de módulos sob controle do Ryvax. Uma abstração superficial que apenas renomeie `esbuild.build()` não resolverá code splitting, cache, invalidation, targets, assets, SSR/client separation ou HMR.

Também não é seguro afirmar agora que Rolldown será melhor para todos os projetos. A decisão deve ser por workload e por fase. Esbuild provavelmente continuará sendo melhor para projetos pequenos e builds rápidos; Rolldown deve ser habilitado quando a política de chunks e a escala justificarem; Rspack deve permanecer uma opção caso a compatibilidade com loaders/plugins webpack seja prioritária.

## Próximo passo recomendado

O próximo commit deve conter somente a **Fase 1**: contratos internos, adapter esbuild, seleção explícita de backend e testes de não-regressão. Depois de essa fase passar no CI, o backend Rolldown deve ser adicionado em uma mudança separada e inicialmente opt-in.

Essa ordem preserva a compatibilidade atual, torna o progresso mensurável e evita publicar uma versão `2.3.0` que prometa uma infraestrutura que ainda não foi validada em escala.

## Referências

[1]: https://rolldown.rs/guide/introduction "Rolldown introduction and standalone bundler documentation"
[2]: https://rolldown.rs/guide/plugin-development "Rolldown plugin development and compatibility"
[3]: https://rolldown.rs/in-depth/automatic-code-splitting "Rolldown automatic code splitting"
[4]: https://rolldown.rs/in-depth/dead-code-elimination "Rolldown dead-code elimination and side effects"
[5]: https://rspack.rs/guide/start/introduction "Rspack introduction and production bundler documentation"
[6]: https://rspack.rs/api/javascript-api/architecture "Rspack JavaScript API architecture and compiler lifetimes"
[7]: https://rspack.rs/config/incremental "Rspack incremental compilation"
[8]: https://rspack.rs/guide/optimization/code-splitting "Rspack code splitting"
[9]: https://nextjs.org/docs/app/api-reference/turbopack "Turbopack configuration and current Next.js integration"
[10]: https://vercel.com/blog/turbopack-moving-homes "Vercel announcement about Turbopack architecture and framework focus"
[11]: https://esbuild.github.io/api/ "esbuild API and build options"
[12]: https://esbuild.github.io/faq/ "esbuild FAQ, stability and scope"
[13]: https://esbuild.github.io/plugins/ "esbuild plugin API"
[14]: https://github.com/evanw/esbuild/blob/main/docs/architecture.md "esbuild architecture and linking model"
