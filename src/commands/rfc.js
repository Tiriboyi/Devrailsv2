import path from 'node:path';
import {
  findRoot, write, read, template, today, slugify, git, gitUser, isGitRepo, currentBranch, log, c, ask, CLI,
} from '../util.js';
import { loadConfig, loadState, saveState, getActiveRfcId } from '../config.js';
import { listRfcs, getRfc, nextRfcKey, lintRfc, appendHistory, isSetupKey, resolveRfcKey, RFC_DIR } from '../docs.js';
import { setFields, yamlScalar } from '../frontmatter.js';

const STATUS_COLOR = { approved: c.green, draft: c.yellow, rejected: c.red, superseded: c.dim };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function printLint(rfc) {
  const { errors, warnings } = lintRfc(rfc);
  for (const e of errors) log.err(e);
  for (const w of warnings) log.warn(w);
  if (!errors.length && !warnings.length) log.ok(`${rfc.id} is complete.`);
  return { errors, warnings };
}

export default async function rfc({ pos, flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  const sub = pos[0] || 'list';
  const str = (k) => (flags[k] && flags[k] !== true ? String(flags[k]) : '');

  if (sub === 'new') {
    const title = pos.slice(1).join(' ') || str('title') || (process.stdin.isTTY ? await ask('RFC title') : '');
    if (!title) throw new Error('Usage: devrailsv2 rfc new "<title>" [--ticket GH#12] [--affects "src/billing/**"] [--fast-track]');
    const fast = !!flags['fast-track'];
    if (fast && cfg.strictness === 'strict') throw new Error('Fast-track RFCs are disabled in strict mode.');
    const key = nextRfcKey(root);
    const u = gitUser(root);
    const author = u.name || u.email || 'unknown';
    const requestedBy = str('requested-by') || author;
    const decisionOwner = str('decision-owner') || cfg.approval.decisionOwner || cfg.approval.approvers?.[0] || requestedBy;
    const ticket = str('ticket');
    const affects = str('affects').split(',').map((s) => s.trim()).filter(Boolean);
    const rel = `${RFC_DIR}/RFC-${key}-${slugify(title)}.md`;
    write(
      path.join(root, rel),
      template('docs/rfc.md', {
        key,
        title,
        titleYaml: yamlScalar(title),
        type: fast ? 'fast-track' : 'change',
        requestedBy: yamlScalar(requestedBy),
        decisionOwner: yamlScalar(decisionOwner),
        affected: yamlScalar(affects),
        date: today(),
        author,
        request: ticket ? `<request>\n\nTicket: ${ticket}` : '<request>',
        sources: ticket ? `${ticket}; <sources>` : '<sources>',
      }),
    );
    log.ok(`Drafted RFC-${key}: ${title} → ${rel}`);
    log.info(`Fill in every section, check it with \`${CLI} rfc lint ${key}\`, then a human approves it:
  ${CLI} rfc approve ${key}   (or the "${cfg.approval.prLabel}" PR label)`);
    return 0;
  }

  if (sub === 'list') {
    const all = listRfcs(root);
    if (!all.length) return log.info('No RFCs yet. Create one with `devrailsv2 rfc new "<title>"`.'), 0;
    const active = getActiveRfcId(root);
    for (const r of all) {
      const col = STATUS_COLOR[r.status] || ((s) => s);
      console.log(`${r.key === active ? c.cyan('▶') : ' '} RFC-${r.key}  ${col(cap(r.status).padEnd(10))} ${r.type === 'fast-track' ? c.dim('[fast] ') : ''}${r.title}`);
    }
    return 0;
  }

  const ref = pos[1] || (['show', 'lint'].includes(sub) ? getActiveRfcId(root) : null);
  if (!ref) throw new Error(`Usage: devrailsv2 rfc ${sub} <id>`);
  const r = getRfc(root, ref);
  if (!r) throw new Error(`RFC-${resolveRfcKey(root, ref)} not found in ${RFC_DIR}/.`);

  if (sub === 'show') {
    console.log(r.text);
    return 0;
  }

  if (sub === 'lint') {
    console.log(c.bold(`${r.id}: ${r.title}`));
    return printLint(r).errors.length ? 1 : 0;
  }

  if (sub === 'start') {
    if (r.status !== 'approved') throw new Error(`RFC-${r.key} is "${r.status}". Only approved RFCs can be started.`);
    saveState(root, { ...loadState(root), activeRfc: r.key });
    log.ok(`Active RFC: RFC-${r.key} ${r.title}`);
    if (isGitRepo(root) && !isSetupKey(r.key) && !flags['no-branch']) {
      const branch = `rfc/${r.key}-${r.slug}`.slice(0, 80);
      if (currentBranch(root) === branch) log.info(`Already on ${branch}`);
      else {
        const exists = git(['rev-parse', '--verify', '--quiet', branch], root).ok;
        const res = git(exists ? ['checkout', branch] : ['checkout', '-b', branch], root);
        if (res.ok) log.ok(`${exists ? 'Switched to' : 'Created'} branch ${branch}`);
        else log.warn(`Could not switch branch (${res.stderr}). Commit or stash first, then: git checkout -b ${branch}`);
      }
    }
    if (!isSetupKey(r.key)) log.info(`Next: failing tests for each acceptance criterion (reference them as RFC-${r.key}:AC-1). Optional detail: ${CLI} spec new`);
    return 0;
  }

  if (sub === 'approve' || sub === 'reject') {
    // Deliberately interactive: agents run without a TTY, and the Claude hook blocks this command.
    if (!process.stdin.isTTY || process.env.CLAUDECODE || process.env.CI) {
      throw new Error(`\`rfc ${sub}\` is a human action and must be run in an interactive terminal.`);
    }
    const u = gitUser(root);
    const who = u.display || u.name || 'unknown';
    const approvers = cfg.approval.approvers || [];
    if (approvers.length && !approvers.some((a) => [u.email, u.name].map((x) => x?.toLowerCase()).includes(a.toLowerCase()))) {
      log.warn(`Your git identity (${who}) is not in approval.approvers; CI will reject this ${sub === 'approve' ? 'approval' : 'decision'}.`);
    }
    console.log(`\n${c.bold(`RFC-${r.key}: ${r.title}`)}  (currently ${r.status}, decision owner: ${r.decisionOwner || 'not set'})`);
    if (sub === 'approve') {
      const { errors, warnings } = printLint(r);
      if (errors.length || warnings.length) console.log(c.yellow('Approving freezes the RFC as it is now.'));
    }
    const reason = sub === 'reject' ? str('reason') || (await ask('Reason (recorded in Change History)', '')) : '';
    const typed = (await ask(`Type ${r.key} to ${sub} it`)).replace(/^RFC-/i, '');
    if (resolveRfcKey(root, typed || 'x') !== r.key) {
      log.warn('Not confirmed, nothing changed.');
      return 1;
    }
    let text = read(r.absPath);
    if (sub === 'approve') {
      text = setFields(text, { status: 'approved', approved_by: who, approved_on: today(), updated: today() });
      text = appendHistory(text, today(), who, 'Approved');
    } else {
      text = setFields(text, { status: 'rejected', updated: today() });
      text = appendHistory(text, today(), who, reason ? `Rejected: ${reason}` : 'Rejected');
    }
    write(r.absPath, text);
    log.ok(`RFC-${r.key} ${sub === 'approve' ? 'approved' : 'rejected'}.`);
    log.info(`Commit it yourself so the decision is attributed to you:\n  git add ${r.relPath} && git commit -m "RFC-${r.key}: ${sub}"`);
    return 0;
  }

  throw new Error(`Unknown subcommand "rfc ${sub}". Use new | list | show | lint | start | approve | reject.`);
}
