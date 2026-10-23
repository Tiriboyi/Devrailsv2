import fs from 'node:fs';
import path from 'node:path';
import {
  exists, read, write, readJson, writeJson, template, render, upsertBlock, insertAfterMarker,
  today, PKG_ROOT, TEMPLATES, CLI, gitUser,
} from './util.js';
import { STACKS } from './config.js';
import { yamlScalar } from './frontmatter.js';
import { serenaClaudeHooks, mergeMcpJson, mergeVscodeMcp, ensureProjectYml } from './serena.js';

const PROMPTS = [
  { name: 'ticket', description: 'Analyse a ticket and define fit criteria (no code changes)', hint: '<ticket id, e.g. gh:42 or ado:1234>' },
  { name: 'rfc', description: 'Draft a Request for Change and stop for approval', hint: '<what should change>' },
  { name: 'spec', description: 'Write the spec and acceptance criteria for an approved RFC', hint: '<RFC id>' },
  { name: 'implement', description: 'Implement an approved RFC test-first (red, green, refactor)', hint: '<RFC id>' },
  { name: 'done', description: 'Write the change record, update docs and run the gate', hint: '[RFC id]' },
  { name: 'status', description: 'Summarise where the project is and the next step', hint: '' },
];

function ciTestSteps(cfg) {
  const stacks = new Set([cfg.stack]);
  if (cfg.migration?.from) stacks.add(cfg.migration.from);
  const steps = [];
  if (stacks.has('node')) {
    steps.push(
      "      - name: Install Node dependencies\n        if: hashFiles('package-lock.json') != ''\n        run: npm ci",
    );
  }
  if (stacks.has('dotnet')) {
    steps.push("      - uses: actions/setup-dotnet@v4\n        with:\n          dotnet-version: '10.0.x'");
  }
  steps.push(`      - name: Tests\n        run: ${cfg.testCommand}`);
  return steps.join('\n');
}

export function buildVars(cfg) {
  const m = cfg.migration;
  return {
    project: cfg.project,
    mode: cfg.mode,
    stack: STACKS[cfg.stack]?.label ?? cfg.stack,
    strictness: cfg.strictness,
    testCommand: cfg.testCommand,
    srcGlobs: cfg.paths.src.map((g) => `\`${g}\``).join(', '),
    testGlobs: cfg.paths.tests.map((g) => `\`${g}\``).join(', '),
    prLabel: cfg.approval.prLabel,
    cli: CLI,
    date: today(),
    from: m?.from ?? '',
    to: m?.to ?? '',
    legacyPath: m?.legacyPath ?? '',
    testSteps: ciTestSteps(cfg),
    stackRules: template(`stack/${exists(path.join(TEMPLATES, 'stack', `${cfg.stack}.md`)) ? cfg.stack : 'other'}.md`),
    serenaRules: cfg.serena?.enabled ? render(read(path.join(TEMPLATES, 'stack', 'serena.md')), { cli: CLI }) : '',
    migrationRules: m ? render(read(path.join(TEMPLATES, 'stack', 'migration.md')), { from: m.from, to: m.to, legacyPath: m.legacyPath, cli: CLI }) : '',
  };
}

/**
 * Write the scaffold. Strategies:
 *  block  – instruction files: insert/replace only the devrailsv2 managed block, keep the rest
 *  create – user-owned files: create if missing, never overwrite unless --force
 *  own    – tool-owned files: always kept in sync with the installed version
 */
