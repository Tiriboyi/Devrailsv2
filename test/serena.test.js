import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, git, initRepo, approve, fillRfc, hook, read, write } from './helpers.js';
import { classifySerenaTool, patchProjectYml, EXCLUDED_TOOLS } from '../src/serena.js';

const Y = String(new Date().getFullYear());
const K1 = `${Y}-001`;
const serena = (dir, tool, input) => hook(dir, { tool_name: `mcp__serena__${tool}`, tool_input: input }).code;

test('Serena tool classification', () => {
  assert.equal(classifySerenaTool('mcp__serena__find_symbol'), 'read');
  assert.equal(classifySerenaTool('mcp__serena__get_diagnostics_for_file'), 'read');
  assert.equal(classifySerenaTool('mcp__serena__replace_symbol_body'), 'file-edit');
  assert.equal(classifySerenaTool('mcp__serena__rename_symbol'), 'multi-edit');
  assert.equal(classifySerenaTool('mcp__serena__write_memory'), 'memory');
  assert.equal(classifySerenaTool('mcp__serena__serena_repl'), 'blocked');
  assert.equal(classifySerenaTool('mcp__serena__execute_shell_command'), 'shell');
  assert.equal(classifySerenaTool('mcp__plugin_serena_serena__some_future_edit_tool'), 'multi-edit', 'unknown edit-like tools are gated');
});

