import fs from 'node:fs';
import path from 'node:path';
import {
  exists, isInteractive, ask, select, confirm, git, isGitRepo, gitUser, log, c, CLI,
} from '../util.js';
import { STACKS, normStack, saveConfig, saveState, loadConfig, DEFAULT_COSMETIC, DEFAULT_FAST_TRACK, prefixGlobs, DEFAULT_DOCS, DEFAULT_DOCS_EXCLUDE, DEFAULT_NO_RFC } from '../config.js';
import { configureTracker, describeTracker, testAuth } from './auth.js';
import { generate, printActions } from '../scaffold.js';
import { codesliceInstalled, codesliceSupported, INSTALL_HINT } from '../codeslice.js';
import { defaultModelsConfig } from '../models.js';

function detectStack(root) {
  if (exists(path.join(root, 'package.json'))) return 'node';
  const hasCs = (dir) => exists(dir) && fs.readdirSync(dir).some((f) => /\.(sln|slnx|csproj)$/i.test(f));
  if (hasCs(root) || hasCs(path.join(root, 'src'))) return 'dotnet';
  return '';
}
function hasCode(root) {
  if (!exists(root)) return false;
  const ignore = /^(\.git|readme.*|license.*|\.gitignore|\.gitattributes|\.rails|\.github|\.claude|\.githooks)$/i;
  return fs.readdirSync(root).some((f) => !ignore.test(f));
}

