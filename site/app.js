const PACKAGE_NAME = '@kvantjs/ryvax.js';
const PACKAGE_VERSION = '2.3.5';
const REPOSITORY = 'kvantjs/ryvax.js';
const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/${PACKAGE_VERSION}`;
const REGISTRY_ROOT_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}`;
const PUBLISHED_README_URL = `https://unpkg.com/${PACKAGE_NAME}@${PACKAGE_VERSION}/README.md`;
const GITHUB_API_URL = `https://api.github.com/repos/${REPOSITORY}`;
const DOWNLOADS_URL = `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(PACKAGE_NAME)}`;
const UNPKG_META_URL = `https://unpkg.com/${PACKAGE_NAME}@${PACKAGE_VERSION}/?meta`;
const NPMS_URL = `https://api.npms.io/v2/package/${encodeURIComponent(PACKAGE_NAME)}`;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const text = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function resolveReadmeUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url || url.startsWith('#') || /^(mailto:|https?:|tel:|data:)/i.test(url)) return url;
  return `${REPOSITORY_URL}/blob/main/${url.replace(/^\.\//, '')}`;
}

function inlineMarkdown(rawText) {
  const placeholders = [];
  let value = String(rawText ?? '').replace(/`([^`]+)`/g, (_, code) => {
    const index = placeholders.push(`<code>${escapeHtml(code)}</code>`) - 1;
    return `\u0000${index}\u0000`;
  });
  value = escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g, (_, alt, url, title) => {
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(resolveReadmeUrl(url))}" alt="${escapeHtml(alt)}"${titleAttr} />`;
    })
    .replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g, (_, label, url, title) => {
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(resolveReadmeUrl(url))}" target="_blank" rel="noreferrer"${titleAttr}>${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/  $/g, '<br />');
  return value.replace(/\u0000(\d+)\u0000/g, (_, index) => placeholders[Number(index)] || '');
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line);
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    if (/^```/.test(line.trim())) {
      const language = line.trim().slice(3).trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) { codeLines.push(lines[index]); index += 1; }
      if (index < lines.length) index += 1;
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : '';
      blocks.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote><p>${inlineMarkdown(quoteLines.join(' '))}</p></blockquote>`);
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const header = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      const headerHtml = header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('');
      const bodyHtml = rows.map((row) => `<tr>${header.map((_, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('');
      blocks.push(`<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
      continue;
    }

    const listMatch = line.match(/^\s*([-*+] |\d+\. )(.+)/);
    if (listMatch) {
      const ordered = /^\d+\./.test(listMatch[1]);
      const items = [];
      while (index < lines.length) {
        const current = lines[index].match(/^\s*([-*+] |\d+\. )(.+)/);
        if (!current || (/^\d+\./.test(current[1])) !== ordered) break;
        items.push(`<li>${inlineMarkdown(current[2])}</li>`);
        index += 1;
      }
      blocks.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push('<hr />');
      index += 1;
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      const next = lines[index];
      if (/^(#{1,6})\s+/.test(next) || /^```/.test(next) || /^\s*>/.test(next) || /^\s*([-*+] |\d+\. )/.test(next)) break;
      paragraphLines.push(next.trim());
      index += 1;
    }
    blocks.push(`<p>${inlineMarkdown(paragraphLines.join(' '))}</p>`);
  }
  return blocks.join('\n');
}

function formatDate(value) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatNumber(value) {
  const number = safeNumber(value);
  return number === null ? 'Unavailable' : new Intl.NumberFormat('en-US').format(number);
}

