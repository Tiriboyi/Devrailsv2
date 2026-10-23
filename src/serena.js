// Serena (https://github.com/oraios/serena) integration: MCP config, project config and tool classification.
import path from 'node:path';
import { exists, read, write, readJson, writeJson, run } from './util.js';

/** Serena language-server ids per devrailsv2 stack. */
export const SERENA_LANGUAGES = { node: ['typescript'], dotnet: ['csharp'], other: [] };

/** Tools devrailsv2 always disables in Serena: they bypass review (arbitrary code / shell) or duplicate the agent's own tools. */
export const EXCLUDED_TOOLS = ['serena_repl', 'execute_shell_command', 'remove_project'];

export function serenaLanguages(cfg) {
  const set = new Set(SERENA_LANGUAGES[cfg.stack] || []);
  if (cfg.migration?.from) for (const l of SERENA_LANGUAGES[cfg.migration.from] || []) set.add(l);
  return [...set];
}

export const isSerenaTool = (name = '') => /^mcp__.*serena.*__/i.test(name);
export const serenaToolName = (name = '') => name.replace(/^mcp__.*?__/, '').toLowerCase();

// Classification by tool name (Serena 2.x). Anything unknown that looks like it edits is treated as an edit.
const FILE_EDIT = new Set([
  'create_text_file', 'replace_content', 'delete_lines', 'replace_lines', 'insert_at_line',
  'replace_symbol_body', 'insert_after_symbol', 'insert_before_symbol', 'safe_delete_symbol',
  'jet_brains_safe_delete', 'jet_brains_inline_symbol',
]);
const MULTI_FILE_EDIT = new Set(['rename_symbol', 'jet_brains_rename', 'jet_brains_move', 'replace_in_files']);
const MEMORY_EDIT = new Set(['write_memory', 'edit_memory', 'delete_memory', 'rename_memory', 'onboarding']);
const BLOCKED = new Set(['serena_repl', 'remove_project']);
const SHELL = new Set(['execute_shell_command']);

export function classifySerenaTool(name) {
  const t = serenaToolName(name);
  if (BLOCKED.has(t)) return 'blocked';
  if (SHELL.has(t)) return 'shell';
  if (MEMORY_EDIT.has(t)) return 'memory';
  if (FILE_EDIT.has(t)) return 'file-edit';
  if (MULTI_FILE_EDIT.has(t)) return 'multi-edit';
  if (/(replace|insert|delete|create|rename|move|inline|write|edit|remove)/.test(t)) return 'multi-edit';
  return 'read';
}

/** Repo-relative paths a Serena edit call will touch (as far as can be known up front). */
export function serenaTargets(input = {}) {
  return [input.relative_path, input.target_relative_path].filter((p) => typeof p === 'string' && p.trim() !== '');
}

// ---------- client configuration ----------
// --agent-interface tools: Serena 2.x defaults to a single `serena_repl` tool that runs Python, which no hook can inspect.
const serverArgs = (context) => ['start-mcp-server', `--context=${context}`, '--project-from-cwd', '--agent-interface', 'tools'];

/** Claude Code project-scoped MCP config (.mcp.json), merged with any existing servers. */
export function mergeMcpJson(root, { dryRun = false } = {}) {
  const p = path.join(root, '.mcp.json');
  const existed = exists(p);
  const j = readJson(p, {}) || {};
  j.mcpServers ??= {};
  const want = { type: 'stdio', command: 'serena', args: serverArgs('claude-code') };
  const changed = JSON.stringify(j.mcpServers.serena) !== JSON.stringify(want);
  j.mcpServers.serena = want;
  if (changed && !dryRun) writeJson(p, j);
  return { rel: '.mcp.json', act: !existed ? 'created' : changed ? 'merged serena server' : 'unchanged' };
}

/** VS Code / GitHub Copilot agent mode MCP config (.vscode/mcp.json). */
export function mergeVscodeMcp(root, { dryRun = false } = {}) {
  const p = path.join(root, '.vscode', 'mcp.json');
  const existed = exists(p);
  const j = readJson(p, {}) || {};
  j.servers ??= {};
  const want = { type: 'stdio', command: 'serena', args: ['start-mcp-server', '--context=vscode', '--project', '${workspaceFolder}', '--agent-interface', 'tools'] };
  const changed = JSON.stringify(j.servers.serena) !== JSON.stringify(want);
  j.servers.serena = want;
  if (changed && !dryRun) writeJson(p, j);
  return { rel: '.vscode/mcp.json', act: !existed ? 'created' : changed ? 'merged serena server' : 'unchanged' };
}

