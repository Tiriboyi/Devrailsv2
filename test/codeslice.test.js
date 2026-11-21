import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, git, initRepo, hook, read, write } from './helpers.js';

const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

test('init --codeslice on a .NET repo writes MCP configs, subagent tools and rules', () => {
  const dir = initRepo('codeslice-init', ['--stack', 'dotnet', '--codeslice']);
  const mcp = JSON.parse(read(dir, '.mcp.json'));
  assert.deepEqual(mcp.mcpServers.codeslice, { type: 'stdio', command: 'codeslice', args: ['--root', '.'] });
  const vs = JSON.parse(read(dir, '.vscode/mcp.json'));
  assert.deepEqual(vs.servers.codeslice.args, ['--root', '${workspaceFolder}']);
  assert.match(read(dir, '.claude/agents/rails-explorer.md'), /mcp__codeslice__analyze_change_impact/);
  assert.match(read(dir, '.github/agents/rails-explorer.agent.md'), /"codeslice\/\*"/);
  assert.match(read(dir, 'AGENTS.md'), /## Code intelligence: CodeSlice/);
  assert.match(read(dir, '.gitignore'), /^\.codecanvas\/$/m);
  assert.equal(git(dir, 'status', '--porcelain').out.trim(), '', 'setup RFC covers the CodeSlice files');

  // disable removes the server entries, tools and rules again
  assert.equal(cli(dir, ['codeslice', 'disable']).code, 0);
  assert.ok(!read(dir, '.mcp.json').includes('codeslice'));
  assert.doesNotMatch(read(dir, '.claude/agents/rails-explorer.md'), /mcp__codeslice__/);
  assert.doesNotMatch(read(dir, 'AGENTS.md'), /Code intelligence: CodeSlice/);
});

test('CodeSlice is not offered for stacks it cannot analyze yet', () => {
  const dir = initRepo('codeslice-node', ['--stack', 'node', '--codeslice']);
  assert.ok(!exists(dir, '.mcp.json'), 'no MCP config for a Node repo');
  assert.doesNotMatch(read(dir, 'AGENTS.md'), /CodeSlice/);
  assert.notEqual(cli(dir, ['codeslice', 'enable']).code, 0);
});
