import { readFile } from "node:fs/promises";

const API_VERSION = "2022-11-28";
const apiUrl = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const token = process.env.GITHUB_TOKEN;
const eventPath = process.env.GITHUB_EVENT_PATH;
const configPath = process.env.UPCOMING_FEATURES_CONFIG || "upcoming-features.config.json";

if (!token) throw new Error("GITHUB_TOKEN is not configured.");
if (!eventPath) throw new Error("GITHUB_EVENT_PATH is not configured.");

const event = JSON.parse(await readFile(eventPath, "utf8"));
const config = JSON.parse(await readFile(configPath, "utf8"));
const repository = event.repository;
if (!repository?.owner?.login || !repository.name) throw new Error("Repository data is missing from the event.");

const owner = repository.owner.login;
const repo = repository.name;
const eventName = process.env.GITHUB_EVENT_NAME || (event.release ? "release" : event.pull_request ? "pull_request_target" : "workflow_dispatch");
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": API_VERSION,
};

function pathPart(value) { return encodeURIComponent(value); }

async function githubRequest(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    const detail = body.length > 600 ? `${body.slice(0, 600)}…` : body;
    if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error(`GitHub API rate limit exceeded. Reset at ${response.headers.get("x-ratelimit-reset") || "an unknown time"}.`);
    }
    throw new Error(`GitHub API ${response.status} for ${path}: ${detail}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function getAllPages(pathFactory) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const pageItems = await githubRequest(pathFactory(page));
    if (!Array.isArray(pageItems)) throw new Error("Expected a paginated array from GitHub API.");
    all.push(...pageItems);
    if (pageItems.length < 100) return all;
  }
}

function parseVersion(value) {
  const match = String(value || "").match(/(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?(?:$|[^0-9])/i);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

function formatVersion(version) { return `v${version.major}.${version.minor}.${version.patch}`; }

function incrementVersion(version) {
  const next = { ...version };
  if (config.increment === "major") { next.major += 1; next.minor = 0; next.patch = 0; }
  else if (config.increment === "minor") { next.minor += 1; next.patch = 0; }
  else next.patch += 1;
  return next;
}

async function resolveStableVersion() {
  const releases = await getAllPages((page) => `/repos/${pathPart(owner)}/${pathPart(repo)}/releases?per_page=100&page=${page}`);
  const release = releases.find((item) => parseVersion(item.tag_name) || parseVersion(item.name));
  if (release) {
    const version = parseVersion(release.tag_name) || parseVersion(release.name);
    return { version, releasedAt: release.published_at || release.created_at, source: `release ${release.tag_name || release.name}` };
  }

  const tags = await getAllPages((page) => `/repos/${pathPart(owner)}/${pathPart(repo)}/tags?per_page=100&page=${page}`);
  const tagged = tags.map((tag) => ({ tag, version: parseVersion(tag.name) })).filter((entry) => entry.version);
  tagged.sort((a, b) => compareVersions(b.version, a.version));
  if (tagged[0]) return { version: tagged[0].version, releasedAt: null, source: `tag ${tagged[0].tag.name}` };

  const initial = parseVersion(config.initialVersion);
  if (!initial) throw new Error(`initialVersion is not a valid semantic version: ${config.initialVersion}`);
  return { version: initial, releasedAt: null, source: "configured initialVersion" };
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function hasBreakingChange(text) {
  return /BREAKING[ -]CHANGE|^[a-z]+(?:\([^)]*\))?!:/im.test(text || "");
}

function classifyPullRequest(pr, commits) {
  const labels = (pr.labels || []).map((label) => String(label.name).toLowerCase());
  const commitTexts = commits.map((commit) => `${commit.commit?.message || ""}\n${commit.commit?.body || ""}`);
  const text = [pr.title, pr.body || "", ...commitTexts].join("\n");
  if (hasBreakingChange(text) || labels.some((label) => /breaking|major|incompat/.test(label))) return "breaking";
  if (labels.some((label) => /security|vulnerability|cve/.test(label))) return "security";
  if (/^docs?(?:\([^)]*\))?!?:/im.test(text) || labels.some((label) => /doc|documentation/.test(label))) return "documentation";
  if (/^feat(?:ure)?(?:\([^)]*\))?!?:/im.test(text) || labels.some((label) => /feature|enhancement/.test(label))) return "feature";
  if (/^fix(?:es)?(?:\([^)]*\))?!?:/im.test(text) || labels.some((label) => /bug|fix|修/.test(label))) return "bug";
  if (/^(refactor|perf|improve|style)(?:\([^)]*\))?!?:/im.test(text) || labels.some((label) => /refactor|improvement|performance|perf|cleanup/.test(label))) return "improvement";
  return "other";
}

async function collectMergedPullRequests(releasedAt) {
  const pullRequests = await getAllPages((page) => `/repos/${pathPart(owner)}/${pathPart(repo)}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
  const cutoff = releasedAt ? Date.parse(releasedAt) : Number.NEGATIVE_INFINITY;
  const selected = pullRequests.filter((pr) => {
    if (!pr.merged_at || !config.mainBranches.includes(pr.base?.ref)) return false;
    return Date.parse(pr.merged_at) > cutoff;
  });

  const result = [];
  for (const pr of selected) {
    const commits = await getAllPages((page) => `/repos/${pathPart(owner)}/${pathPart(repo)}/pulls/${pr.number}/commits?per_page=100&page=${page}`);
    result.push({ pr, commits, category: classifyPullRequest(pr, commits) });
  }
  return result.sort((a, b) => Date.parse(a.pr.merged_at) - Date.parse(b.pr.merged_at));
}

