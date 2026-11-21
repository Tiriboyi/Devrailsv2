import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, git, tmpDir, hook, read, write, approve, fillRfc } from './helpers.js';

const Y = String(new Date().getFullYear());

function monorepo() {
  const dir = tmpDir('mono');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test Dev');
  git(dir, 'config', 'user.email', 'dev@example.com');
  write(dir, 'frontend/package.json', '{}');
  write(dir, 'frontend/src/App.tsx', 'export const App = 1;\n');
  write(dir, 'backend/Api.sln', '');
  write(dir, 'backend/src/Api/Program.cs', '// api\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'existing code');
  const r = cli(dir, ['init', '--yes', '--tracker', 'none', '--approvers', 'dev@example.com', '--scope', 'backend']);
  assert.equal(r.code, 0, r.out);
  git(dir, 'add', '-A');
  assert.equal(git(dir, 'commit', '-q', '-m', `RFC-${Y}-000: adopt devrailsv2`).code, 0);
  return dir;
}

test('init --scope detects the stack in the folder and prefixes paths', () => {
  const dir = monorepo();
  const cfg = JSON.parse(read(dir, '.rails/config.json'));
  assert.deepEqual(cfg.paths.scope, ['backend']);
  assert.equal(cfg.stack, 'dotnet', 'stack detected from backend/, not the frontend package.json');
  assert.ok(cfg.paths.src.includes('backend/src/**'));
  assert.ok(cfg.paths.tests.every((g) => g.startsWith('backend/')));
  assert.equal(cfg.testCommand, 'cd backend && dotnet test');
  assert.match(read(dir, 'AGENTS.md'), /devrailsv2 applies only to `backend\/`/);
});

test('UI changes are free; backend changes need an approved RFC', () => {
  const dir = monorepo();
  // Claude hook
  assert.equal(hook(dir, { tool_name: 'Write', tool_input: { file_path: 'frontend/src/App.tsx', content: 'x' } }).code, 0);
  assert.equal(hook(dir, { tool_name: 'Write', tool_input: { file_path: 'backend/src/Api/Program.cs', content: 'x' } }).code, 2);
  assert.equal(hook(dir, { tool_name: 'mcp__serena__replace_symbol_body', tool_input: { relative_path: 'frontend/src/App.tsx', name_path: 'App', body: 'x' } }).code, 2, 'Serena edits are refused everywhere');
  assert.equal(hook(dir, { tool_name: 'Write', tool_input: { file_path: '.claude/settings.json', content: '{}' } }).code, 2, 'tooling stays protected');

  // git hooks: a UI-only commit needs no RFC prefix
  write(dir, 'frontend/src/App.tsx', 'export const App = 2;\n');
  git(dir, 'add', '-A');
  assert.equal(git(dir, 'commit', '-q', '-m', 'tweak header').code, 0);
  // a backend commit is gated
  write(dir, 'backend/src/Api/Program.cs', '// changed\n');
  git(dir, 'add', '-A');
  assert.notEqual(git(dir, 'commit', '-q', '-m', 'tweak api').code, 0);
  assert.notEqual(git(dir, 'commit', '-q', '-m', `RFC-${Y}-000: tweak api`).code, 0);
  git(dir, 'reset', '-q', '--hard');

  // CI: a PR with only UI changes passes
  git(dir, 'branch', 'base-main', 'HEAD~1');
  const ci = cli(dir, ['check', '--ci', '--base', 'base-main'], { env: { GITHUB_ACTIONS: 'true', GITHUB_HEAD_REF: 'feature/header' } });
  assert.equal(ci.code, 0, ci.out);
  assert.match(ci.out, /outside the devrailsv2 scope/);
});

test('a change across UI and backend is checked only on the backend part', () => {
  const dir = monorepo();
  cli(dir, ['rfc', 'new', 'Export', '--affects', 'backend/src/**']);
  fillRfc(dir, `${Y}-001`, ['Given an invoice, when exported, then CSV']);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `RFC-${Y}-001: draft`);
  approve(dir, `${Y}-001`);
  git(dir, 'branch', 'base-main');
  cli(dir, ['rfc', 'start', '1']);
  write(dir, 'backend/src/Api/Export.cs', '// export\n');
  write(dir, 'backend/tests/Api.Tests/ExportTests.cs', `// RFC-${Y}-001:AC-1\n`);
  write(dir, 'frontend/src/ExportButton.tsx', 'export {}\n');
  git(dir, 'add', '-A');
  assert.equal(git(dir, 'commit', '-q', '-m', `RFC-${Y}-001: export`).code, 0);
  const r = cli(dir, ['check', '--base', 'base-main']);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /outside the RFC's affected_areas: .*frontend/, 'UI files are not scope-checked');
});

test('CI installs Node dependencies in the scope folder (not only the root)', () => {
  const dir = tmpDir('mono-node');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test Dev');
  git(dir, 'config', 'user.email', 'dev@example.com');
  write(dir, 'src/backend/package.json', '{"scripts":{"test":"vitest run"}}');
  write(dir, 'src/frontend/package.json', '{}');
  assert.equal(cli(dir, ['init', '--yes', '--tracker', 'none', '--scope', 'src/backend']).code, 0);
  const wf = read(dir, '.github/workflows/devrailsv2.yml');
  assert.match(wf, /if: hashFiles\('src\/backend\/package\.json'\) != ''\n\s+working-directory: src\/backend\n\s+run: if \[ -f package-lock\.json \]; then npm ci; else npm install; fi/);
  assert.match(wf, /run: cd src\/backend && npm test/);
  assert.match(cli(dir, ['doctor']).out, /CI installs Node dependencies in src\/backend/);

  // an old workflow (root install only) is flagged
  write(dir, '.github/workflows/devrailsv2.yml', wf.replace(/      - name: Install Node dependencies[\s\S]*?fi\n/, "      - name: Install Node dependencies\n        if: hashFiles('package-lock.json') != ''\n        run: npm ci\n"));
  assert.match(cli(dir, ['doctor']).out, /does not install Node dependencies in src\/backend/);
});
