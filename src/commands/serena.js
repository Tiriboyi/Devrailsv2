import { findRoot, log, c, CLI } from '../util.js';
import { loadConfig, saveConfig } from '../config.js';
import { generate, printActions } from '../scaffold.js';
import { serenaInstalled, serenaLanguages, EXCLUDED_TOOLS } from '../serena.js';

export default async function serena({ pos, flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  const sub = pos[0] || 'status';
  const version = serenaInstalled();

  if (sub === 'status') {
    console.log(`${c.bold('Serena')}  ${cfg.serena?.enabled ? c.green('enabled') : c.dim('disabled')}  ·  ${version ? `installed (${version})` : c.yellow('not installed')}`);
    console.log(`  languages        ${serenaLanguages(cfg).join(', ') || '(set in .serena/project.yml)'}`);
    console.log(`  disabled tools   ${EXCLUDED_TOOLS.join(', ')}`);
    console.log('  gated tools      every Serena editing tool needs an approved, active RFC (same rules as Edit/Write)');
    console.log(`  Claude Code      .mcp.json (context claude-code)${cfg.serena?.hooks !== false ? ' + serena-hooks activate/remind/cleanup' : ''}`);
    console.log('  Copilot/VS Code  .vscode/mcp.json (context vscode)');
    return 0;
  }
  if (sub === 'enable' || sub === 'disable') {
    cfg.serena = { ...(cfg.serena || {}), enabled: sub === 'enable' };
    if (flags['no-hooks']) cfg.serena.hooks = false;
    saveConfig(root, cfg);
    printActions(generate(root, cfg), log);
    if (sub === 'enable') {
      if (!version) log.warn('Serena is not installed. Install it with: uv tool install -p 3.13 serena-agent   (then: serena init)');
      log.info(`Commit the changes under the setup RFC or an RFC of their own, e.g.:
  git add -A && git commit -m "RFC-${cfg.setupRfc || '<yyyy>-000'}: connect Serena"
Restart Claude Code / reload VS Code so the MCP server is picked up.`);
    } else {
      log.info('Serena hooks and AGENTS.md rules were removed. .mcp.json, .vscode/mcp.json and .serena/ were left in place; remove the "serena" server entries by hand if you no longer want them.');
    }
    return 0;
  }
  throw new Error(`Unknown subcommand "serena ${sub}". Use enable | disable | status. (${CLI} serena status)`);
}