export default async function init({ flags }) {
  const root = path.resolve(flags.dir || process.cwd());
  fs.mkdirSync(root, { recursive: true });
  const interactive = isInteractive(flags);

  if (loadConfig(root, { optional: true }) && !flags.force) {
    throw new Error('This repo is already initialised. Use `devrailsv2 update` to refresh, or `init --force` to start over.');
  }
  console.log(c.bold('\ndevrailsv2 setup\n'));

  // 0. Scope: whole repository, or one folder of a monorepo (e.g. only the backend)
  const subdirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules').map((d) => d.name);
  let scopeDir = flags.scope && flags.scope !== true ? String(flags.scope) : '';
  if (!scopeDir && interactive && subdirs.length) {
    const whole = await confirm('Apply devrailsv2 to the whole repository?', true);
    if (!whole) scopeDir = await ask(`Which folder? (${subdirs.slice(0, 6).join(', ')})`, subdirs.find((d) => /back|api|server|service/i.test(d)) || subdirs[0]);
  }
  scopeDir = scopeDir.replace(/\\/g, '/').replace(/^\.\/|\/+$/g, '');
  if (scopeDir && !exists(path.join(root, scopeDir))) throw new Error(`Scope folder "${scopeDir}" does not exist.`);
  const codeRoot = scopeDir ? path.join(root, scopeDir) : root;
  const detected = detectStack(codeRoot);
  const codePresent = hasCode(codeRoot);

  // 1. Mode
  const mode =
    flags.mode ||
    (interactive
      ? await select('What are you setting up?', [
          { label: 'New blank repo', value: 'new', hint: 'start a project from scratch' },
          { label: 'Existing repo', value: 'existing', hint: 'add rails to code that already exists; nothing is overwritten' },
          { label: 'Migration', value: 'migration', hint: 'move an existing system to a new stack, e.g. Node.js → C#' },
        ], codePresent ? 'existing' : 'new')
      : codePresent ? 'existing' : 'new');
  if (!['new', 'existing', 'migration'].includes(mode)) throw new Error(`Unknown mode "${mode}" (new | existing | migration).`);

  // 2. Stack (and migration source/target)
  const stackOptions = Object.entries(STACKS).map(([value, s]) => ({ label: s.label, value }));
  let stack;
  let migration = null;
  if (mode === 'migration') {
    const from = normStack(flags.from || (interactive ? await select('Migrating FROM', stackOptions, detected || 'node') : detected || 'node'));
    const to = normStack(flags.to || (interactive ? await select('Migrating TO', stackOptions, from === 'dotnet' ? 'node' : 'dotnet') : 'dotnet'));
    const legacyPath = flags['legacy-path'] || (interactive ? await ask('Folder that holds the old system (relative path)', 'legacy') : 'legacy');
    migration = { from, to, legacyPath: legacyPath.replace(/[\\/]+$/, '') };
    stack = to;
  } else {
    stack = normStack(flags.stack || (interactive ? await select('Main stack', stackOptions, detected || 'node') : detected || 'node'));
  }

  // 3. Strictness
  const strictness =
    flags.strictness ||
    (interactive
      ? await select('Strictness', [
          { label: 'Light', value: 'light', hint: 'RFC approval enforced; tests/docs only warn' },
          { label: 'Standard', value: 'standard', hint: 'recommended — approval, tests, specs and change records enforced; fast-track allowed' },
          { label: 'Strict', value: 'strict', hint: 'no fast-track; edits outside RFC scope are blocked' },
        ], 'standard')
      : 'standard');
  if (!['light', 'standard', 'strict'].includes(strictness)) throw new Error(`Unknown strictness "${strictness}".`);

  // 4. Test command
  const defTest = scopeDir ? `cd ${scopeDir} && ${STACKS[stack].testCommand}` : STACKS[stack].testCommand;
  const testCommand = flags['test-command'] || (interactive ? await ask('Command that runs the tests', defTest) : defTest);

  // 5. Tracker + auth (changeable later with `devrailsv2 auth`)
  const tracker = await configureTracker(root, flags);

  // 6. Approvers
  const me = gitUser(root);
  const defApprovers = [me.email].filter(Boolean).join(', ');
  const approversRaw =
    flags.approvers ??
    (interactive
      ? await ask('Who may approve RFCs? GitHub usernames and/or git emails, comma-separated', defApprovers)
      : defApprovers);
  const approvers = String(approversRaw === true ? '' : approversRaw).split(',').map((s) => s.trim()).filter(Boolean);
  const defOwner = me.name || approvers[0] || '';
  const decisionOwner =
    (flags['decision-owner'] && flags['decision-owner'] !== true ? flags['decision-owner'] : '') ||
    (interactive ? await ask('Default decision owner for RFCs (name or role)', defOwner) : defOwner);

  // 7. CodeSlice (code structure and change impact over MCP; C# only for now)
  const supported = codesliceSupported({ stack, migration });
  const codesliceVersion = supported ? codesliceInstalled() : null;
  let codeslice = false;
  if (!supported) codeslice = false;
  else if (flags.codeslice !== undefined) codeslice = flags.codeslice !== 'false';
  else if (flags['no-codeslice']) codeslice = false;
  else if (interactive) {
    codeslice = await confirm(
      `Connect CodeSlice (code structure and change impact for the agent)?${codesliceVersion ? c.dim(` found ${codesliceVersion}`) : c.dim(` not installed: ${INSTALL_HINT}`)}`,
      !!codesliceVersion,
    );
  }

  const paths = {
    ...(scopeDir ? { scope: [scopeDir] } : {}),
    src: prefixGlobs(STACKS[stack].src, scopeDir),
    tests: prefixGlobs(STACKS[stack].tests, scopeDir),
    cosmetic: [...DEFAULT_COSMETIC],
    docs: [...DEFAULT_DOCS],
    docsExclude: [...DEFAULT_DOCS_EXCLUDE],
    noRfc: [...DEFAULT_NO_RFC],
  };
  if (migration) {
    paths.legacy = [`${migration.legacyPath}/**`];
    for (const t of STACKS[migration.from]?.tests ?? []) if (!paths.tests.includes(t)) paths.tests.push(t);
  }

  const cfg = {
    $schema: 'devrailsv2/config@1',
    project: flags.name || path.basename(root),
    mode,
    stack,
    migration,
    strictness,
    testCommand,
    paths,
    tracker,
    approval: {
      require: flags['approval-require'] || 'either', // either | both | label | file
      prLabel: flags['pr-label'] || 'rfc-approved',
      approvers,
      decisionOwner,
    },
    setupRfc: `${new Date().getFullYear()}-000`,
    codeslice: { enabled: codeslice },
    models: { ...defaultModelsConfig(), enabled: !flags['no-models'] },
    fastTrack: { ...DEFAULT_FAST_TRACK, forbidden: [...DEFAULT_FAST_TRACK.forbidden] },
    created: new Date().toISOString().slice(0, 10),
  };

  console.log(`\n${c.bold('Summary')}`);
  console.log(`  mode        ${mode}${migration ? ` (${migration.from} → ${migration.to}, old code in ${migration.legacyPath}/)` : ''}`);
  console.log(`  scope       ${scopeDir ? `${scopeDir}/ only (the rest of the repo is not gated)` : 'whole repository'}`);
  console.log(`  stack       ${STACKS[stack].label}`);
  console.log(`  strictness  ${strictness}`);
  console.log(`  tests       ${testCommand}`);
  console.log(`  tracker     ${describeTracker(tracker)}`);
  console.log(`  approvers   ${approvers.join(', ') || c.yellow('none — approval author will not be verified in CI')}`);
  console.log(`  decision    default decision owner: ${decisionOwner || '(not set)'}`);
  console.log(`  codeslice   ${codeslice ? `enabled${codesliceVersion ? '' : c.yellow(' (not installed yet, see README → CodeSlice)')}` : supported ? 'off (enable later with `devrailsv2 codeslice enable`)' : 'not available for this stack yet (C# only)'}`);
  console.log(`  approval    RFC file status or PR label "${cfg.approval.prLabel}" (require: ${cfg.approval.require})\n`);

  if (interactive && !(await confirm('Generate the files?', true))) {
    log.warn('Cancelled, nothing written.');
    return 1;
  }
  if (flags['dry-run']) {
    printActions(generate(root, cfg, { dryRun: true, initial: true, force: !!flags.force }), log);
    log.warn('Dry run: nothing was written.');
    return 0;
  }

  if (!isGitRepo(root) && !flags['no-git']) {
    git(['init', '-b', 'main'], root);
    log.ok('Initialised a git repository (branch main)');
  }
  saveConfig(root, cfg);
  const actions = generate(root, cfg, { initial: true, force: !!flags.force });
  saveState(root, { activeRfc: cfg.setupRfc });
  printActions(actions, log);

  if (isGitRepo(root)) {
    git(['config', 'core.hooksPath', '.githooks'], root);
    log.ok('Git hooks enabled (core.hooksPath = .githooks)');
  }
  if (tracker.provider !== 'none') await testAuth(cfg);

  console.log(`
${c.bold('Next steps')}
  1. Review AGENTS.md (main instructions) and adjust the house rules to taste.
  2. Commit the setup:   git add -A && git commit -m "RFC-${cfg.setupRfc}: adopt devrailsv2"
  3. On GitHub: protect main (require PRs + the "devrailsv2" check) and create the "${cfg.approval.prLabel}" label.
  4. Start work:         ${CLI} ticket <id>   or   /rails-ticket <id> in Claude Code
`);
  return 0;
}