/** Serena's own hooks for Claude Code: activate the project, nudge towards symbolic tools, clean up. */
export function serenaClaudeHooks() {
  return {
    SessionStart: { hooks: [{ type: 'command', command: 'serena-hooks activate --client claude-code' }] },
    PreToolUse: { matcher: '', hooks: [{ type: 'command', command: 'serena-hooks remind --client claude-code' }] },
    SessionEnd: { hooks: [{ type: 'command', command: 'serena-hooks cleanup --client claude-code' }] },
  };
}

// ---------- .serena/project.yml ----------
export const initialPrompt =
  'This repository uses devrailsv2. AGENTS.md is the main instruction file. Never edit code without an approved, active RFC ' +
  '(docs/rfc/RFC-<yyyy>-<nnn>-*.md); devrailsv2 hooks block such edits. Use Serena to find symbols and references for ' +
  'ticket analysis, RFC evidence and affected_areas. Serena memories are a convenience cache: docs/STATUS.md, RFCs and change records are the source of truth.';

function yamlList(items) {
  return `[${items.map((s) => JSON.stringify(s)).join(', ')}]`;
}

/** Apply devrailsv2's settings to a project.yml text (keeps comments and the user's other settings). */
export function patchProjectYml(text, { languages = [] } = {}) {
  let t = text;
  const getList = (key) => {
    const m = t.match(new RegExp(`^${key}:[ \\t]*\\[(.*)\\][ \\t]*$`, 'm'));
    if (!m) return null;
    return m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  };
  const setLine = (key, value) => {
    const re = new RegExp(`^${key}:.*$`, 'm');
    t = re.test(t) ? t.replace(re, `${key}: ${value}`) : `${t.replace(/\s*$/, '\n')}${key}: ${value}\n`;
  };
  const excluded = new Set([...(getList('excluded_tools') || []), ...EXCLUDED_TOOLS]);
  setLine('excluded_tools', yamlList([...excluded]));
  setLine('read_only', 'false');
  setLine('agent_interface', 'tools'); // never the REPL interface: its edits are invisible to the devrailsv2 hook
  const ip = t.match(/^initial_prompt:[ \t]*(.*)$/m);
  if (!ip || /^("")?$/.test(ip[1].trim()) || ip[1].includes('devrailsv2')) setLine('initial_prompt', JSON.stringify(initialPrompt));
  if (languages.length && !/^language_servers:/m.test(t)) setLine('language_servers', yamlList(languages));
  return t;
}

export function minimalProjectYml(name, languages) {
  return [
    '# Serena project configuration (created by devrailsv2; see `serena project create --help` for all options)',
    `project_name: ${JSON.stringify(name)}`,
    `language_servers: ${yamlList(languages)}`,
    'encoding: "utf-8"',
    'ignore_all_files_in_gitignore: true',
    'ignored_paths: []',
    'read_only: false',
    'agent_interface: tools',
    `excluded_tools: ${yamlList(EXCLUDED_TOOLS)}`,
    `initial_prompt: ${JSON.stringify(initialPrompt)}`,
    '',
  ].join('\n');
}

export function serenaInstalled() {
  if (process.env.DEVRAILS_NO_SERENA_CLI) return null; // tests: behave as if Serena were not installed
  const r = run('serena', ['--version'], { shell: process.platform === 'win32' });
  return !r.error && r.ok ? r.stdout : null;
}

/** Create (via `serena project create` when available) and patch .serena/project.yml. */
export function ensureProjectYml(root, cfg, { dryRun = false } = {}) {
  const p = path.join(root, '.serena', 'project.yml');
  const languages = serenaLanguages(cfg);
  let created = false;
  if (!exists(p) && !dryRun) {
    if (serenaInstalled()) {
      const args = ['project', 'create', ...languages.flatMap((l) => ['--language', l]), '--name', cfg.project, root];
      run('serena', args, { cwd: root, shell: process.platform === 'win32' });
    }
    if (!exists(p)) write(p, minimalProjectYml(cfg.project, languages));
    created = true;
  }
  if (dryRun) return { rel: '.serena/project.yml', act: exists(p) ? 'patched (devrailsv2 settings)' : 'created' };
  const before = read(p);
  const after = patchProjectYml(before, { languages });
  if (after !== before) write(p, after);
  return { rel: '.serena/project.yml', act: created ? 'created' : after !== before ? 'patched (devrailsv2 settings)' : 'unchanged' };
}
