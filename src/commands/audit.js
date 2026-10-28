// `devrailsv2 audit`: how fast-track is being used, so misuse is visible.
import { findRoot, gitLines, matchAny, log, c } from '../util.js';
import { loadConfig, fastTrackRules, cosmeticGlobs, LOCKFILES } from '../config.js';
import { listRfcs, isSetupKey } from '../docs.js';

function changeStats(root, cfg, key) {
  const files = new Map();
  let commit = null;
  for (const line of gitLines(['log', '--all', '--numstat', '--format=@@%H', '-E', `--grep=^RFC-${key}:`], root)) {
    if (line.startsWith('@@')) {
      commit = line.slice(2);
      continue;
    }
    const [a, d, f] = line.split('\t');
    if (!f || !commit || f.startsWith('docs/') || f === 'CHANGELOG.md') continue;
    files.set(f, (files.get(f) || 0) + (a === '-' ? 0 : +a) + (d === '-' ? 0 : +d));
  }
  const counted = [...files.entries()].filter(([f]) => !matchAny(f, cosmeticGlobs(cfg)) && !matchAny(f, LOCKFILES));
  return { files: [...files.keys()], lines: counted.reduce((n, [, v]) => n + v, 0) };
}

export default async function audit({ flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  const rules = fastTrackRules(cfg);
  const days = Number(flags.days && flags.days !== true ? flags.days : 90);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rfcs = listRfcs(root).filter((r) => !isSetupKey(r.key) && String(r.fm.created || '9999') >= since);
  const fast = rfcs.filter((r) => r.type === 'fast-track');
  const share = rfcs.length ? fast.length / rfcs.length : 0;

  console.log(c.bold(`devrailsv2 audit · last ${days} days`));
  console.log(`  RFCs: ${rfcs.length}  ·  fast-track: ${fast.length} (${Math.round(share * 100)}%)  ·  approved: ${rfcs.filter((r) => r.status === 'approved').length}  ·  rejected: ${rfcs.filter((r) => r.status === 'rejected').length}`);
  let findings = 0;
  const flag = (m) => (findings++, log.warn(m));
  if (rfcs.length >= 4 && share > (rules.maxShare ?? 0.5)) flag(`Fast-track is ${Math.round(share * 100)}% of all RFCs. Check that regular work isn't being pushed through fast-track.`);

  if (fast.length) console.log(`\n${c.bold('Fast-track RFCs')}`);
  const touched = [];
  for (const r of fast) {
    const st = changeStats(root, cfg, r.key);
    const forbidden = st.files.filter((f) => matchAny(f, rules.forbidden));
    const notes = [];
    if (st.lines > rules.maxLines) notes.push(`${st.lines} lines > ${rules.maxLines}`);
    if (st.files.length > rules.maxFiles) notes.push(`${st.files.length} files > ${rules.maxFiles}`);
    if (forbidden.length) notes.push(`protected areas: ${forbidden.join(', ')}`);
    const who = r.approvedBy ? `approved by ${r.approvedBy.replace(/\s*<.*>/, '')}` : r.status;
    console.log(`  RFC-${r.key}  ${String(st.lines).padStart(4)} lines  ${String(st.files.length).padStart(2)} files  ${c.dim(who)}  ${r.title}`);
    for (const n of notes) flag(`RFC-${r.key}: ${n}`);
    touched.push({ r, files: st.files, created: String(r.fm.created || '') });
  }

  // Possible splitting: several fast-track RFCs on the same files within two weeks
  const seen = new Set();
  for (const a of touched) {
    const related = touched.filter(
      (b) => b !== a && b.files.some((f) => a.files.includes(f)) && Math.abs(new Date(a.created) - new Date(b.created)) <= 14 * 86400000,
    );
    const group = [a, ...related].map((x) => x.r.key).sort();
    if (related.length >= 2 && !seen.has(group.join())) {
      seen.add(group.join());
      flag(`Possible split work: ${group.map((k) => `RFC-${k}`).join(', ')} are fast-track RFCs touching the same files within two weeks. Should this have been one regular RFC?`);
    }
  }
  console.log(findings ? c.yellow(`\n${findings} finding(s) to look at.`) : c.green('\nNo findings.'));
  return 0;
}
