import path from 'node:path';
import { readJson, writeJson, currentBranch, globToRegex } from './util.js';

export const CONFIG_PATH = '.rails/config.json';
export const STATE_PATH = '.rails/state.json';

// Paths that may change without an approved RFC (drafting and decision documents).
export const FREE_PATHS = ['docs/rfc/**', 'docs/specs/**', 'docs/analysis/**', 'docs/adr/**', '.rails/state.json', '.serena/memories/**'];

/** Housekeeping files that never need an RFC (not even fast-track). Overridable via paths.noRfc. */
export const DEFAULT_NO_RFC = ['.gitignore', '**/.gitignore', '.editorconfig', '**/.editorconfig'];
export const noRfcGlobs = (cfg) => (Array.isArray(cfg?.paths?.noRfc) ? cfg.paths.noRfc : DEFAULT_NO_RFC);
/** Paths that may change without any RFC: devrailsv2's own drafting documents plus the configured housekeeping files. */
export const freePaths = (cfg) => [...FREE_PATHS, ...noRfcGlobs(cfg)];

// Tooling the agent must not edit (hooks, gate, CI).
export const PROTECTED_PATHS = [
  '.rails/config.json',
  '.rails/tool/**',
  '.githooks/**',
  '.claude/settings.json',
  '.github/workflows/devrailsv2.yml',
  'azure-pipelines.devrailsv2.yml',
  '.mcp.json',
  '.vscode/mcp.json',
  '.serena/project.yml',
  '.serena/project.local.yml',
  '.claude/agents/rails-*.md',
  '.claude/commands/rails-*.md',
  '.github/agents/rails-*.agent.md',
  '.github/prompts/rails-*.prompt.md',
];

export const STACKS = {
  node: {
    label: 'Node.js / TypeScript',
    src: ['src/**', 'lib/**', 'app/**', 'server/**', 'api/**'],
    tests: ['test/**', 'tests/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*'],
    testCommand: 'npm test',
  },
  dotnet: {
    label: 'C# / .NET',
    src: ['src/**'],
    tests: ['tests/**', 'test/**', '**/*.Tests/**', '**/*.UnitTests/**', '**/*.IntegrationTests/**', '**/*Tests.cs'],
    testCommand: 'dotnet test',
  },
  other: {
    label: 'Other / mixed',
    src: ['src/**', 'lib/**', 'app/**'],
    tests: ['test/**', 'tests/**', '**/*test*/**', '**/*.test.*', '**/*.spec.*'],
    testCommand: 'make test',
  },
};

/** Files whose changes never need tests (styles, images, icons, translations). Overridable via paths.cosmetic. */
export const DEFAULT_COSMETIC = [
  '**/*.css', '**/*.scss', '**/*.sass', '**/*.less', '**/*.styl',
  '**/*.svg', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp', '**/*.ico', '**/*.avif',
  '**/*.woff', '**/*.woff2', '**/*.ttf',
  '**/locales/**', '**/i18n/**', '**/translations/**', '**/*.resx',
];
export const cosmeticGlobs = (cfg) => (Array.isArray(cfg?.paths?.cosmetic) ? cfg.paths.cosmetic : DEFAULT_COSMETIC);

/** Limits that keep fast-track for small changes only. Overridable via fastTrack in .rails/config.json. */
export const DEFAULT_FAST_TRACK = {
  maxFiles: 10,
  maxLines: 200, // added + removed lines in non-cosmetic, non-doc files (lockfiles excluded)
  onePerPullRequest: true,
  maxShare: 0.5, // audit warns when more than half of the RFCs are fast-track
  micro: { maxLines: 10, maxFiles: 3 }, // fast-track without a file list: the whole change must stay this small
  forbidden: [
    // matching is case-insensitive
    '**/auth/**', '**/*auth*.*', '**/identity/**', '**/security/**', '**/*security*.*', '**/permission*/**',
    '**/payment*/**', '**/*payment*.*', '**/billing/**',
    '**/migrations/**', '**/Migrations/**', '**/*.sql',
    '.github/workflows/**', 'azure-pipelines*.yml', '**/*.tf', '**/*.bicep', '**/Dockerfile', '**/docker-compose*.yml', 'infra/**', 'deploy/**',
    '.rails/**', '.githooks/**', '.claude/**', '.mcp.json', '.serena/**',
  ],
};
export const fastTrackRules = (cfg) => ({ ...DEFAULT_FAST_TRACK, ...(cfg?.fastTrack || {}), micro: { ...DEFAULT_FAST_TRACK.micro, ...(cfg?.fastTrack?.micro || {}) } });
export const LOCKFILES = ['**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/packages.lock.json', '**/*.lock'];

