import path from 'node:path';
import { findRoot, write, template, today, slugify, log } from '../util.js';
import { loadConfig, getActiveRfcId } from '../config.js';
import { nextAdrNumber, listAdrs, resolveRfcKey, ADR_DIR } from '../docs.js';

export default async function adr({ pos, flags }) {
  const root = findRoot();
  loadConfig(root);
  const sub = pos[0] || 'list';
  if (sub === 'list') {
    const all = listAdrs(root);
    if (!all.length) log.info('No ADRs yet.');
    for (const a of all) console.log(`ADR-${a.num}  ${a.file}`);
    return 0;
  }
  if (sub === 'new') {
    const title = pos.slice(1).join(' ');
    if (!title) throw new Error('Usage: devrailsv2 adr new "<decision title>"');
    const num = nextAdrNumber(root);
    const rfc = flags.rfc && flags.rfc !== true ? resolveRfcKey(root, flags.rfc) : getActiveRfcId(root);
    const rel = `${ADR_DIR}/ADR-${num}-${slugify(title)}.md`;
    write(path.join(root, rel), template('docs/adr.md', { id: num, title, date: today(), rfc: rfc ? `RFC-${rfc}` : 'none' }));
    log.ok(`Created ${rel}`);
    return 0;
  }
  throw new Error(`Unknown subcommand "adr ${sub}". Use new | list.`);
}
