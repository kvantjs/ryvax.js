# Upcoming Features Bot

O repositório possui um bot com identidade pública própria para manter a Issue de **Upcoming Features**. O GitHub Actions funciona somente como executor: a autenticação pública é feita por uma **GitHub App**, cujo usuário de bot aparece como autor das alterações e comentários permitidos pela API.

Este é o **segundo bot** do repositório. Ele coexiste com o primeiro bot, definido em `.github/workflows/welcome.yml` e `scripts/welcome.js`, responsável exclusivamente por dar boas-vindas à primeira Issue ou Pull Request de cada contribuidor. Os dois workflows têm eventos, scripts, permissões e responsabilidades separados.

## Arquitetura

O workflow `.github/workflows/upcoming-features.yml` reage a três situações: Pull Request fechado, Release publicada e execução manual. Em Pull Requests, o job continua somente quando `merged` é verdadeiro e a branch de destino pertence à lista configurada. O workflow solicita um token de instalação temporário usando `actions/create-github-app-token`; o script em `scripts/upcoming-features-bot.js` usa esse token para consultar Releases, Tags, Pull Requests, commits, Issues e para criar ou atualizar a Issue pública.

A solução não executa código vindo de Pull Requests. Ela apenas lê metadados e mensagens da API do GitHub. Nenhum token ou chave privada é impresso nos logs.

## Arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `.github/workflows/upcoming-features.yml` | Eventos, permissões do workflow e token temporário da App |
| `upcoming-features.config.json` | Branches, identidade exibida, versão inicial, incremento e categorias |
| `scripts/upcoming-features-bot.js` | Integração com a API, versionamento, coleta, classificação e atualização da Issue |

Não há dependência npm adicional; o bot usa `fetch` nativo do Node.js 22.

## Criar a identidade pública

1. Em GitHub, abra **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Use um nome como `Upcoming Features Bot`, uma descrição equivalente à função do bot e uma URL pública do projeto, por exemplo `https://github.com/kvantjs/ryvax.js`.
3. Desmarque callbacks/webhooks se a App for usada somente pelo workflow. O evento é recebido pelo GitHub Actions.
4. Em **Repository permissions**, configure apenas:
   - **Contents: Read-only**, para consultar tags e Releases;
   - **Issues: Read and write**, para criar e atualizar a Issue pública;
   - **Pull requests: Read-only**, para ler PRs, autores, labels e commits.
5. Instale a App no repositório selecionando **Only select repositories** e escolha o repositório desejado.
6. Gere uma private key em **Private keys**. O arquivo `.pem` deve ser armazenado localmente em segurança e nunca commitado.
7. Copie o **App ID** e configure os seguintes Secrets no repositório em **Settings → Secrets and variables → Actions → New repository secret**:
   - `UPCOMING_FEATURES_APP_ID`: o App ID numérico;
   - `UPCOMING_FEATURES_APP_PRIVATE_KEY`: conteúdo integral da chave PEM.

O token criado em cada execução pertence à instalação da App. Assim, os comentários e alterações na Issue são atribuídos ao usuário da GitHub App, e não ao usuário pessoal que disparou o workflow. A aparência exata do login é definida pelo GitHub para a App; o campo `botLogin` em `upcoming-features.config.json` serve para identificação textual e não altera o login oficial.

## Configuração

Edite `upcoming-features.config.json`:

- `mainBranches`: branches que aceitam merges processáveis;
- `upcomingIssueTitle`: prefixo usado para localizar a Issue pública;
- `initialVersion`: versão explícita usada quando não há Release ou Tag semântica válida;
- `increment`: `patch`, `minor` ou `major`;
- `includeAuthors` e `includePullRequestLinks`: controles de crédito e links;
- `categories`: títulos Markdown personalizáveis;
- `botName`, `botLogin` e `identificationMessage`: identidade textual mostrada no documento.

A versão encontrada é priorizada nesta ordem: Release semântica mais recente, Tag semântica mais recente e `initialVersion`. São aceitos nomes como `v2.3.5`, `2.3.5` e `release-2.3.5`. A próxima versão é apenas uma previsão; o bot nunca cria uma Release automaticamente.

## Issue pública

A primeira execução cria uma Issue como `🚀 Upcoming Features — vX.Y.Z`. Execuções seguintes localizam a Issue aberta pelo prefixo e a atualizam. O documento possui seções configuráveis para funcionalidades, bugs, melhorias, documentação, segurança, breaking changes e outras alterações.

Cada entrada é baseada no título do Pull Request, com link, número e autor. O PR é a unidade de rastreamento: os números já presentes na Issue são ignorados, impedindo duplicação. Quando uma nova Release é publicada, a próxima execução usa a nova versão como base e inicia um novo ciclo; PRs anteriores ao timestamp da Release deixam de ser coletados.

A classificação reconhece Conventional Commits (`feat`, `fix`, `refactor`, `perf`, `docs` etc.), `BREAKING CHANGE`, `!` e labels como `bug`, `enhancement`, `security` e `documentation`. Sem esses sinais, o item vai para **Outras Alterações**; o bot não inventa detalhes ausentes.

## Teste e operação

1. Faça commit e push dos arquivos.
2. Confirme a instalação da App e os dois Secrets.
3. Abra e mescle um PR em `main`, `master` ou `develop`.
4. Em **Actions**, abra a execução `Upcoming Features Bot` e confirme os logs sem segredos.
5. Verifique a Issue pública e o autor exibido como a GitHub App.
6. Use **Run workflow** para reprocessar manualmente.

Casos que devem ser testados: PR fechado sem merge, merge em branch não configurada, ausência de Release, Release `v2.3.5`, tags inválidas, Conventional Commits, PR sem padrão, reprocessamento do mesmo PR, publicação de nova Release, erro HTTP, rate limit e permissões insuficientes. Em erro HTTP o job falha com status e endpoint, sem imprimir token; em rate limit o log informa que o limite foi excedido e, quando disponível, o horário de reset.

## Exemplo

Com Release `v2.3.5`, os PRs `feat: adicionar autenticação OAuth`, `fix: corrigir erro de login` e `refactor: reorganizar módulo de usuários` são classificados nas três categorias correspondentes e a Issue é publicada como `Upcoming Features — v2.3.6`, mantendo os créditos dos autores humanos.

A atividade do bot é pública e identificável, mas o GitHub pode exibir App Bots de maneira diferente no gráfico de contribuições. O histórico efetivo da App é observado nos comentários, na Issue atualizada e nos eventos atribuídos à instalação; o workflow, por si só, não promete uma entrada no gráfico de contribuições de uma conta humana.
