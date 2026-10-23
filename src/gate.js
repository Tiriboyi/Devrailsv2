// The rules engine shared by `check`, the git hooks, CI and the Claude hook.
import { git, gitLines, matchAny, matchAffects, toPosix, exists, readJson, isGitRepo } from './util.js';
import { FREE_PATHS } from './config.js';
import { getRfc, getSpec, getChangeRecord, acCoverage, lintRfc, normalizeRfc, isSetupKey, pad3 } from './docs.js';
import { splitFrontmatter } from './frontmatter.js';
import { ghHeaders, githubApi } from './commands/auth.js';

export function classify(cfg, file) {
  const f = toPosix(file);
  if (matchAny(f, FREE_PATHS)) return 'free';
  if (matchAny(f, cfg.paths.tests)) return 'test';
  if (cfg.paths.legacy && matchAny(f, cfg.paths.legacy)) return 'legacy';
  if (matchAny(f, cfg.paths.src)) return 'src';
  if (/^(\.rails|\.github|\.claude|\.githooks)\//.test(f)) return 'tooling';
  if (f.startsWith('docs/') || /\.md$/i.test(f)) return 'docs';
  return 'other'; // config, manifests, dependencies, infrastructure
}

/** RFC keys ("2026-001") referenced in branch names, PR titles and commit messages. */
export function rfcIdsFrom(...texts) {
  const ids = new Set();
  for (const t of texts.filter(Boolean)) {
    for (const m of String(t).matchAll(/(?:^|[^\w])RFC-(\d{4})-(\d{3,4})\b/gi)) ids.add(`${m[1]}-${pad3(parseInt(m[2], 10))}`);
    for (const m of String(t).matchAll(/(?:^|\/)rfc\/(\d{4})-(\d{3,4})\b/gi)) ids.add(`${m[1]}-${pad3(parseInt(m[2], 10))}`);
  }
  return [...ids].sort();
}

export function detectBase(root) {
  for (const b of ['origin/main', 'origin/master', 'main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', b], root).ok) return b;
  }
  return null;
}

/** Files changed on this branch vs base, plus uncommitted and untracked work. */
export function changedFiles(root, base, { includeWorking = true } = {}) {
  const files = new Set();
  if (!isGitRepo(root)) return [];
  if (base) {
    const mb = git(['merge-base', base, 'HEAD'], root).stdout;
    if (mb) gitLines(['diff', '--name-only', `${mb}..HEAD`], root).forEach((f) => files.add(f));
  }
  if (includeWorking) {
    gitLines(['diff', '--name-only', 'HEAD'], root).forEach((f) => files.add(f));
    gitLines(['diff', '--name-only', '--cached'], root).forEach((f) => files.add(f));
    gitLines(['ls-files', '--others', '--exclude-standard'], root).forEach((f) => files.add(f));
  }
  return [...files].map(toPosix).sort();
}

