import path from 'node:path';
import { findRoot, exists, read, readJson, git, isGitRepo, log, c } from '../util.js';
import { loadConfig } from '../config.js';
import { testAuth } from './auth.js';
import { codesliceInstalled, codesliceEnabled, INSTALL_HINT } from '../codeslice.js';
import { installDirs } from '../scaffold.js';

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
  for (const f of ['.githooks/pre-commit', '.githooks/commit-msg', '.githooks/prepare-commit-msg', '.rails/tool/bin/devrailsv2.js', 'AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', '.github/workflows/devrailsv2.yml', 'docs/STATUS.md', 'CHANGELOG.md']) {
    if (exists(path.join(root, f))) log.ok(f);
    else fail(`${f} is missing — run \`devrailsv2 update\`.`);
  }
  const wf = path.join(root, '.github/workflows/devrailsv2.yml');
  if (exists(wf) && (cfg.stack === 'node' || cfg.migration?.from === 'node')) {
    const text = read(wf);
    for (const dir of installDirs(cfg)) {
      const installs = /npm (ci|install)/.test(text);
      const ok = installs && (dir === '.' || text.includes(`working-directory: ${dir}`) || text.includes(`cd ${dir} && npm ci`) || text.includes(`cd ${dir} && npm install`));
      if (ok) log.ok(`CI installs Node dependencies in ${dir}`);
      else fail(`.github/workflows/devrailsv2.yml does not install Node dependencies in ${dir}, so tests there fail in CI (e.g. "vitest: not found"). See README → Troubleshooting.`);
    }
  }
  const settings = readJson(path.join(root, '.claude/settings.json'), {});
  if (JSON.stringify(settings?.hooks || {}).includes('devrailsv2.js hook claude')) log.ok('Claude Code hooks configured');
  else fail('Claude Code hooks missing from .claude/settings.json — run `devrailsv2 update`.');
  if (!(cfg.approval.approvers || []).length) log.warn('approval.approvers is empty: CI cannot verify who approved an RFC.');

  const mcp = readJson(path.join(root, '.mcp.json'), {});
  if (codesliceEnabled(cfg)) {
    console.log(c.bold('\nCodeSlice'));
    const v = codesliceInstalled();
    if (v) log.ok(`CodeSlice installed (${v})`);
    else fail(`CodeSlice is enabled but not installed: ${INSTALL_HINT}`);
    if (mcp?.mcpServers?.codeslice) log.ok('.mcp.json registers codeslice for Claude Code');
    else fail('.mcp.json has no codeslice server — run `devrailsv2 codeslice enable`.');
    if (readJson(path.join(root, '.vscode/mcp.json'), {})?.servers?.codeslice) log.ok('.vscode/mcp.json registers codeslice for Copilot');
    else fail('.vscode/mcp.json has no codeslice server — run `devrailsv2 codeslice enable`.');
    if (exists(path.join(root, '.codecanvas/architecture-graph.json'))) log.ok('.codecanvas/architecture-graph.json exists');
    else log.warn('No graph yet: the first CodeSlice call analyzes the solution (a minute or two on large ones).');
  }
  if (mcp?.mcpServers?.serena || exists(path.join(root, '.serena/project.yml')) || JSON.stringify(settings?.hooks || {}).includes('serena-hooks')) {
    fail('Serena is still set up here. devrailsv2 replaced it with CodeSlice — run `devrailsv2 update` to remove it.');
  }

  console.log(c.bold('\nTracker'));
  if (!(await testAuth(cfg))) ok = false;
  console.log(ok ? c.green('\nAll good.') : c.red('\nSome checks failed.'));
  return ok ? 0 : 1;
}
