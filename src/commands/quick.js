// `devrailsv2 quick`: a fast-track RFC for small cosmetic or housekeeping changes, pre-filled in the RFC format.
import path from 'node:path';
import { findRoot, write, read, template, today, slugify, git, gitUser, isGitRepo, log, c, ask, CLI } from '../util.js';
import { loadConfig } from '../config.js';
import { getRfc, nextRfcKey, lintRfc, resolveRfcKey, RFC_DIR } from '../docs.js';
import { yamlScalar } from '../frontmatter.js';
import { fastTrackRfcProblems } from '../fasttrack.js';
import { assertHuman, warnIfNotApprover, approvedText, startRfc, printLint } from './rfc.js';

const str = (v) => (v && v !== true ? String(v) : '');

export default async function quick({ pos, flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  if (cfg.strictness === 'strict') throw new Error('Fast-track changes are disabled in strict mode. Use `devrailsv2 rfc new`.');
  const title = pos.join(' ') || str(flags.title);
  const affects = str(flags.affects).split(',').map((s) => s.trim()).filter(Boolean);
  if (!title || !affects.length) {
    throw new Error('Usage: devrailsv2 quick "<title>" --affects "<files or globs>" [--request "…"] [--outcome "…"] [--verify "…"] [--criterion "…"] [--ticket GH#12] [--approve]');
  }
  if (flags.approve) assertHuman('quick --approve');

  const key = nextRfcKey(root);
  const u = gitUser(root);
  const author = u.name || u.email || 'unknown';
  const ticket = str(flags.ticket);
  const request = str(flags.request) || '<request>';
  const criteria = (Array.isArray(flags.criterion) ? flags.criterion : [str(flags.criterion)]).filter(Boolean);
  const rel = `${RFC_DIR}/RFC-${key}-${slugify(title)}.md`;
  write(
    path.join(root, rel),
    template('docs/rfc-quick.md', {
      key,
      title,
      titleYaml: yamlScalar(title),
      requestedBy: yamlScalar(str(flags['requested-by']) || author),
      decisionOwner: yamlScalar(str(flags['decision-owner']) || cfg.approval.decisionOwner || cfg.approval.approvers?.[0] || author),
      affected: yamlScalar(affects),
      date: today(),
      author,
      request: ticket ? `${request}\n\nTicket: ${ticket}` : request,
      sources: [ticket, ...affects.map((a) => `\`${a}\``)].filter(Boolean).join(', '),
      outcome: str(flags.outcome) || '<desired outcome>',
      criteria: criteria.length
        ? criteria.map((t, i) => `- [ ] AC-${i + 1}: ${t}`).join('\n')
        : '_None: fast-track change, checked as described in the Verification Plan._',
      verify: str(flags.verify) || '<verification plan>',
    }),
  );
  log.ok(`Drafted fast-track RFC-${key}: ${title} → ${rel}`);
  let r = getRfc(root, key);
  const { warnings, errors } = lintRfc(r);
  const ftProblems = fastTrackRfcProblems(root, cfg, r);
  if (ftProblems.length) {
    for (const p of ftProblems) log.err(p);
    log.warn(`The draft stays in ${rel}, but it cannot be approved as fast-track like this.`);
    return 1;
  }

  if (!flags.approve) {
    if (warnings.length || errors.length) log.info(`Before approval: ${[...errors, ...warnings].join(' ')}`);
    log.info(`Then a human approves and starts it in one go:\n  ${CLI} rfc approve ${key} && ${CLI} rfc start ${key}`);
    return 0;
  }

  // Human path: approve, start the branch and commit the approval in one go.
  console.log(`\n${c.bold(`RFC-${key}: ${title}`)}  ${c.dim(`(fast-track, affects ${affects.join(', ')})`)}`);
  printLint(r, root, cfg);
  if (errors.length || warnings.length) {
    log.warn('Not approved: fill in the RFC first (or pass --request, --outcome and --verify), then run `rfc approve`.');
    return 1;
  }
  const who = warnIfNotApprover(root, cfg);
  const typed = (await ask(`Type ${key} to approve it`)).replace(/^RFC-/i, '');
  if (resolveRfcKey(root, typed || 'x') !== key) {
    log.warn(`Not confirmed. The draft stays in ${rel}.`);
    return 1;
  }
  write(r.absPath, approvedText(read(r.absPath), who, 'Approved (fast-track)'));
  r = getRfc(root, key);
  startRfc(root, r, flags);
  if (isGitRepo(root)) {
    git(['add', '--', rel], root);
    const res = git(['commit', '-q', '-m', `RFC-${key}: approve fast-track`, '--', rel], root);
    if (res.ok) log.ok('Committed the approved RFC (attributed to you)');
    else log.warn(`Could not commit the RFC (${res.stderr || res.stdout}). Commit it yourself: git commit -m "RFC-${key}: approve" -- ${rel}`);
  }
  log.info(`Make the change, then: ${CLI} done --run-tests && ${CLI} check`);
  return 0;
}
