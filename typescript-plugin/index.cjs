const fs = require('node:fs');
const path = require('node:path');

function init(modules) {
  const ts = modules.typescript;
  function create(info) {
    const log = (message) => info.project.projectService.logger.info(`[ryvax] ${message}`);
    const root = findWorkspace(info.project.getCurrentDirectory());
    const languageService = info.languageService;
    const proxy = Object.create(null);
    for (const key of Object.keys(languageService)) {
      const value = languageService[key];
      proxy[key] = typeof value === 'function' ? value.bind(languageService) : value;
    }

    proxy.getSemanticDiagnostics = (fileName) => {
      const diagnostics = languageService.getSemanticDiagnostics(fileName);
      if (!root || !isRouteFile(fileName)) return diagnostics;
      const source = languageService.getProgram()?.getSourceFile(fileName);
      if (!source) return diagnostics;
      const hasDefault = source.statements.some((statement) => statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
      const hasMethod = source.statements.some((statement) => {
        const name = statement.name?.text;
        return name && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(name);
      });
      if (!hasDefault && !hasMethod) diagnostics.push({
        file: source,
        start: 0,
        length: Math.min(source.getFullText().length, 1),
        category: ts.DiagnosticCategory.Warning,
        code: 90001,
        messageText: 'Ryvax route files should export a default page handler or an HTTP method handler.'
      });
      return diagnostics;
    };

    proxy.getCompletionsAtPosition = (fileName, position, options) => {
      const base = languageService.getCompletionsAtPosition(fileName, position, options);
      const source = languageService.getProgram()?.getSourceFile(fileName);
      if (!source || !root) return base;
      const before = source.text.slice(Math.max(0, position - 20), position);
      if (!/route\(\s*["'`]$/.test(before)) return base;
      const routes = discoverRoutes(root).map((entry) => ({ name: entry, kind: ts.ScriptElementKind.string, sortText: '11' }));
      return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false, entries: [...(base?.entries ?? []), ...routes] };
    };

    log(`plugin active for ${root}`);
    return proxy;
  }
  return { create };
}

function findWorkspace(current) {
  let directory = path.resolve(current || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(directory, 'package.json'))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function isRouteFile(fileName) {
  return /(^|[\\/])(pages|app)[\\/].+\.(tsx?|jsx?|mts|cts)$/.test(fileName) && !/[\\/]_(?:app|document)\./.test(fileName);
}

function discoverRoutes(root) {
  const routes = [];
  for (const base of ['pages', 'app']) walk(path.join(root, base), base, routes);
  return [...new Set(routes)].sort();
}

function walk(directory, prefix, routes) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, `${prefix}/${entry.name}`, routes);
    else if (/\.(tsx?|jsx?|mts|cts)$/.test(entry.name)) {
      const name = entry.name.replace(/\.[^.]+$/, '');
      if (name.startsWith('_')) continue;
      const segments = `${prefix}/${name}`.split('/').filter(Boolean);
      if (['index', 'page', 'route'].includes(name)) segments.pop();
      const pathname = '/' + segments.map((segment) => segment.startsWith('[') ? ':' + segment.replace(/^\[\.\.\.?|\[|\]$/g, '') : segment).join('/');
      routes.push(pathname === '/' ? '/' : pathname.replace(/\/+/g, '/'));
    }
  }
}

module.exports = init;