export function ciContext(root) {
  const ctx = { provider: null, base: null, head: '', title: '', labels: [], pr: null, repo: process.env.GITHUB_REPOSITORY || '' };
  if (process.env.GITHUB_ACTIONS) {
    ctx.provider = 'github';
    const ev = process.env.GITHUB_EVENT_PATH ? readJson(process.env.GITHUB_EVENT_PATH, {}) : {};
    const pr = ev.pull_request;
    if (pr) {
      ctx.pr = { number: pr.number };
      ctx.title = pr.title || '';
      ctx.labels = (pr.labels || []).map((l) => l.name);
      ctx.head = pr.head?.ref || '';
    }
    if (process.env.GITHUB_BASE_REF) ctx.base = `origin/${process.env.GITHUB_BASE_REF}`;
    ctx.head ||= process.env.GITHUB_HEAD_REF || '';
  } else if (process.env.TF_BUILD) {
    ctx.provider = 'azure';
    const tgt = process.env.SYSTEM_PULLREQUEST_TARGETBRANCH || '';
    if (tgt) ctx.base = `origin/${tgt.replace(/^refs\/heads\//, '')}`;
    ctx.head = (process.env.SYSTEM_PULLREQUEST_SOURCEBRANCH || process.env.BUILD_SOURCEBRANCH || '').replace(/^refs\/heads\//, '');
  }
  ctx.base ||= detectBase(root);
  return ctx;
}

const same = (a, b) => a && b && String(a).toLowerCase() === String(b).toLowerCase();
const isApprovedText = (t) => String(splitFrontmatter(t).fm?.status || '').toLowerCase() === 'approved';

/** The most recent commit that set `status: approved` on this RFC. */
export function approvalCommit(root, relPath) {
  for (const line of gitLines(['log', '--format=%H|%an|%ae', '-G', '^status: *[Aa]pproved', '--', relPath], root)) {
    const [hash, an, ae] = line.split('|');
    const show = git(['show', `${hash}:${relPath}`], root);
    if (show.ok && isApprovedText(show.stdout)) return { hash, an, ae, text: show.stdout };
  }
  return null;
}

/** File approval: status approved; in CI also verify who approved and that the content has not changed since. */
export function fileApproval(root, cfg, rfc, { verifyAuthor }) {
  if (rfc.status !== 'approved') return { ok: false, reason: `status is "${rfc.status}"` };
  if (!rfc.approvedBy) return { ok: false, reason: 'approved_by is empty' };
  if (!verifyAuthor) return { ok: true };
  const approvers = cfg.approval.approvers || [];
  const isApprover = (an, ae) => approvers.some((a) => same(a, an) || same(a, ae));
  const ac = approvalCommit(root, rfc.relPath);
  if (!ac) return { ok: false, reason: 'cannot find the commit that approved it (CI needs fetch-depth: 0)' };
  let warn;
  if (!approvers.length) warn = 'approval.approvers is empty, so who approved it was not verified';
  else if (!isApprover(ac.an, ac.ae)) return { ok: false, reason: `approved in a commit by ${ac.an} <${ac.ae}>, who is not in approval.approvers` };
  if (normalizeRfc(ac.text) !== normalizeRfc(rfc.text)) {
    const later = gitLines(['log', '--format=%an|%ae', `${ac.hash}..HEAD`, '--', rfc.relPath], root).map((l) => l.split('|'));
    const byApprovers = approvers.length && later.length && later.every(([an, ae]) => isApprover(an, ae));
    if (!byApprovers) return { ok: false, reason: 'its content changed after approval — set status back to draft and re-approve' };
  }
  return { ok: true, by: ac.ae || ac.an, warn };
}

/** Label approval on a GitHub PR, verifying who applied the label. */
export async function labelApproval(cfg, ctx) {
  const label = cfg.approval.prLabel;
  if (ctx.provider !== 'github' || !ctx.pr) return { ok: false, reason: 'PR labels are only checked on GitHub pull requests' };
  if (!ctx.labels.includes(label)) return { ok: false, reason: `PR has no "${label}" label` };
  const approvers = cfg.approval.approvers || [];
  if (!approvers.length) return { ok: true, warn: `label "${label}" present but approval.approvers is empty, so who added it was not verified` };
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, reason: 'GITHUB_TOKEN missing; cannot verify who added the label' };
  try {
    const api = process.env.GITHUB_API_URL || githubApi(cfg.tracker?.github);
    const res = await fetch(`${api}/repos/${ctx.repo}/issues/${ctx.pr.number}/events?per_page=100`, { headers: ghHeaders(token) });
    if (!res.ok) return { ok: false, reason: `GitHub API ${res.status} while reading label events` };
    const events = (await res.json()).filter((e) => e.event === 'labeled' && e.label?.name === label);
    const actor = events.at(-1)?.actor?.login;
    if (actor && approvers.some((a) => same(a, actor))) return { ok: true, by: actor };
    return { ok: false, reason: `label "${label}" was added by ${actor || 'unknown'}, who is not in approval.approvers` };
  } catch (e) {
    return { ok: false, reason: `could not verify label: ${e.message}` };
  }
}

/**
 * phase: 'commit' (pre-commit) | 'local' (devrailsv2 check) | 'ci' (pull request gate)
 */
