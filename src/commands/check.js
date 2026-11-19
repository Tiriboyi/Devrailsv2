import fs from 'node:fs';
import path from 'node:path';
import { findRoot, read, gitLines, git, toPosix, matchAny, log, c } from '../util.js';
import { loadConfig, getActiveRfcId, inScope, scopeOf, noRfcGlobs } from '../config.js';
import { evaluate, changedFiles, ciContext, detectBase, rfcIdsFrom, commitMessageProblem } from '../gate.js';
import { lineStats } from '../fasttrack.js';

function report(res, { quiet = false, title }) {
  if (!quiet) console.log(c.bold(title));
  if (!quiet) for (const n of res.notes) log.ok(n);
  for (const w of res.warnings) log.warn(w);
  for (const e of res.errors) log.err(e);
  if (res.errors.length) console.log(c.red(`\n${res.errors.length} problem(s) — see AGENTS.md for the workflow.`));
  else if (!quiet) console.log(c.green(`\nGate passed${res.warnings.length ? ` with ${res.warnings.length} warning(s)` : ''}.`));
}

export default async function check({ flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);

  if (flags['prepare-msg']) {
    // prepare-commit-msg: put the active RFC id in front of the message, so `git commit -m "fix color"` just works.
    const file = path.resolve(root, String(flags['prepare-msg']));
    const source = flags.source && flags.source !== true ? String(flags.source) : '';
    if (['merge', 'squash', 'commit'].includes(source)) return 0;
    const active = getActiveRfcId(root);
    if (!active || /^\d{4}-0+$/.test(active)) return 0;
    const msg = read(file);
    const first = msg.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '';
    if (/^RFC-\d{4}-\d{3,4}\b/i.test(first) || /^(Merge|Revert|fixup!|squash!|amend!)/.test(first)) return 0;
    if (scopeOf(cfg).length) {
      const staged = gitLines(['diff', '--cached', '--name-only'], root).map(toPosix);
      if (staged.length && !staged.some((f) => inScope(cfg, f))) return 0;
    }
    fs.writeFileSync(file, first ? msg.replace(first, `RFC-${active}: ${first}`) : `RFC-${active}: \n${msg}`);
    return 0;
  }

  if (flags['commit-msg']) {
    const file = path.resolve(root, String(flags['commit-msg']));
    const stagedFiles = gitLines(['diff', '--cached', '--name-only'], root).map(toPosix);
    if (stagedFiles.length && stagedFiles.every((f) => matchAny(f, noRfcGlobs(cfg)))) return 0; // e.g. a .gitignore-only commit
    if (scopeOf(cfg).length) {
      const staged = gitLines(['diff', '--cached', '--name-only'], root).map(toPosix);
      if (staged.length && !staged.some((f) => inScope(cfg, f))) return 0; // e.g. a UI-only commit
    }
    const problem = commitMessageProblem(root, read(file));
    if (problem) {
      log.err(`devrailsv2: ${problem}`);
      return 1;
    }
    return 0;
  }

  if (flags.staged) {
    const files = gitLines(['diff', '--cached', '--name-only'], root).map(toPosix);
    const active = getActiveRfcId(root);
    const res = await evaluate(root, cfg, { files, rfcIds: active ? [active] : [], phase: 'commit', stats: lineStats(root, { staged: true }) });
    report(res, { quiet: true, title: 'devrailsv2 pre-commit' });
    return res.errors.length ? 1 : 0;
  }

  if (flags.ci) {
    const ctx = ciContext(root);
    const base = flags.base && flags.base !== true ? flags.base : ctx.base;
    if (!base) throw new Error('Cannot determine the base branch. Pass --base origin/main.');
    const files = changedFiles(root, base, { includeWorking: false });
    const mb = git(['merge-base', base, 'HEAD'], root).stdout;
    const commits = mb ? gitLines(['log', '--format=%s', `${mb}..HEAD`], root) : [];
    const rfcIds = rfcIdsFrom(ctx.head, ctx.title, ...commits);
    console.log(c.dim(`base ${base} · ${files.length} file(s) · RFCs: ${rfcIds.map((i) => `RFC-${i}`).join(', ') || 'none'}`));
    const res = await evaluate(root, cfg, { files, rfcIds, phase: 'ci', ctx, stats: lineStats(root, { base }) });
    report(res, { title: 'devrailsv2 pull-request gate' });
    return res.errors.length ? 1 : 0;
  }

  // Local full check: branch changes + uncommitted work
  const base = flags.base && flags.base !== true ? flags.base : detectBase(root);
  const files = changedFiles(root, base);
  const active = getActiveRfcId(root);
  const mb = base ? git(['merge-base', base, 'HEAD'], root).stdout : '';
  const commits = mb ? gitLines(['log', '--format=%s', `${mb}..HEAD`], root) : [];
  const rfcIds = [...new Set([...(active ? [active] : []), ...rfcIdsFrom(...commits)])];
  console.log(c.dim(`base ${base || '(none)'} · ${files.length} changed file(s) · RFCs: ${rfcIds.map((i) => `RFC-${i}`).join(', ') || 'none'}`));
  const res = await evaluate(root, cfg, { files, rfcIds, phase: 'local', stats: lineStats(root, { base, includeWorking: true }) });
  report(res, { title: 'devrailsv2 check' });
  return res.errors.length ? 1 : 0;
}
