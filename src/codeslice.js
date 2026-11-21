// CodeSlice (DevTools/CodeSliceMcp) integration: MCP config for Claude Code and Copilot.
import path from 'node:path';
import { exists, readJson, writeJson, run } from './util.js';

/** Stacks CodeSlice can analyze. Node gets it once the TS analyzer writes the same graph. */
export const CODESLICE_STACKS = ['dotnet'];

export const codesliceSupported = (cfg) =>
  CODESLICE_STACKS.includes(cfg.stack) || CODESLICE_STACKS.includes(cfg.migration?.from);
export const codesliceEnabled = (cfg) => !!cfg.codeslice?.enabled && codesliceSupported(cfg);

/** The tools the read-only subagents get (CodeSlice has no editing tools). */
export const CODESLICE_TOOLS = ['find_symbol', 'get_type_overview', 'get_symbol_slice', 'get_blast_radius', 'analyze_change_impact', 'refresh_graph'];

export const INSTALL_HINT = 'dotnet pack CodeSliceMcp -c Release && dotnet tool install -g CodeSliceMcp --add-source CodeSliceMcp/nupkg   (in the DevTools repo)';

export function codesliceInstalled() {
  if (process.env.DEVRAILS_NO_CODESLICE_CLI) return null; // tests: behave as if CodeSlice were not installed
  const r = run('codeslice', ['--version'], { shell: process.platform === 'win32' });
  return !r.error && r.ok ? r.stdout : null;
}

// ---------- client configuration ----------
function mergeServer(root, rel, key, want, { dryRun }) {
  const p = path.join(root, rel);
  const existed = exists(p);
  const j = readJson(p, {}) || {};
  j[key] ??= {};
  const changed = JSON.stringify(j[key].codeslice) !== JSON.stringify(want);
  j[key].codeslice = want;
  if (changed && !dryRun) writeJson(p, j);
  return { rel, act: !existed ? 'created' : changed ? 'merged codeslice server' : 'unchanged' };
}

/** Claude Code project-scoped MCP config (.mcp.json), merged with any existing servers. */
export const mergeMcpJson = (root, { dryRun = false } = {}) =>
  mergeServer(root, '.mcp.json', 'mcpServers', { type: 'stdio', command: 'codeslice', args: ['--root', '.'] }, { dryRun });

/** VS Code / GitHub Copilot agent mode MCP config (.vscode/mcp.json). */
export const mergeVscodeMcp = (root, { dryRun = false } = {}) =>
  mergeServer(root, '.vscode/mcp.json', 'servers', { type: 'stdio', command: 'codeslice', args: ['--root', '${workspaceFolder}'] }, { dryRun });

/** Remove server entries by name from both MCP configs. */
export function removeServers(root, names, { dryRun = false } = {}) {
  const actions = [];
  for (const [rel, key] of [['.mcp.json', 'mcpServers'], ['.vscode/mcp.json', 'servers']]) {
    const p = path.join(root, rel);
    const j = readJson(p, null);
    const found = names.filter((n) => j?.[key]?.[n]);
    if (!found.length) continue;
    for (const n of found) delete j[key][n];
    if (!dryRun) writeJson(p, j);
    actions.push({ rel, act: `removed ${found.join(', ')} server` });
  }
  return actions;
}
