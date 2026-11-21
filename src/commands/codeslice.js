import { findRoot, log, c, CLI } from '../util.js';
import { loadConfig, saveConfig } from '../config.js';
import { generate, printActions } from '../scaffold.js';
import { codesliceInstalled, codesliceSupported, CODESLICE_TOOLS, INSTALL_HINT } from '../codeslice.js';

export default async function codeslice({ pos }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  const sub = pos[0] || 'status';
  const version = codesliceInstalled();
  delete cfg.serena; // replaced by CodeSlice

  if (sub === 'status') {
    const state = !codesliceSupported(cfg) ? c.dim(`not available for stack "${cfg.stack}" yet (C# only)`) : cfg.codeslice?.enabled ? c.green('enabled') : c.dim('disabled');
    console.log(`${c.bold('CodeSlice')}  ${state}  ·  ${version ? `installed (${version})` : c.yellow('not installed')}`);
    console.log(`  tools            ${CODESLICE_TOOLS.join(', ')} (all read-only)`);
    console.log('  graph            .codecanvas/architecture-graph.json, re-analyzed when .cs/.csproj files change');
    console.log('  Claude Code      .mcp.json  ·  Copilot/VS Code  .vscode/mcp.json');
    return 0;
  }
  if (sub === 'enable' || sub === 'disable') {
    if (sub === 'enable' && !codesliceSupported(cfg)) throw new Error(`CodeSlice only analyzes C# so far; this repository's stack is "${cfg.stack}".`);
    cfg.codeslice = { enabled: sub === 'enable' };
    saveConfig(root, cfg);
    printActions(generate(root, cfg), log);
    if (sub === 'enable') {
      if (!version) log.warn(`CodeSlice is not installed. Install it with: ${INSTALL_HINT}`);
      log.info(`Commit the changes under the setup RFC or an RFC of their own, e.g.:
  git add -A && git commit -m "RFC-${cfg.setupRfc || '<yyyy>-000'}: connect CodeSlice"
Restart Claude Code / reload VS Code so the MCP server is picked up. The first call analyzes the solution (a minute or two on large ones).`);
    } else {
      log.info('CodeSlice MCP entries, subagent tools and AGENTS.md rules were removed. .codecanvas/ is a cache; delete it if you like.');
    }
    return 0;
  }
  throw new Error(`Unknown subcommand "codeslice ${sub}". Use enable | disable | status. (${CLI} codeslice status)`);
}