function formatBytes(value) {
  const number = safeNumber(value);
  if (number === null) return 'Unavailable';
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${(number / (1024 * 1024)).toFixed(2)} MB`;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('show'), 2200);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function setHref(selector, value) {
  const element = $(selector);
  if (element && value) element.href = value;
}

async function loadPackageData() {
  const [packageResult, registryResult, downloadsResult, githubResult, readmeResult, filesResult, npmsResult] = await Promise.allSettled([
    fetchJson(REGISTRY_URL),
    fetchJson(REGISTRY_ROOT_URL),
    fetchJson(DOWNLOADS_URL),
    fetchJson(GITHUB_API_URL),
    fetchText(PUBLISHED_README_URL),
    fetchJson(UNPKG_META_URL),
    fetchJson(NPMS_URL),
  ]);

  const packageData = packageResult.status === 'fulfilled' ? packageResult.value : null;
  const registryData = registryResult.status === 'fulfilled' ? registryResult.value : null;
  const downloads = downloadsResult.status === 'fulfilled' ? downloadsResult.value : null;
  const github = githubResult.status === 'fulfilled' ? githubResult.value : null;
  const readme = readmeResult.status === 'fulfilled' ? readmeResult.value : null;
  const files = filesResult.status === 'fulfilled' ? filesResult.value : null;
  const npms = npmsResult.status === 'fulfilled' ? npmsResult.value : null;

  renderPackage(packageData, registryData, downloads);
  renderGithub(github);
  renderReadme(readme);
  renderCode(files);
  renderDependencies(packageData);
  renderVersions(packageData, registryData);
  renderDependents(npms);
}

function renderPackage(packageData, registryData, downloads) {
  const version = packageData?.version || PACKAGE_VERSION;
  const dependencies = packageData?.dependencies || {};
  const dependencyCount = Object.keys(dependencies).length;
  const timeMap = registryData?.time || {};
  const versionMap = Object.keys(timeMap).filter((key) => /^\d+\.\d+\.\d+/.test(key));
  const downloadCount = downloads?.downloads;
  const publishedAt = timeMap[version];

  text('#version-summary', `${version} • Public • Published ${formatDate(publishedAt)}`);
  text('#package-description', packageData?.description || 'Package description unavailable from the npm Registry.');
  text('#dependencies-tab-count', formatNumber(dependencyCount));
  text('#versions-tab-count', formatNumber(versionMap.length));
  text('#sidebar-version', version);
  text('#license-value', packageData?.license || 'Unavailable');
  text('#node-value', packageData?.engines?.node || 'Unavailable');
  text('#downloads-value', formatNumber(downloadCount));
  text('#published-value', formatDate(publishedAt));
  text('#size-value', formatBytes(packageData?.dist?.unpackedSize));
  text('#dependencies-count', `${formatNumber(dependencyCount)} runtime dependencies`);
  text('#versions-count', `${formatNumber(versionMap.length)} published versions`);
  $('#readme-content').dataset.packageVersion = version;
  document.title = `${PACKAGE_NAME} ${version} — npm package`;
  const installCommand = `npm i ${PACKAGE_NAME}`;
  text('#install-command', installCommand);
  setHref('#unpkg-link', `https://unpkg.com/${PACKAGE_NAME}@${version}/`);
}

function renderGithub(github) {
  if (!github) {
    text('#stars-count', 'Unavailable');
    text('#forks-count', 'Unavailable');
    text('#issues-count', 'Unavailable');
    return;
  }
  text('#stars-count', formatNumber(github.stargazers_count));
  text('#forks-count', formatNumber(github.forks_count));
  text('#issues-count', formatNumber(github.open_issues_count));
  setHref('#repo-link', github.html_url || REPOSITORY_URL);
  setHref('#homepage-link', github.homepage || github.html_url || REPOSITORY_URL);
  setHref('#issues-link', github.html_url ? `${github.html_url}/issues` : `${REPOSITORY_URL}/issues`);
}

function renderReadme(readme) {
  const container = $('#readme-content');
  if (!readme) {
    container.innerHTML = `<div class="empty-state"><h3>README unavailable</h3><p>The live README could not be loaded from the public repository.</p><a href="${REPOSITORY_URL}#readme" target="_blank" rel="noreferrer">Open README on GitHub ↗</a></div>`;
    return;
  }
  container.innerHTML = markdownToHtml(readme);
}