export function generate(root, cfg, { force = false, dryRun = false, initial = false } = {}) {
  const v = buildVars(cfg);
  const actions = [];
  const T = (name) => render(read(path.join(TEMPLATES, name)), v);

  const put = (rel, content, how, { exec = false } = {}) => {
    const abs = path.join(root, rel);
    const ex = exists(abs);
    let next = content;
    let act;
    if (how === 'block') {
      const cur = ex ? read(abs) : null;
      next = ex ? upsertBlock(cur, content) : content;
      act = !ex ? 'created' : next === cur ? 'unchanged' : 'updated managed block';
    } else if (how === 'create') {
      act = ex ? (force ? 'overwritten' : 'kept (already exists)') : 'created';
    } else {
      act = !ex ? 'created' : read(abs) === content ? 'unchanged' : 'updated';
    }
    if (!dryRun && !['kept (already exists)', 'unchanged'].includes(act)) {
      write(abs, next);
      if (exec) fs.chmodSync(abs, 0o755);
    }
    actions.push({ rel, act });
  };

  // Main instructions
  put('AGENTS.md', T('agents.md'), 'block');
  put('CLAUDE.md', T('claude.md'), 'block');
  put('.github/copilot-instructions.md', T('github/copilot-instructions.md'), 'block');

  // Prompts / slash commands (same source, two dialects)
  for (const p of PROMPTS) {
    const body = render(read(path.join(TEMPLATES, 'prompts', `${p.name}.md`)), v);
    put(
      `.claude/commands/rails-${p.name}.md`,
      `---\ndescription: ${p.description}\n${p.hint ? `argument-hint: ${p.hint}\n` : ''}---\n\n${body.replace(/@@ARGS@@/g, '$ARGUMENTS')}`,
      'own',
    );
    put(
      `.github/prompts/rails-${p.name}.prompt.md`,
      `---\ndescription: ${p.description}\n---\n\n${body.replace(/@@ARGS@@/g, '${input:args}')}`,
      'own',
    );
  }

  // Enforcement
  mergeClaudeSettings(root, actions, dryRun, cfg);
  if (cfg.serena?.enabled) {
    actions.push(mergeMcpJson(root, { dryRun }));
    actions.push(mergeVscodeMcp(root, { dryRun }));
    actions.push(ensureProjectYml(root, cfg, { dryRun }));
  }
  put('.githooks/pre-commit', T('githooks/pre-commit'), 'own', { exec: true });
  put('.githooks/commit-msg', T('githooks/commit-msg'), 'own', { exec: true });
  put('.github/workflows/devrailsv2.yml', T('github/workflow.yml'), 'create');
  put('.github/pull_request_template.md', T('github/pull_request_template.md'), 'create');
  // Ticket formats that tell people (and agents) what a complete ticket contains
  if (cfg.tracker?.provider !== 'azure') {
    for (const f of ['bug.yml', 'feature.yml', 'ui.yml', 'config.yml']) put(`.github/ISSUE_TEMPLATE/${f}`, read(path.join(TEMPLATES, 'tickets', 'github', f)), 'create');
  }
  put('docs/guides/ticket-format.md', T('docs/ticket-format.md'), 'own');
  const hasAzure = ['azure', 'both'].includes(cfg.tracker?.provider);
  if (hasAzure) put('azure-pipelines.devrailsv2.yml', T('github/azure-pipelines.yml'), 'create');

  // Docs
  put('docs/guides/spec-guidelines.md', T('docs/spec-guidelines.md'), 'own');
  put('docs/guides/workflow.md', T('docs/workflow.md'), 'own');
  put('docs/STATUS.md', T('docs/STATUS.md'), 'create');
  ensureChangelog(root, actions, dryRun);
  for (const d of ['docs/rfc', 'docs/specs', 'docs/changes', 'docs/adr', 'docs/analysis']) {
    if (!exists(path.join(root, d))) put(`${d}/.gitkeep`, '', 'create');
  }
  if (cfg.migration) {
    put('docs/migration/evidence-map.md', T('docs/evidence-map.md'), 'create');
    put('docs/migration/parity-matrix.md', T('docs/parity-matrix.md'), 'create');
  }
  if (initial) {
    const u = gitUser(root);
    const who = u.display || u.name || 'repository owner';
    const key = cfg.setupRfc || `${new Date().getFullYear()}-000`;
    put(`docs/rfc/RFC-${key}-adopt-devrailsv2.md`, render(T('docs/rfc-setup.md'), { key, userYaml: yamlScalar(who), user: who }), 'create');
  }

  // .gitignore
  const gi = path.join(root, '.gitignore');
  const giText = exists(gi) ? read(gi) : '';
  const want = ['.rails/state.json', '.rails/runtime/', ...(cfg.serena?.enabled ? ['.serena/cache/', '.serena/project.local.yml'] : [])];
  const missing = want.filter((l) => !giText.split(/\r?\n/).includes(l));
  if (missing.length) {
    if (!dryRun) write(gi, giText.replace(/\s*$/, giText ? '\n\n' : '') + '# devrailsv2 (local state)\n' + missing.join('\n') + '\n');
    actions.push({ rel: '.gitignore', act: giText ? 'updated' : 'created' });
  }

  // Git hooks must keep LF line endings on Windows (autocrlf would break the sh shebang)
  const ga = path.join(root, '.gitattributes');
  const gaText = exists(ga) ? read(ga) : '';
  if (!gaText.includes('.githooks/*')) {
    if (!dryRun) write(ga, gaText.replace(/\s*$/, gaText ? '\n\n' : '') + '# devrailsv2\n.githooks/* text eol=lf\n.rails/tool/** text eol=lf\n');
    actions.push({ rel: '.gitattributes', act: gaText ? 'updated' : 'created' });
  }

  // Vendored CLI so hooks and CI work in any repo (no npm install needed, works for .NET repos too)
  vendorTool(root, actions, dryRun);
  return actions;
}