/** Documentation: always allowed through fast-track, whatever its size, and never needs tests. Overridable via paths.docs. */
export const DEFAULT_DOCS = ['**/*.md', '**/*.mdx', '**/*.markdown', '**/*.rst', '**/*.adoc', '**/*.txt', 'docs/**', '**/LICENSE*', '**/NOTICE*'];
/** Doc-looking files that are not documentation: agent instructions (they steer the agents) and config that happens to be .txt. */
export const DEFAULT_DOCS_EXCLUDE = [
  'AGENTS.md', '**/AGENTS.md', 'CLAUDE.md', '**/CLAUDE.md', '.github/**', '.claude/**', '.rails/**', '.serena/**', '.githooks/**',
  '**/requirements*.txt', '**/constraints*.txt', '**/CMakeLists.txt', '**/robots.txt', '**/llms.txt',
];
export const docGlobs = (cfg) => (Array.isArray(cfg?.paths?.docs) ? cfg.paths.docs : DEFAULT_DOCS);
export const docExcludeGlobs = (cfg) => (Array.isArray(cfg?.paths?.docsExclude) ? cfg.paths.docsExclude : DEFAULT_DOCS_EXCLUDE);
export function isDocFile(cfg, file) {
  const f = String(file).replace(/\\/g, '/');
  return docGlobs(cfg).some((g) => globToRegex(g).test(f)) && !docExcludeGlobs(cfg).some((g) => globToRegex(g).test(f));
}

/** Monorepo support: when paths.scope is set (e.g. ["backend"]), devrailsv2 only gates files inside it. */
export const scopeOf = (cfg) => (Array.isArray(cfg?.paths?.scope) ? cfg.paths.scope.filter(Boolean) : []);
const DEVRAILS_FILES = ['docs/rfc/**', 'docs/specs/**', 'docs/changes/**', 'docs/adr/**', 'docs/analysis/**', 'docs/STATUS.md', 'docs/guides/**', 'docs/migration/**', 'CHANGELOG.md', 'AGENTS.md', 'CLAUDE.md'];
export function inScope(cfg, file) {
  const scope = scopeOf(cfg);
  if (!scope.length) return true;
  const f = String(file).replace(/\\/g, '/');
  if (DEVRAILS_FILES.some((g) => globToRegex(g).test(f)) || PROTECTED_PATHS.some((g) => globToRegex(g).test(f))) return true;
  return scope.some((d) => {
    const g = d.replace(/\\/g, '/').replace(/\/+$/, '');
    return /[*?]/.test(g) ? globToRegex(g).test(f) : f === g || f.startsWith(`${g}/`);
  });
}
/** Prefix stack globs with the scope folder: src/** → backend/src/**. */
export const prefixGlobs = (globs, dir) => (dir ? globs.map((g) => `${dir.replace(/\/+$/, '')}/${g}`) : [...globs]);

export function normStack(s) {
  const v = String(s || '').toLowerCase().trim();
  if (['dotnet', '.net', 'net', 'c#', 'csharp', 'cs'].includes(v)) return 'dotnet';
  if (['node', 'nodejs', 'node.js', 'js', 'ts', 'typescript', 'javascript'].includes(v)) return 'node';
  return v ? 'other' : '';
}

export function loadConfig(root, { optional = false } = {}) {
  const cfg = readJson(path.join(root, CONFIG_PATH));
  if (!cfg && !optional) throw new Error('No .rails/config.json found. Run `devrailsv2 init` first.');
  return cfg;
}
export const saveConfig = (root, cfg) => writeJson(path.join(root, CONFIG_PATH), cfg);
export const loadState = (root) => readJson(path.join(root, STATE_PATH), {});
export const saveState = (root, s) => writeJson(path.join(root, STATE_PATH), s);

/** Active RFC key ("2026-001"): the branch name (rfc/2026-001-...) wins, then .rails/state.json. */
export function getActiveRfcId(root) {
  const m = currentBranch(root).match(/(?:^|\/)rfc[-/](\d{4})-(\d{3,4})\b/i);
  if (m) return `${m[1]}-${m[2].padStart(3, '0')}`;
  const s = loadState(root).activeRfc;
  return s && /^\d{4}-\d{3,4}$/.test(s) ? s : null;
}
