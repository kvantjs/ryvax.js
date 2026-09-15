# Sistema de build adaptativo

O Ryvax.js seleciona o backend de bundling por projeto e permite override explícito.

## Uso

```bash
ryvax build --builder=auto
ryvax build --builder=esbuild
ryvax build --builder=rolldown
ryvax build --profile
```

Também é possível definir:

```bash
RYVAX_BUILDER=rolldown ryvax build
RYVAX_VERBOSE_BUILD=true ryvax build
```

O modo `auto` calcula um score determinístico com base em módulos locais, dependências externas, imports dinâmicos, quantidade de entries e workspaces. Projetos menores permanecem no esbuild; grafos maiores ou com splitting dinâmico são encaminhados ao Rolldown.

## Garantias da primeira versão

O adapter esbuild mantém o comportamento atual de rotas, SSR, API, client bundle, source maps, minificação e dependências externas. O adapter Rolldown é opt-in/auto para grafos complexos e gera o mesmo contrato de arquivo `.mjs` consumido pelo manifesto atual.

A seleção é exibida quando `--profile` ou `RYVAX_VERBOSE_BUILD=true` está ativo. Com `--profile`, o relatório é salvo como `build-profile.json` dentro do diretório de saída.

## Limites atuais

O sistema já separa a escolha do backend do compilador, mas o manifesto de chunks e a invalidação fina de módulos ainda estão em evolução. O modo Rolldown deve ser validado com a matriz de aplicações do projeto antes de ser considerado uma garantia de compatibilidade para todos os plugins.