export async function evaluate(root, cfg, { files, rfcIds, phase, ctx = {} }) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const light = cfg.strictness === 'light';
  const strict = cfg.strictness === 'strict';
  const soft = (m) => (light ? warnings : errors).push(m); // enforced in standard/strict, warning in light
  const warn = (m) => warnings.push(m);

  const groups = { free: [], test: [], src: [], legacy: [], other: [], tooling: [], docs: [] };
  for (const f of files) groups[classify(cfg, f)].push(f);
  const gated = files.filter((f) => classify(cfg, f) !== 'free');

  if (!files.length) {
    notes.push('No changes found.');
    return { errors, warnings, notes, groups };
  }
  if (!gated.length) {
    notes.push('Only RFC/spec/analysis/ADR documents changed — no approved RFC needed.');
    return { errors, warnings, notes, groups };
  }
  if (!rfcIds.length) {
    errors.push('Changes found but no RFC is referenced. Work on an rfc/<yyyy>-<nnn>-* branch (`devrailsv2 rfc start <id>`) and prefix commits with RFC-<yyyy>-<nnn>.');
    return { errors, warnings, notes, groups };
  }

  const require = cfg.approval.require || 'either';
  const codeChanged = groups.src.length + groups.legacy.length > 0;
  let allAffects = [];
  let anyExemption = null;
  let bootstrapOnly = true;

  for (const key of rfcIds) {
    const rfc = getRfc(root, key);
    if (!rfc) {
      errors.push(`RFC-${key} is referenced but docs/rfc/RFC-${key}-*.md does not exist.`);
      continue;
    }
    const setup = isSetupKey(key);
    if (!setup) bootstrapOnly = false;

    // --- approval ---
    const f = fileApproval(root, cfg, rfc, { verifyAuthor: phase === 'ci' });
    const l = phase === 'ci' ? await labelApproval(cfg, ctx) : null;
    let approved;
    if (phase !== 'ci') {
      approved = f.ok;
      if (require === 'label' && f.ok) notes.push(`RFC-${key}: CI will additionally require the "${cfg.approval.prLabel}" PR label.`);
    } else if (require === 'both') approved = f.ok && l?.ok;
    else if (require === 'label') approved = !!l?.ok;
    else if (require === 'file') approved = f.ok;
    else approved = f.ok || !!l?.ok;
    for (const x of [f, l]) if (x?.warn) warn(`RFC-${key}: ${x.warn}.`);
    if (!approved) {
      const reasons = [f.reason && `file: ${f.reason}`, l?.reason && `label: ${l.reason}`].filter(Boolean).join('; ');
      errors.push(`RFC-${key} is not approved (${reasons}). A human must approve it before code changes.`);
    } else {
      notes.push(`RFC-${key} approved${f.by ? ` (file, by ${f.by})` : ''}${l?.ok && l.by ? ` (label, by ${l.by})` : ''}.`);
    }

    if (rfc.type === 'fast-track' && strict) errors.push(`RFC-${key} is fast-track, which strict mode does not allow.`);
    allAffects = allAffects.concat(rfc.affects);
    if (setup) {
      // The setup RFC only ever covers devrailsv2's own files.
      const outside = gated.filter((x) => !matchAffects(x, rfc.affects));
      if (outside.length && rfcIds.length === 1) {
        errors.push(`RFC-${key} only covers the devrailsv2 setup, not: ${outside.slice(0, 5).join(', ')}${outside.length > 5 ? '…' : ''}. Draft a new RFC for this change.`);
      }
      continue;
    }
    if (rfc.exemption) anyExemption = rfc.exemption;

    // --- RFC format ---
    if (phase !== 'commit') {
      const lint = lintRfc(rfc);
      for (const e of lint.errors) (phase === 'ci' ? soft : warn)(`RFC-${key}: ${e}`);
      for (const w of lint.warnings) warn(`RFC-${key}: ${w}`);
    }

    // --- spec (strict only) and acceptance-criteria coverage ---
    if (phase !== 'commit' && codeChanged) {
      if (strict && rfc.type !== 'fast-track' && !getSpec(root, key)) errors.push(`RFC-${key} has no spec (required in strict mode). Run \`devrailsv2 spec new --rfc ${key}\`.`);
      if (!rfc.exemption) {
        const cov = acCoverage(root, cfg, key);
        const sink = rfc.type === 'fast-track' ? warn : soft;
        if (!cov.rows.length) sink(`RFC-${key} has no numbered acceptance criteria ("- [ ] AC-1: …").`);
        else if (cov.missing.length) sink(`Acceptance criteria without a test referencing them: ${cov.missing.map((a) => `RFC-${key}:${a}`).join(', ')}.`);
        else notes.push(`All ${cov.rows.length} acceptance criteria of RFC-${key} have tests.`);
        if (cov.extra.length) warn(`SPEC-${key} uses ${cov.extra.join(', ')}, which are not in the approved RFC.`);
      }
    }

    // --- documentation of the change ---
    if (phase !== 'commit' && !getChangeRecord(root, key)) {
      (phase === 'ci' ? soft : warn)(`No change record for RFC-${key}. Run \`devrailsv2 done\` when the work is complete.`);
    }
  }

  // --- tests accompany code ---
  if (codeChanged && !bootstrapOnly) {
    if (anyExemption) warn(`Test exemption in use: "${anyExemption}".`);
    else if (!groups.test.length) {
      const changed = [...groups.src, ...groups.legacy];
      const msg = `Source changed (${changed.slice(0, 5).join(', ')}${changed.length > 5 ? '…' : ''}) but no tests changed. Add tests, or add test_exemption to the RFC frontmatter for a human to approve.`;
      if (phase === 'commit') warn(msg);
      else soft(msg);
    }
  }

  // --- scope ---
  if (!bootstrapOnly) {
    const scoped = [...groups.src, ...groups.legacy, ...groups.other];
    if (allAffects.length) {
      const outside = scoped.filter((x) => !matchAffects(x, allAffects));
      if (outside.length) (strict ? errors : warnings).push(`Changed outside the RFC's affected_areas: ${outside.join(', ')}.`);
    }
  }

  // --- changelog / status ---
  if (phase === 'ci' && !bootstrapOnly) {
    if (!files.includes('CHANGELOG.md')) soft('CHANGELOG.md was not updated (`devrailsv2 done` does this).');
    if (!files.includes('docs/STATUS.md')) warn('docs/STATUS.md was not updated.');
  }
  return { errors, warnings, notes, groups };
}

export function commitMessageProblem(root, message) {
  const first = message.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '';
  if (/^(Merge|Revert|fixup!|squash!|amend!)/.test(first)) return null;
  const m = first.match(/^RFC-(\d{4})-(\d{3,4})\b/i);
  if (!m) return `Commit message must start with the RFC id, e.g. "RFC-${new Date().getFullYear()}-007: add invoice export". Got: "${first}"`;
  const key = `${m[1]}-${pad3(parseInt(m[2], 10))}`;
  if (!exists(`${root}/docs/rfc`) || !getRfc(root, key)) return `RFC-${key} does not exist in docs/rfc/.`;
  return null;
}