function ensureChangelog(root, actions, dryRun) {
  const p = path.join(root, 'CHANGELOG.md');
  const marker = '<!-- devrailsv2:unreleased -->';
  if (!exists(p)) {
    if (!dryRun) write(p, template('docs/CHANGELOG.md'));
    actions.push({ rel: 'CHANGELOG.md', act: 'created' });
    return;
  }
  const t = read(p);
  if (t.includes(marker)) return actions.push({ rel: 'CHANGELOG.md', act: 'unchanged' });
  const next = /^## \[?Unreleased\]?.*$/im.test(t)
    ? t.replace(/^(## \[?Unreleased\]?.*)$/im, `$1\n${marker}`)
    : /^# .*$/m.test(t)
      ? t.replace(/^(# .*)$/m, `$1\n\n## [Unreleased]\n${marker}\n`)
      : `## [Unreleased]\n${marker}\n\n${t}`;
  if (!dryRun) write(p, next);
  actions.push({ rel: 'CHANGELOG.md', act: 'updated (added marker)' });
}

function mergeClaudeSettings(root, actions, dryRun, cfg) {
  const p = path.join(root, '.claude/settings.json');
  const settings = readJson(p, {}) || {};
  const before = JSON.stringify(settings);
  settings.hooks ??= {};
  const upsert = (event, entry, marker) => {
    const list = (settings.hooks[event] ??= []);
    const idx = list.findIndex((e) => JSON.stringify(e).includes(marker));
    if (idx < 0) list.push(entry);
    else list[idx] = entry;
  };
  const removeAll = (marker) => {
    for (const [event, list] of Object.entries(settings.hooks)) {
      settings.hooks[event] = list.filter((e) => !JSON.stringify(e).includes(marker));
      if (!settings.hooks[event].length) delete settings.hooks[event];
    }
  };
  // devrailsv2's gate — also covers Serena's MCP tools, which edit files outside Claude's built-in tools
  upsert('PreToolUse', {
    matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash|mcp__.*serena.*',
    hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.rails/tool/bin/devrailsv2.js" hook claude' }],
  }, 'devrailsv2.js');
  upsert('SessionStart', {
    hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.rails/tool/bin/devrailsv2.js" hook session-start' }],
  }, 'devrailsv2.js');
  // Serena's own hooks (not auto-approve: approvals stay with Claude Code's permission settings)
  if (cfg.serena?.enabled && cfg.serena.hooks !== false) {
    for (const [event, entry] of Object.entries(serenaClaudeHooks())) upsert(event, entry, 'serena-hooks');
  } else removeAll('serena-hooks');
  const existed = exists(p);
  const changed = JSON.stringify(settings) !== before;
  if (changed && !dryRun) writeJson(p, settings);
  actions.push({ rel: '.claude/settings.json', act: !existed ? 'created' : changed ? 'merged hooks' : 'unchanged' });
}

export function vendorTool(root, actions = [], dryRun = false) {
  const dest = path.join(root, '.rails', 'tool');
  if (path.resolve(PKG_ROOT) === path.resolve(dest)) {
    actions.push({ rel: '.rails/tool/', act: 'unchanged (running from vendored copy)' });
    return actions;
  }
  if (!dryRun) {
    fs.rmSync(dest, { recursive: true, force: true });
    for (const d of ['bin', 'src', 'templates']) fs.cpSync(path.join(PKG_ROOT, d), path.join(dest, d), { recursive: true });
    fs.copyFileSync(path.join(PKG_ROOT, 'package.json'), path.join(dest, 'package.json'));
    fs.chmodSync(path.join(dest, 'bin', 'devrailsv2.js'), 0o755);
  }
  actions.push({ rel: '.rails/tool/', act: 'vendored CLI' });
  return actions;
}

export function printActions(actions, log) {
  for (const a of actions) {
    const fn = /kept|unchanged/.test(a.act) ? log.info : log.ok;
    fn(`${a.rel.padEnd(44)} ${a.act}`);
  }
}
