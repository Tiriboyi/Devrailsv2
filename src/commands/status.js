import path from 'node:path';
import { findRoot, exists, read, currentBranch, log, c, CLI } from '../util.js';
import { loadConfig, getActiveRfcId } from '../config.js';
import { listRfcs, getRfc, getChangeRecord, acCoverage, isSetupKey } from '../docs.js';
import { describeTracker } from './auth.js';

export default async function status() {
  const root = findRoot();
  const cfg = loadConfig(root);
  console.log(c.bold(`${cfg.project}`) + c.dim(`  ·  ${cfg.mode}${cfg.migration ? ` ${cfg.migration.from}→${cfg.migration.to}` : ''}  ·  ${cfg.stack}  ·  ${cfg.strictness}  ·  branch ${currentBranch(root) || '-'}`));
  console.log(c.dim(`tracker: ${describeTracker(cfg.tracker)}`));

  const active = getActiveRfcId(root);
  const rfc = active ? getRfc(root, active) : null;
  console.log(`\n${c.bold('Active RFC')}`);
  if (!rfc) log.warn('none — draft one with `rfc new`, get it approved, then `rfc start <id>`');
  else {
    const st = rfc.status === 'approved' ? c.green(rfc.status) : c.yellow(rfc.status);
    console.log(`  RFC-${rfc.key} ${rfc.title}  [${st}${rfc.type === 'fast-track' ? ', fast-track' : ''}]`);
    if (!isSetupKey(rfc.key)) {
      const cov = acCoverage(root, cfg, rfc.key);
      const done = cov.rows.length - cov.missing.length;
      console.log(`  acceptance criteria: ${done}/${cov.rows.length} have tests${cov.missing.length ? c.yellow(`  (missing: ${cov.missing.join(', ')})`) : ''}${cov.spec ? c.dim(`  · spec ${cov.spec.file}`) : ''}`);
      console.log(`  change record: ${getChangeRecord(root, rfc.key) ? c.green('yes') : c.dim('not yet (run done)')}`);
    }
  }

  const waiting = listRfcs(root).filter((r) => r.status === 'draft');
  if (waiting.length) {
    console.log(`\n${c.bold('Waiting for approval')}`);
    for (const r of waiting) console.log(`  RFC-${r.key} ${r.title}  ${c.dim(`(decision owner: ${r.decisionOwner || '?'})`)}`);
  }

  const st = path.join(root, 'docs/STATUS.md');
  if (exists(st)) {
    const m = read(st).match(/## Next step\s*\n([\s\S]*?)(?:\n## |$)/);
    if (m?.[1].trim()) console.log(`\n${c.bold('Next step')} (docs/STATUS.md)\n  ${m[1].trim().split('\n').join('\n  ')}`);
  }
  return 0;
}
