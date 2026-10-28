// Guards that keep fast-track RFCs small and away from sensitive areas.
import fs from 'node:fs';
import path from 'node:path';
import { matchAny, gitLines, toPosix } from './util.js';
import { fastTrackRules, cosmeticGlobs, LOCKFILES } from './config.js';

/** Problems with the RFC itself (checked before approval). */
export function fastTrackRfcProblems(root, cfg, rfc) {
  if (rfc.type !== 'fast-track') return [];
  const rules = fastTrackRules(cfg);
  const out = [];
  if (!rfc.affects.length) out.push('fast-track RFCs must list the exact files in affected_areas.');
  for (const a of rfc.affects) {
    const p = toPosix(String(a).trim());
    if (p.includes('**')) out.push(`affected_areas entry "${p}" uses **; fast-track RFCs must list exact files (or a * pattern inside one folder).`);
    else if (!/[*?]/.test(p) && fs.existsSync(path.join(root, p)) && fs.statSync(path.join(root, p)).isDirectory()) {
      out.push(`affected_areas entry "${p}" is a whole folder; list the files.`);
    }
    if (matchAny(p.replace(/\*+/g, 'x'), rules.forbidden)) {
      out.push(`"${p}" is in a protected area (fastTrack.forbidden: auth, payments, migrations, CI, infrastructure…); use a regular RFC.`);
    }
  }
  if (rfc.affects.length > rules.maxFiles) out.push(`affected_areas lists ${rfc.affects.length} entries; fast-track allows at most ${rules.maxFiles}.`);
  return out;
}

/** Added + removed lines per file. `range` is a git diff range; null means staged changes. */
export function lineStats(root, { base = null, staged = false, includeWorking = false } = {}) {
  const stats = new Map();
  const add = (lines) => {
    for (const l of lines) {
      const [a, d, f] = l.split('\t');
      if (!f) continue;
      const file = toPosix(f.includes(' => ') ? f.replace(/\{?[^{]*? => ([^}]*)\}?/, '$1') : f);
      const n = (a === '-' ? 0 : +a) + (d === '-' ? 0 : +d);
      stats.set(file, (stats.get(file) || 0) + n);
    }
  };
  if (staged) add(gitLines(['diff', '--cached', '--numstat'], root));
  else {
    if (base) {
      const mb = gitLines(['merge-base', base, 'HEAD'], root)[0];
      if (mb) add(gitLines(['diff', '--numstat', `${mb}..HEAD`], root));
    }
    if (includeWorking) add(gitLines(['diff', '--numstat', 'HEAD'], root));
  }
  return stats;
}

/** Problems with the change made under fast-track RFCs (checked at commit and in CI). */
export function fastTrackChangeProblems(cfg, { files, stats, fastKeys, phase }) {
  const rules = fastTrackRules(cfg);
  const out = [];
  const gated = files.filter((f) => !/^docs\//.test(f) && f !== 'CHANGELOG.md');
  const forbidden = gated.filter((f) => matchAny(f, rules.forbidden));
  if (forbidden.length) out.push(`Fast-track may not touch protected areas: ${forbidden.join(', ')}. Use a regular RFC.`);
  if (gated.length > rules.maxFiles) out.push(`Fast-track change touches ${gated.length} files; the limit is ${rules.maxFiles}. Use a regular RFC.`);
  if (stats) {
    const counted = gated.filter((f) => !matchAny(f, cosmeticGlobs(cfg)) && !matchAny(f, LOCKFILES));
    const lines = counted.reduce((n, f) => n + (stats.get(f) || 0), 0);
    if (lines > rules.maxLines) out.push(`Fast-track change is ${lines} lines (added + removed, excluding styles, assets, docs and lockfiles); the limit is ${rules.maxLines}. Use a regular RFC.`);
  }
  if (phase === 'ci' && rules.onePerPullRequest && fastKeys.length > 1) {
    out.push(`This pull request uses ${fastKeys.length} fast-track RFCs (${fastKeys.map((k) => `RFC-${k}`).join(', ')}); only one is allowed per pull request. Combine them in one RFC or split the PR.`);
  }
  return out;
}