test('project.yml patch forces the tools interface, excludes tools and keeps user settings', () => {
  const src = 'project_name: "x"\nlanguage_servers:\n- csharp\nagent_interface:\nread_only: true\nexcluded_tools: ["find_file"]\ninitial_prompt: ""\nignored_paths: ["bin"]\n';
  const out = patchProjectYml(src);
  assert.match(out, /^agent_interface: tools$/m);
  assert.match(out, /^read_only: false$/m);
  for (const t of ['find_file', ...EXCLUDED_TOOLS]) assert.ok(out.includes(`"${t}"`), t);
  assert.match(out, /^initial_prompt: ".*devrailsv2/m);
  assert.match(out, /^ignored_paths: \["bin"\]$/m);
  assert.match(out, /^language_servers:\n- csharp$/m);
  assert.equal(patchProjectYml(out), out, 'idempotent');
  const custom = patchProjectYml('initial_prompt: "Team prompt"\n');
  assert.match(custom, /^initial_prompt: "Team prompt"$/m, 'a custom prompt is kept');
});

test('init --serena writes MCP configs, project.yml, hooks and rules', () => {
  const dir = initRepo('serena-init', ['--serena', '--mode', 'migration', '--from', 'node', '--to', 'dotnet']);
  const mcp = JSON.parse(read(dir, '.mcp.json'));
  assert.deepEqual(mcp.mcpServers.serena.args, ['start-mcp-server', '--context=claude-code', '--project-from-cwd', '--agent-interface', 'tools']);
  const vs = JSON.parse(read(dir, '.vscode/mcp.json'));
  assert.ok(vs.servers.serena.args.includes('--context=vscode'));
  const py = read(dir, '.serena/project.yml');
  assert.match(py, /^agent_interface: tools$/m);
  assert.match(py, /"csharp".*"typescript"|"typescript".*"csharp"/);
  const s = JSON.parse(read(dir, '.claude/settings.json'));
  assert.equal(s.hooks.PreToolUse[0].matcher, 'Edit|Write|MultiEdit|NotebookEdit|Bash|mcp__.*serena.*', 'devrailsv2 gate runs first and covers Serena');
  assert.ok(JSON.stringify(s.hooks).includes('serena-hooks activate'));
  assert.ok(!JSON.stringify(s.hooks).includes('auto-approve'));
  assert.match(read(dir, 'AGENTS.md'), /## Code intelligence: Serena/);
  assert.match(read(dir, '.gitignore'), /\.serena\/cache\//);
  // setup was committed by initRepo, so the setup RFC covers the Serena files
  assert.equal(git(dir, 'status', '--porcelain').out.trim(), '');

  // disable removes hooks and rules again
  assert.equal(cli(dir, ['serena', 'disable']).code, 0);
  assert.ok(!read(dir, '.claude/settings.json').includes('serena-hooks'));
  assert.doesNotMatch(read(dir, 'AGENTS.md'), /Code intelligence: Serena/);
  assert.match(read(dir, '.claude/settings.json'), /mcp__\.\*serena/, 'the gate keeps covering Serena tools');
});

test('Serena edits go through the RFC gate', () => {
  const dir = initRepo('serena-gate', ['--serena']);
  const body = { name_path: 'total', relative_path: 'src/invoice.ts', body: 'function total() { return 1; }' };

  // reads are always fine; edits need an approved, active RFC
  assert.equal(serena(dir, 'find_symbol', { name_path_pattern: 'total' }), 0);
  assert.equal(serena(dir, 'find_referencing_symbols', { name_path: 'total', relative_path: 'src/invoice.ts' }), 0);
  assert.equal(serena(dir, 'write_memory', { memory_name: 'hints', content: 'x' }), 0);
  assert.equal(serena(dir, 'replace_symbol_body', body), 2, 'setup RFC does not cover source');
  assert.equal(serena(dir, 'rename_symbol', { name_path: 'total', relative_path: 'src/invoice.ts', new_name: 'sum' }), 2);

  // never allowed
  assert.equal(serena(dir, 'serena_repl', { session: 's', code: 'open("x","w")' }), 2);
  assert.equal(serena(dir, 'execute_shell_command', { command: 'git commit --no-verify -m x' }), 2);
  assert.equal(serena(dir, 'replace_content', { relative_path: '.serena/project.yml', needle: 'tools', repl: 'REPL', mode: 'literal' }), 2);
  assert.equal(serena(dir, 'replace_content', { relative_path: '.mcp.json', needle: 'a', repl: 'b', mode: 'literal' }), 2);

  cli(dir, ['rfc', 'new', 'Totals', '--affects', 'src/invoice.ts']);
  const rfcFile = fs.readdirSync(path.join(dir, 'docs/rfc')).find((f) => f.startsWith(`RFC-${K1}`));
  assert.equal(serena(dir, 'replace_content', { relative_path: `docs/rfc/${rfcFile}`, needle: 'status: draft', repl: 'status: approved', mode: 'literal' }), 2, 'RFCs are never edited through Serena');
  assert.equal(serena(dir, 'replace_in_files', { needle: 'draft', repl: 'approved', mode: 'literal' }), 2, 'repo-wide replace is refused');
  assert.equal(serena(dir, 'replace_in_files', { needle: 'draft', repl: 'approved', mode: 'literal', relative_path: 'docs' }), 2, 'folders containing RFCs are refused');

  fillRfc(dir, K1, ['Given lines, when totalled, then the sum']);
  approve(dir, K1);
  assert.equal(cli(dir, ['rfc', 'start', '1']).code, 0);
  assert.equal(serena(dir, 'replace_symbol_body', body), 0, 'approved + active RFC allows Serena edits');
  assert.equal(serena(dir, 'rename_symbol', { name_path: 'total', relative_path: 'src/invoice.ts', new_name: 'sum' }), 0);
  assert.equal(serena(dir, 'replace_in_files', { needle: 'a', repl: 'b', mode: 'literal', relative_path: 'src' }), 0);
  assert.equal(serena(dir, 'replace_symbol_body', { ...body, relative_path: '../outside.ts' }), 2);

  // strict mode: Serena edits outside affected_areas are blocked, like built-in edits
  const cfg = JSON.parse(read(dir, '.rails/config.json'));
  cfg.strictness = 'strict';
  write(dir, '.rails/config.json', JSON.stringify(cfg));
  assert.equal(serena(dir, 'replace_symbol_body', { ...body, relative_path: 'src/other.ts' }), 2);
  assert.equal(serena(dir, 'replace_symbol_body', body), 0);
});
