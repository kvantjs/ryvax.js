import { readFile } from "node:fs/promises";

const API_VERSION = "2022-11-28";
const DEFAULT_API_URL = "https://api.github.com";
const WELCOME_MARKER = "<!-- ryvax-first-contributor-welcome -->";
const DOCUMENT_CANDIDATES = {
  contributing: ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md"],
  codeOfConduct: ["CODE_OF_CONDUCT.md", ".github/CODE_OF_CONDUCT.md", "docs/CODE_OF_CONDUCT.md"],
};

const token = process.env.GITHUB_TOKEN;
const eventPath = process.env.GITHUB_EVENT_PATH;
const apiUrl = (process.env.GITHUB_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
if (!token) throw new Error("GITHUB_TOKEN is not configured.");
if (!eventPath) throw new Error("GITHUB_EVENT_PATH is not configured.");

const event = JSON.parse(await readFile(eventPath, "utf8"));
const repository = event.repository;
const issueOrPullRequest = event.issue ?? event.pull_request;
const actor = issueOrPullRequest?.user;
const issueNumber = issueOrPullRequest?.number;
if (!repository?.owner?.login || !repository.name || !actor?.login || !issueNumber) {
  throw new Error("The GitHub event is missing repository, author, or issue number data.");
}

const owner = repository.owner.login;
const repo = repository.name;
const username = actor.login;
const isPullRequest = Boolean(event.pull_request);

function isAutomatedAccount(user) {
  return user.type === "Bot" || user.login.endsWith("[bot]") || user.login === "github-actions";
}
function encode(value) { return encodeURIComponent(value); }

if (isAutomatedAccount(actor)) {
  console.log(`Skipping automated account: ${username}`);
  process.exit(0);
}

const currentItemId = issueOrPullRequest.id;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": API_VERSION,
};

async function githubRequest(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${path}: ${body.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function hasPreviousRelevantInteraction() {
  for (let page = 1; ; page += 1) {
    const results = await githubRequest(
      `/repos/${encode(owner)}/${encode(repo)}/issues?creator=${encode(username)}&state=all&sort=created&direction=asc&per_page=100&page=${page}`,
    );
    const previousItem = results.find((item) => item.number !== issueNumber && (!currentItemId || item.id !== currentItemId));
    if (previousItem) {
      console.log(`Existing issue or pull request found (#${previousItem.number}); no welcome needed.`);
      return true;
    }
    if (results.length < 100) return false;
  }
}

async function findDocument(candidates) {
  for (const path of candidates) {
    try {
      await githubRequest(`/repos/${encode(owner)}/${encode(repo)}/contents/${path}`);
      return path;
    } catch (error) {
      if (!String(error.message).includes("GitHub API 404")) throw error;
    }
  }
  return null;
}

function documentUrl(path) {
  const branch = encode(repository.default_branch || "main");
  const encodedPath = path.split("/").map(encode).join("/");
  return `https://github.com/${encode(owner)}/${encode(repo)}/blob/${branch}/${encodedPath}`;
}

function buildWelcomeMessage({ contributingPath, codeOfConductPath }) {
  const links = [
    contributingPath ? `- [Guia de contribuição](${documentUrl(contributingPath)})` : "- O guia de contribuição ainda não está disponível neste repositório.",
    codeOfConductPath ? `- [Código de Conduta](${documentUrl(codeOfConductPath)})` : "- O Código de Conduta ainda não está disponível neste repositório.",
  ];
  return `${WELCOME_MARKER}

Olá, **@${username}**! Seja bem-vindo(a) ao projeto.

Agradecemos por abrir sua primeira ${isPullRequest ? "Pull Request" : "Issue"} neste repositório. Sua participação é muito importante para a comunidade.

Antes de continuar, consulte as orientações abaixo e a documentação do projeto quando necessário:
${links.join("\n")}

Obrigado por contribuir com o ${repository.full_name}!`;
}

async function commentAlreadyExists() {
  for (let page = 1; ; page += 1) {
    const comments = await githubRequest(`/repos/${encode(owner)}/${encode(repo)}/issues/${issueNumber}/comments?per_page=100&page=${page}`);
    if (comments.some((comment) => comment.body?.includes(WELCOME_MARKER))) return true;
    if (comments.length < 100) return false;
  }
}

async function main() {
  console.log(`Checking first contribution for @${username} in ${owner}/${repo} (#${issueNumber}).`);
  if (await commentAlreadyExists()) return console.log("Welcome comment already exists; nothing to do.");
  if (await hasPreviousRelevantInteraction()) return;
  const [contributingPath, codeOfConductPath] = await Promise.all([
    findDocument(DOCUMENT_CANDIDATES.contributing),
    findDocument(DOCUMENT_CANDIDATES.codeOfConduct),
  ]);
  await githubRequest(`/repos/${encode(owner)}/${encode(repo)}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: buildWelcomeMessage({ contributingPath, codeOfConductPath }) }),
  });
  console.log(`Welcome comment published for @${username}.`);
}

try {
  await main();
} catch (error) {
  console.error(`Welcome bot failed: ${error.message}`);
  process.exitCode = 1;
}
