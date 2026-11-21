import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, git, initRepo, hook, read, write } from './helpers.js';
import { serenaToolWrites } from '../src/codeslice.js';

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
  assert.ok(!exists(dir, '.serena'), 'no Serena files');
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

test('update removes a Serena setup from before', () => {
  const dir = initRepo('codeslice-migrate', ['--stack', 'dotnet']);
  // what the Serena integration used to leave behind
  write(dir, '.mcp.json', JSON.stringify({ mcpServers: { serena: { command: 'serena' }, other: { command: 'x' } } }));
  write(dir, '.vscode/mcp.json', JSON.stringify({ servers: { serena: { command: 'serena' } } }));
  write(dir, '.serena/project.yml', 'agent_interface: tools\n');
  write(dir, '.serena/memories/hints.md', 'notes\n');
  const cfg = JSON.parse(read(dir, '.rails/config.json'));
  cfg.serena = { enabled: true, hooks: true };
  write(dir, '.rails/config.json', JSON.stringify(cfg));
  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  settings.hooks.SessionEnd = [{ hooks: [{ type: 'command', command: 'serena-hooks cleanup --client claude-code' }] }];
  write(dir, '.claude/settings.json', JSON.stringify(settings));

  assert.notEqual(cli(dir, ['doctor']).code, 0, 'doctor reports the leftover Serena setup');
  assert.equal(cli(dir, ['update']).code, 0);
  assert.deepEqual(JSON.parse(read(dir, '.mcp.json')).mcpServers, { other: { command: 'x' } }, 'other servers are kept');
  assert.deepEqual(JSON.parse(read(dir, '.vscode/mcp.json')).servers, {});
  assert.ok(!exists(dir, '.serena/project.yml'));
  assert.ok(exists(dir, '.serena/memories/hints.md'), 'memories are left for the user');
  assert.ok(!read(dir, '.claude/settings.json').includes('serena-hooks'));
  assert.ok(!('serena' in JSON.parse(read(dir, '.rails/config.json'))));
});

test('a Serena connected outside the repo cannot edit files', () => {
  const dir = initRepo('codeslice-serena-guard', ['--stack', 'dotnet']);
  const serena = (tool, input = {}) => hook(dir, { tool_name: `mcp__serena__${tool}`, tool_input: input }).code;
  assert.equal(serena('find_symbol', { name_path_pattern: 'Total' }), 0, 'reads pass');
  assert.equal(serena('find_referencing_symbols', { name_path: 'Total', relative_path: 'src/A.cs' }), 0);
  for (const t of ['replace_symbol_body', 'rename_symbol', 'replace_content', 'create_text_file', 'execute_shell_command', 'serena_repl', 'write_memory']) {
    assert.equal(serena(t, { relative_path: 'src/A.cs' }), 2, t);
  }
  assert.equal(hook(dir, { tool_name: 'mcp__plugin_serena_serena__replace_in_files', tool_input: {} }).code, 2, 'plugin installs too');
  assert.ok(serenaToolWrites('mcp__serena__some_future_edit_tool'), 'unknown edit-like tools are refused');
  const s = JSON.parse(read(dir, '.claude/settings.json'));
  assert.equal(s.hooks.PreToolUse[0].matcher, 'Edit|Write|MultiEdit|NotebookEdit|Bash|mcp__.*serena.*');
});
