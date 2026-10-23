import path from 'node:path';
import { findRoot, exists, read, readJson, git, isGitRepo, log, c } from '../util.js';
import { loadConfig } from '../config.js';
import { testAuth } from './auth.js';
import { serenaInstalled } from '../serena.js';

export default async function doctor() {
  const root = findRoot();
  const cfg = loadConfig(root);
  let ok = true;
  const fail = (m) => ((ok = false), log.err(m));

  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj > 18 || (maj === 18 && min >= 17)) log.ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node} is too old (need 18.17+).`);

  if (!isGitRepo(root)) fail('Not a git repository.');
  else {
    const hp = git(['config', 'core.hooksPath'], root).stdout;
    if (hp === '.githooks') log.ok('Git hooks active (core.hooksPath = .githooks)');
    else fail(`Git hooks not active. Run: git config core.hooksPath .githooks`);
  }
  for (const f of ['.githooks/pre-commit', '.githooks/commit-msg', '.rails/tool/bin/devrailsv2.js', 'AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', '.github/workflows/devrailsv2.yml', 'docs/STATUS.md', 'CHANGELOG.md']) {
    if (exists(path.join(root, f))) log.ok(f);
    else fail(`${f} is missing — run \`devrailsv2 update\`.`);
  }
  const settings = readJson(path.join(root, '.claude/settings.json'), {});
  if (JSON.stringify(settings?.hooks || {}).includes('devrailsv2.js hook claude')) log.ok('Claude Code hooks configured');
  else fail('Claude Code hooks missing from .claude/settings.json — run `devrailsv2 update`.');
  if (!(cfg.approval.approvers || []).length) log.warn('approval.approvers is empty: CI cannot verify who approved an RFC.');

  if (cfg.serena?.enabled) {
    console.log(c.bold('\nSerena'));
    const v = serenaInstalled();
    if (v) log.ok(`Serena installed (${v})`);
    else fail('Serena is enabled but not installed: uv tool install -p 3.13 serena-agent');
    const mcp = readJson(path.join(root, '.mcp.json'), {});
    if (mcp?.mcpServers?.serena && JSON.stringify(mcp.mcpServers.serena.args || []).includes('"tools"')) log.ok('.mcp.json registers serena for Claude Code (tools interface)');
    else fail('.mcp.json has no serena server — run `devrailsv2 serena enable`.');
    if (readJson(path.join(root, '.vscode/mcp.json'), {})?.servers?.serena) log.ok('.vscode/mcp.json registers serena for Copilot');
    else fail('.vscode/mcp.json has no serena server — run `devrailsv2 serena enable`.');
    const py = path.join(root, '.serena/project.yml');
    if (!exists(py)) fail('.serena/project.yml missing — run `devrailsv2 serena enable`.');
    else if (!/^agent_interface:\s*tools\s*$/m.test(read(py))) fail('.serena/project.yml must set agent_interface: tools (the REPL interface bypasses the devrailsv2 hook) — run `devrailsv2 update`.');
    else if (!/^excluded_tools:.*serena_repl/m.test(read(py))) fail('.serena/project.yml does not exclude serena_repl / execute_shell_command — run `devrailsv2 update`.');
    else log.ok('.serena/project.yml has the devrailsv2 settings');
    if (JSON.stringify(settings?.hooks?.PreToolUse || []).includes('mcp__.*serena')) log.ok('devrailsv2 hook covers Serena tools');
    else fail('The devrailsv2 PreToolUse hook does not cover Serena tools — run `devrailsv2 update`.');
  }

  console.log(c.bold('\nTracker'));
  if (!(await testAuth(cfg))) ok = false;
  console.log(ok ? c.green('\nAll good.') : c.red('\nSome checks failed.'));
  return ok ? 0 : 1;
}
