import path from 'node:path';
import { findRoot, read, gitLines, git, toPosix, log, c } from '../util.js';
import { loadConfig, getActiveRfcId } from '../config.js';
import { evaluate, changedFiles, ciContext, detectBase, rfcIdsFrom, commitMessageProblem } from '../gate.js';

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

  if (flags['commit-msg']) {
    const file = path.resolve(root, String(flags['commit-msg']));
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
    const res = await evaluate(root, cfg, { files, rfcIds: active ? [active] : [], phase: 'commit' });
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
    const res = await evaluate(root, cfg, { files, rfcIds, phase: 'ci', ctx });
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
  const res = await evaluate(root, cfg, { files, rfcIds, phase: 'local' });
  report(res, { title: 'devrailsv2 check' });
  return res.errors.length ? 1 : 0;
}
