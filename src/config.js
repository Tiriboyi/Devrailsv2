import path from 'node:path';
import { readJson, writeJson, currentBranch } from './util.js';

export const CONFIG_PATH = '.rails/config.json';
export const STATE_PATH = '.rails/state.json';

// Paths that may change without an approved RFC (drafting and decision documents).
export const FREE_PATHS = ['docs/rfc/**', 'docs/specs/**', 'docs/analysis/**', 'docs/adr/**', '.rails/state.json', '.serena/memories/**'];

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