function renderCode(files) {
  const container = $('#code-content');
  if (!files?.files) {
    container.innerHTML = `<div class="empty-state"><h3>Published file list unavailable</h3><p>Browse the exact published package on unpkg.</p></div>`;
    return;
  }
  const fileRows = files.files
    .filter((file) => file.path && file.path !== 'package.json')
    .slice(0, 100)
    .map((file) => `<div class="file-row"><a href="https://unpkg.com/${PACKAGE_NAME}@${PACKAGE_VERSION}/${encodeURI(file.path)}" target="_blank" rel="noreferrer">${escapeHtml(file.path)}</a><span class="file-meta">${formatBytes(file.size)}</span></div>`)
    .join('');
  container.innerHTML = `${fileRows}<div class="file-row"><a href="https://unpkg.com/${PACKAGE_NAME}@${PACKAGE_VERSION}/package.json" target="_blank" rel="noreferrer">package.json</a><span class="file-meta">manifest</span></div>`;
}

function renderDependencies(packageData) {
  const container = $('#dependencies-content');
  const dependencies = Object.entries(packageData?.dependencies || {});
  if (!dependencies.length) {
    container.innerHTML = '<div class="empty-state"><h3>No runtime dependencies</h3><p>This package reports no dependencies in the public npm Registry.</p></div>';
    return;
  }
  container.innerHTML = dependencies.map(([name, range]) => `<div class="dep-row"><a class="dep-name" href="https://www.npmjs.com/package/${encodeURIComponent(name)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a><span class="dep-range">${escapeHtml(range)}</span></div>`).join('');
}

function renderVersions(packageData, registryData) {
  const container = $('#versions-content');
  const times = registryData?.time || {};
  const versions = Object.keys(times)
    .filter((version) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    .sort((a, b) => new Date(times[b]) - new Date(times[a]));
  if (!versions.length) {
    container.innerHTML = '<div class="empty-state"><h3>Version history unavailable</h3><p>The npm Registry did not return a release timeline.</p></div>';
    return;
  }
  container.innerHTML = versions.map((version) => `<div class="version-row${version === PACKAGE_VERSION ? ' is-current' : ''}"><span class="version-tag"><a class="version-name" href="https://www.npmjs.com/package/${PACKAGE_NAME}/v/${version}" target="_blank" rel="noreferrer">${escapeHtml(version)}</a>${version === PACKAGE_VERSION ? '<span class="current-tag">current view</span>' : ''}</span><span class="version-date">${formatDate(times[version])}</span></div>`).join('');
}

function renderDependents(npms) {
  const count = safeNumber(npms?.collected?.metadata?.dependentsCount);
  const actualCount = count === null ? 0 : count;
  text('#dependents-tab-count', formatNumber(actualCount));
  text('#dependents-count', `${formatNumber(actualCount)} dependents reported by npm ecosystem data`);
  const container = $('#dependents-content');
  if (actualCount === 0) {
    container.innerHTML = '<h3>No dependents yet</h3><p>The live ecosystem metadata reports that no public packages currently depend on this package.</p><a href="https://www.npmjs.com/package/@kvantjs/ryvax.js/v/2.3.5?activeTab=dependents" target="_blank" rel="noreferrer">Verify on npm ↗</a>';
  } else {
    container.innerHTML = `<h3>${formatNumber(actualCount)} dependents</h3><p>npm reports packages that depend on this release. Open the canonical listing to explore them.</p><a href="https://www.npmjs.com/package/@kvantjs/ryvax.js/v/2.3.5?activeTab=dependents" target="_blank" rel="noreferrer">Explore dependents on npm ↗</a>`;
  }
}

function setupTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      $$('.tab').forEach((item) => {
        const selected = item === tab;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-selected', String(selected));
      });
      $$('.tab-panel').forEach((panel) => {
        const visible = panel.id === `panel-${target}`;
        panel.classList.toggle('is-visible', visible);
        panel.hidden = !visible;
      });
    });
  });
}

function setupSearch() {
  $('#package-search').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = $('#search-input').value.trim();
    if (query) window.open(`https://www.npmjs.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener');
  });
}

function setupCopy() {
  $('#copy-install').addEventListener('click', async () => {
    const command = $('#install-command').textContent;
    try {
      await navigator.clipboard.writeText(command);
      showToast('Install command copied');
    } catch {
      showToast('Copy unavailable — select the command manually');
    }
  });
}

setupTabs();
setupSearch();
setupCopy();
loadPackageData().catch((error) => {
  console.error('Unable to load live package data', error);
  showToast('Some live data could not be loaded');
});
