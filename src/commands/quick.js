// `devrailsv2 quick`: fast-track RFC for small changes.
//  - Without --affects it is a *micro* change: no file list, but the whole change must stay tiny (fastTrack.micro).
//  - A human in a terminal approves it on the spot; the RFC is staged and goes into the same commit as the change.
//  - The CHANGELOG line is written now; no change record is needed afterwards.
import path from 'node:path';
import { findRoot, write, read, exists, template, today, slugify, git, gitUser, isGitRepo, insertAfterMarker, log, c, confirm, CLI } from '../util.js';
import { loadConfig, fastTrackRules } from '../config.js';
import { getRfc, nextRfcKey, lintRfc, RFC_DIR } from '../docs.js';
import { yamlScalar } from '../frontmatter.js';
import { fastTrackRfcProblems } from '../fasttrack.js';
import { warnIfNotApprover, approvedText, startRfc, printLint } from './rfc.js';

const str = (v) => (v && v !== true ? String(v) : '');
export const isHumanTerminal = () => process.stdin.isTTY && !process.env.CLAUDECODE && !process.env.CI;

export function addChangelog(root, key, title, rel) {
  const p = path.join(root, 'CHANGELOG.md');
  if (!exists(p)) return null;
  const t = read(p);
  if (t.includes(`RFC-${key}`)) return null;
  write(p, insertAfterMarker(t, '<!-- devrailsv2:unreleased -->', `- RFC-${key}: ${title} (fast-track, [RFC](${rel}))`));
  return 'CHANGELOG.md';
}

export default async function quick({ pos, flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  if (cfg.strictness === 'strict') throw new Error('Fast-track changes are disabled in strict mode. Use `devrailsv2 rfc new`.');
  const title = pos.join(' ') || str(flags.title);
  if (!title) throw new Error('Usage: devrailsv2 quick "<what you change>" [--affects "<files>"] [--request "…"] [--outcome "…"] [--verify "…"] [--ticket GH#12] [--here]');
  const affects = str(flags.affects).split(',').map((s) => s.trim()).filter(Boolean);
  const micro = !affects.length;
  const rules = fastTrackRules(cfg);
  const human = isHumanTerminal();
  if (flags.approve && !human) throw new Error('`quick --approve` is a human action and must be run in an interactive terminal.');

  const key = nextRfcKey(root);
  const u = gitUser(root);
  const author = u.name || u.email || 'unknown';
  const ticket = str(flags.ticket);
  const request = str(flags.request) || title;
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
      sources: [ticket, ...affects.map((a) => `\`${a}\``)].filter(Boolean).join(', ') || 'the change itself (micro change)',
      outcome: str(flags.outcome) || title,
      criteria: criteria.length
        ? criteria.map((t, i) => `- [ ] AC-${i + 1}: ${t}`).join('\n')
        : '_None: fast-track change, checked as described in the Verification Plan._',
      verify:
        str(flags.verify) ||
        (micro
          ? `Micro change: at most ${rules.micro.maxLines} changed lines in at most ${rules.micro.maxFiles} files, enforced by the devrailsv2 gate. Reviewed in the pull request.`
          : 'Existing tests pass; change checked by hand and reviewed in the pull request.'),
    }),
  );
  let r = getRfc(root, key);
  const problems = fastTrackRfcProblems(root, cfg, r);
  if (problems.length) {
    for (const p of problems) log.err(p);
    log.warn(`The draft stays in ${rel}, but it cannot go fast-track like this.`);
    return 1;
  }
  log.ok(`Fast-track RFC-${key}: ${title}${micro ? c.dim(`  (micro: ≤ ${rules.micro.maxLines} lines, ≤ ${rules.micro.maxFiles} files in total)`) : ''}`);

  // Agents (and CI) only draft. A human approves.
  const approveNow = human && (flags.approve || flags.yes || (await confirm('Approve it now? (you are the approver)', true)));
  if (!approveNow) {
    if (isGitRepo(root)) git(['add', '--', rel], root);
    log.info(`Drafted ${rel}. A human approves it with:\n  ${CLI} rfc approve ${key}`);
    return 0;
  }

  const { errors } = lintRfc(r);
  if (errors.length) {
    printLint(r, root, cfg);
    return 1;
  }
  const who = warnIfNotApprover(root, cfg);
  write(r.absPath, approvedText(read(r.absPath), who, 'Approved (fast-track)'));
  r = getRfc(root, key);
  startRfc(root, r, { 'no-branch': !!flags.here });
  const staged = [rel, addChangelog(root, key, title, rel)].filter(Boolean);
  if (isGitRepo(root)) git(['add', '--', ...staged], root);

  console.log(`
${c.bold('Now:')} make the change, then commit and push as usual:
  git commit -am "${title.replace(/"/g, "'")}"    ${c.dim(`(RFC-${key}: is added to the message automatically)`)}
  git push
${c.dim(`The RFC and CHANGELOG line are staged and go into that same commit. No change record or separate approval commit needed.${micro ? ` Keep it within ${rules.micro.maxLines} lines / ${rules.micro.maxFiles} files, or add --affects for a larger fast-track.` : ''}`)}`);
  return 0;
}