function extractTrackedPullRequests(markdown) {
  return new Set([...String(markdown || "").matchAll(/\(#(\d+)\)/g)].map((match) => Number(match[1])));
}

function itemLine(entry) {
  const title = entry.pr.title.trim().replace(/\s+/g, " ");
  const titleWithPeriod = /[.!?]$/.test(title) ? title : `${title}.`;
  const link = config.includePullRequestLinks ? `([#${entry.pr.number}](${entry.pr.html_url}))` : `#${entry.pr.number}`;
  const author = config.includeAuthors && entry.pr.user?.login ? ` — @${entry.pr.user.login}` : "";
  return `- ${titleWithPeriod} ${link}${author}`;
}

function buildDocument(version, entries, existingBody = "") {
  const categories = config.categories;
  const groups = Object.keys(categories).map((key) => [key, []]);
  const existingTracked = extractTrackedPullRequests(existingBody);
  for (const entry of entries) {
    if (!existingTracked.has(entry.pr.number)) groups.find(([key]) => key === entry.category)?.[1].push(entry);
  }

  const sections = groups.map(([key, items]) => {
    const existingSection = getSection(existingBody, categories[key]);
    const lines = [...existingSection, ...items.map(itemLine)];
    return `## ${categories[key]}\n\n${lines.length ? lines.join("\n") : "_Nenhuma alteração registrada._"}`;
  });

  return `# ${config.upcomingIssueTitle} — ${formatVersion(version)}\n\n> A próxima versão **${formatVersion(version)}** incluirá as alterações incorporadas ao projeto desde a última versão oficial.\n\n${sections.join("\n\n")}\n\n---\n\n_${config.identificationMessage}_`;
}

function getSection(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(body || "").match(new RegExp(`^## ${escaped}\\n\\n([\\s\\S]*?)(?=\\n\\n## |\\n\\n---|$)`, "m"));
  if (!match || match[1].includes("Nenhuma alteração registrada")) return [];
  return match[1].split("\n").filter((line) => line.startsWith("- "));
}

async function findUpcomingIssue() {
  const issues = await getAllPages((page) => `/repos/${pathPart(owner)}/${pathPart(repo)}/issues?state=open&per_page=100&page=${page}`);
  return issues.find((issue) => !issue.pull_request && issue.title.startsWith(config.upcomingIssueTitle));
}

async function upsertIssue(body) {
  const existing = await findUpcomingIssue();
  if (existing) {
    await githubRequest(`/repos/${pathPart(owner)}/${pathPart(repo)}/issues/${existing.number}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `${config.upcomingIssueTitle} — ${body.match(/^# .* — (v\d+\.\d+\.\d+)/m)?.[1] || ""}`.trim(), body }),
    });
    console.log(`Updated Upcoming Features issue #${existing.number}.`);
    return;
  }

  const created = await githubRequest(`/repos/${pathPart(owner)}/${pathPart(repo)}/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: `${config.upcomingIssueTitle} — ${body.match(/^# .* — (v\d+\.\d+\.\d+)/m)?.[1] || ""}`.trim(), body }),
  });
  console.log(`Created Upcoming Features issue #${created.number}.`);
}

async function main() {
  if (eventName === "pull_request_target" && (!event.pull_request?.merged || !config.mainBranches.includes(event.pull_request.base?.ref))) {
    console.log("Ignoring a closed, unmerged, or non-main-branch pull request.");
    return;
  }

  const stable = await resolveStableVersion();
  const upcoming = incrementVersion(stable.version);
  const entries = await collectMergedPullRequests(stable.releasedAt);
  const existing = await findUpcomingIssue();
  const body = buildDocument(upcoming, entries, existing?.body || "");
  await upsertIssue(body);
  console.log(`Stable version: ${formatVersion(stable.version)} (${stable.source}); upcoming version: ${formatVersion(upcoming)}; tracked PRs: ${entries.length}.`);
}

try {
  await main();
} catch (error) {
  console.error(`Upcoming Features Bot failed: ${error.message}`);
  process.exitCode = 1;
}
