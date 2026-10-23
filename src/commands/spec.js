import path from 'node:path';
import { findRoot, write, template, today, log, CLI } from '../util.js';
import { loadConfig, getActiveRfcId } from '../config.js';
import { getRfc, getSpec, SPEC_DIR, acCoverage, isSetupKey } from '../docs.js';

export default async function spec({ pos, flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  const sub = pos[0] || 'show';
  const ref = (flags.rfc && flags.rfc !== true ? flags.rfc : pos[1]) || getActiveRfcId(root);
  if (!ref) throw new Error('No RFC given and no active RFC. Use --rfc <id>.');
  const r = getRfc(root, ref);
  if (!r) throw new Error(`RFC ${ref} not found.`);
  if (isSetupKey(r.key)) throw new Error(`RFC-${r.key} is the setup RFC.`);

  if (sub === 'new') {
    if (r.status !== 'approved' && !flags.force) throw new Error(`RFC-${r.key} is "${r.status}". Write the spec after approval (or use --force to draft early).`);
    const existing = getSpec(root, r.key);
    if (existing && !flags.force) {
      log.warn(`${existing.relPath} already exists.`);
      return 0;
    }
    const acList = r.acs.filter((a) => a.id).map((a) => `### ${a.id}: ${a.text}\n- **Given** …\n- **When** …\n- **Then** …\n- Edge cases: …`).join('\n\n') || '### AC-1: …';
    const testPlan = r.acs.filter((a) => a.id).map((a) => `| RFC-${r.key}:${a.id} | | |`).join('\n') || `| RFC-${r.key}:AC-1 | | |`;
    const rel = `${SPEC_DIR}/SPEC-${r.key}-${r.slug}.md`;
    write(path.join(root, rel), template('docs/spec.md', { key: r.key, title: r.title, date: today(), rfcFile: r.file, acList, testPlan, cli: CLI }));
    log.ok(`Created ${rel}`);
    log.info(`It details the RFC's acceptance criteria. Tests reference them as RFC-${r.key}:AC-1 (see docs/guides/spec-guidelines.md).`);
    return 0;
  }

  if (sub === 'show' || sub === 'coverage') {
    const cov = acCoverage(root, cfg, r.key);
    console.log(`${r.relPath}${cov.spec ? `  ·  ${cov.spec.relPath}` : ''}`);
    if (!cov.rows.length) log.warn('No numbered acceptance criteria in the RFC ("- [ ] AC-1: …").');
    if (cov.unnumbered) log.warn(`${cov.unnumbered} acceptance criteria have no AC id.`);
    for (const row of cov.rows) {
      if (row.tests.length) log.ok(`${row.ac}  ${row.tests.join(', ')}`);
      else log.err(`${row.ac}  no test references RFC-${r.key}:${row.ac}`);
    }
    if (cov.extra.length) log.warn(`Spec uses ${cov.extra.join(', ')}, which are not in the RFC.`);
    return cov.missing.length || !cov.rows.length ? 1 : 0;
  }
  throw new Error(`Unknown subcommand "spec ${sub}". Use new | show.`);
}
