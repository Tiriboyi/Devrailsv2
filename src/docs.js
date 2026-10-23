import fs from 'node:fs';
import path from 'node:path';
import { exists, read, pad, toPosix, matchAny, listRepoFiles } from './util.js';
import { splitFrontmatter } from './frontmatter.js';

export const RFC_DIR = 'docs/rfc';
export const SPEC_DIR = 'docs/specs';
export const CR_DIR = 'docs/changes';
export const ADR_DIR = 'docs/adr';
export const ANALYSIS_DIR = 'docs/analysis';

// ---------- ids: RFC-<yyyy>-<nnn>, keyed internally as "yyyy-nnn" ----------
export const pad3 = (n) => String(n).padStart(3, '0');
export const thisYear = () => String(new Date().getFullYear());
export function parseKey(s) {
  const m = String(s ?? '').match(/(\d{4})-(\d{1,4})\b/);
  return m ? `${m[1]}-${pad3(parseInt(m[2], 10))}` : null;
}
export const isSetupKey = (key) => /^\d{4}-0+$/.test(String(key || ''));
export const SETUP_RFC_HINT = 'the setup RFC (RFC-<yyyy>-000)';

function listKeyed(root, dir, prefix) {
  const abs = path.join(root, dir);
  if (!exists(abs)) return [];
  const re = new RegExp(`^${prefix}-(\\d{4})-(\\d{3,4})(?:-.*)?\\.md$`);
  return fs
    .readdirSync(abs)
    .map((f) => ({ f, m: f.match(re) }))
    .filter((x) => x.m)
    .map(({ f, m }) => ({ key: `${m[1]}-${pad3(parseInt(m[2], 10))}`, file: f, relPath: `${dir}/${f}`, absPath: path.join(abs, f) }))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

export function nextRfcKey(root, year = thisYear()) {
  const seqs = listKeyed(root, RFC_DIR, 'RFC').filter((e) => e.key.startsWith(`${year}-`)).map((e) => parseInt(e.key.slice(5), 10));
  return `${year}-${pad3(Math.max(0, ...seqs) + 1)}`;
}

/** Accepts RFC-2026-001, 2026-001, rfc/2026-001-x, or just 1 (resolved against existing RFCs). */
export function resolveRfcKey(root, ref) {
  if (ref === undefined || ref === null || ref === true || ref === '') return null;
  const k = parseKey(ref);
  if (k) return k;
  const m = String(ref).trim().match(/^(?:RFC-)?0*(\d{1,4})$/i);
  if (!m) throw new Error(`"${ref}" is not an RFC id. Use RFC-${thisYear()}-001, ${thisYear()}-001 or 1.`);
  const seq = pad3(parseInt(m[1], 10));
  const hits = listKeyed(root, RFC_DIR, 'RFC').filter((e) => e.key.endsWith(`-${seq}`));
  if (hits.length === 1) return hits[0].key;
  if (hits.length > 1) {
    const cur = hits.find((h) => h.key.startsWith(`${thisYear()}-`));
    if (cur) return cur.key;
    throw new Error(`"${ref}" is ambiguous (${hits.map((h) => `RFC-${h.key}`).join(', ')}). Use the full id.`);
  }
  return `${thisYear()}-${seq}`;
}

// ---------- markdown helpers ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function section(body, name) {
  const m = new RegExp(`^##[ \\t]+${esc(name)}[ \\t]*$`, 'im').exec(body);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const n = rest.search(/^##[ \t]+/m);
  return n < 0 ? rest : rest.slice(0, n);
}
export function removeSection(text, name) {
  const m = new RegExp(`^##[ \\t]+${esc(name)}[ \\t]*$`, 'im').exec(text);
  if (!m) return text;
  const rest = text.slice(m.index + m[0].length);
  const n = rest.search(/^##[ \t]+/m);
  return text.slice(0, m.index) + (n < 0 ? '' : rest.slice(n));
}

export function parseChecklist(text = '') {
  const items = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/);
    if (!m) continue;
    const id = (m[2].match(/^\**\s*(AC-\d+)\b/) || [])[1] || null;
    items.push({ id, checked: m[1] !== ' ', text: m[2].replace(/^\**\s*AC-\d+\**\s*[:.)-]?\s*/, '').trim() });
  }
  return items;
}

/** Tick the given AC ids in the Acceptance Criteria section. */
export function tickCriteria(text, ids) {
  const want = new Set(ids);
  const m = /^##[ \t]+Acceptance Criteria[ \t]*$/im.exec(text);
  if (!m || !want.size) return text;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const n = rest.search(/^##[ \t]+/m);
  const sec = n < 0 ? rest : rest.slice(0, n);
  const ticked = sec.replace(/^(\s*[-*]\s*)\[ \](\s*\**\s*(AC-\d+)\b)/gm, (all, a, b, id) => (want.has(id) ? `${a}[x]${b}` : all));
  return text.slice(0, start) + ticked + (n < 0 ? '' : rest.slice(n));
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
/** Append a row to the "Change History" table (creates the section if missing). */
export function appendHistory(text, date, author, change) {
  const row = `| ${cell(date)} | ${cell(author)} | ${cell(change)} |`;
  const m = /^##[ \t]+Change History[ \t]*$/im.exec(text);
  if (!m) return `${text.replace(/\s*$/, '')}\n\n## Change History\n\n| Date | Author | Change |\n|---|---|---|\n${row}\n`;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const n = rest.search(/^##[ \t]+/m);
  const sec = n < 0 ? rest : rest.slice(0, n);
  const lines = sec.split('\n');
  let last = -1;
  lines.forEach((l, i) => {
    if (/^\s*\|/.test(l)) last = i;
  });
  if (last < 0) lines.push('', '| Date | Author | Change |', '|---|---|---|', row);
  else lines.splice(last + 1, 0, row);
  return text.slice(0, start) + lines.join('\n') + (n < 0 ? '' : rest.slice(n));
}

/** Content that must not change after approval (ignores updated:, checkboxes and Change History). */
export function normalizeRfc(text) {
  return removeSection(String(text).replace(/\r\n/g, '\n'), 'Change History')
    .replace(/^updated:.*$/m, '')
    .replace(/^(\s*[-*]\s*)\[[xX]\]/gm, '$1[ ]')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}

// ---------- RFCs ----------
const toList = (v) =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : [];
const none = (v) => v === null || v === undefined || v === '' || /^(none|null|~)$/i.test(String(v));

function toRfc(e) {
  const text = read(e.absPath);
  const { fm, body } = splitFrontmatter(text);
  const f = fm || {};
  const h1 = (body.match(/^#\s+(?:(?:REQ|RFC)-\d{4}-\d{3,4}\s*[-–:]\s*)?(.+)$/m) || [])[1];
  return {
    ...e,
    id: `RFC-${e.key}`,
    text,
    body,
    fm: f,
    hasFrontmatter: !!fm,
    title: (f.title && String(f.title)) || h1 || '',
    status: String(none(f.status) ? 'draft' : f.status).toLowerCase(),
    type: String(none(f.type) ? 'change' : f.type).toLowerCase(),
    requestedBy: none(f.requested_by) ? '' : String(f.requested_by),
    decisionOwner: none(f.decision_owner) ? '' : String(f.decision_owner),
    approvedBy: none(f.approved_by) ? '' : String(f.approved_by),
    approvedOn: none(f.approved_on) ? '' : String(f.approved_on),
    affects: toList(f.affected_areas),
    exemption: none(f.test_exemption) ? null : String(f.test_exemption),
    ticket: (body.match(/\b(?:GH|ADO)#\d+\b/i) || [])[0] || '',
    slug: e.file.replace(/^RFC-\d{4}-\d{3,4}-?/, '').replace(/\.md$/, ''),
    acs: parseChecklist(section(body, 'Acceptance Criteria')),
  };
}

export const listRfcs = (root) => listKeyed(root, RFC_DIR, 'RFC').map(toRfc);
export function getRfc(root, ref) {
  const key = resolveRfcKey(root, ref);
  const e = key && listKeyed(root, RFC_DIR, 'RFC').find((x) => x.key === key);
  return e ? toRfc(e) : null;
}

export const STATUSES = ['draft', 'approved', 'rejected', 'superseded'];
export const TYPES = ['change', 'fast-track'];
export const EVIDENCE = ['Confirmed', 'Likely', 'Unclear', 'Missing', 'Contradiction'];
const REQUIRED_KEYS = ['id', 'title', 'status', 'type', 'requested_by', 'decision_owner', 'approved_by', 'approved_on', 'created', 'updated', 'affected_areas'];
const REQUIRED_SECTIONS = ['Request', 'Business Reason', 'Current Evidence', 'Desired Outcome', 'Acceptance Criteria', 'Out Of Scope', 'Dependencies And Open Decisions', 'Verification Plan', 'Change History'];
const PLACEHOLDER = /(?<![\w<])<(?:[a-z][a-z0-9 _/-]*|Confirmed\|[^>]*|yyyy-mm-dd)>/gi;

/** Structural check of an RFC. errors = broken format; warnings = incomplete content. */
export function lintRfc(rfc) {
  const errors = [];
  const warnings = [];
  if (!rfc.hasFrontmatter) return { errors: ['has no YAML frontmatter (--- … ---).'], warnings };
  const missingKeys = REQUIRED_KEYS.filter((k) => !(k in rfc.fm));
  if (missingKeys.length) errors.push(`frontmatter is missing: ${missingKeys.join(', ')}.`);
  if (rfc.fm.id && parseKey(rfc.fm.id) !== rfc.key) errors.push(`frontmatter id "${rfc.fm.id}" does not match the file name (RFC-${rfc.key}).`);
  if (!STATUSES.includes(rfc.status)) errors.push(`status "${rfc.status}" must be one of ${STATUSES.join(', ')}.`);
  if (!TYPES.includes(rfc.type)) warnings.push(`type "${rfc.type}" is not one of ${TYPES.join(', ')}; treated as change.`);
  if (rfc.status === 'approved' && (!rfc.approvedBy || !rfc.approvedOn)) errors.push('status is approved but approved_by / approved_on are empty.');
  if (rfc.status === 'draft' && (rfc.approvedBy || rfc.approvedOn)) warnings.push('status is draft but approved_by / approved_on are set.');

  const missingSections = REQUIRED_SECTIONS.filter((s) => section(rfc.body, s) === null);
  if (missingSections.length) errors.push(`missing sections: ${missingSections.join(', ')}.`);

  const placeholders = [];
  for (const s of REQUIRED_SECTIONS) {
    const t = section(rfc.body, s);
    if (t && (t.match(PLACEHOLDER) || []).length) placeholders.push(s);
  }
  for (const k of ['title', 'requested_by', 'decision_owner']) if ((String(rfc.fm[k] ?? '').match(PLACEHOLDER) || []).length) placeholders.push(k);
  if (placeholders.length) warnings.push(`placeholders not filled in: ${[...new Set(placeholders)].join(', ')}.`);

  const ev = section(rfc.body, 'Current Evidence') || '';
  for (const m of ev.matchAll(/^Status:\s*`?([^`\n]*?)`?\s*$/gm)) {
    const v = m[1].trim();
    if (/^<.*>$/.test(v)) continue;
    const hit = EVIDENCE.find((x) => x.toLowerCase() === v.toLowerCase());
    if (!hit) errors.push(`evidence status "${v}" must be one of ${EVIDENCE.join(', ')}.`);
    else if (hit === 'Missing' || hit === 'Contradiction') warnings.push(`evidence status is ${hit}; resolve it or record it under Dependencies And Open Decisions.`);
  }

  if (!rfc.acs.length) warnings.push('no acceptance criteria (- [ ] AC-1: …).');
  const unnumbered = rfc.acs.filter((a) => !a.id).length;
  if (unnumbered) errors.push(`${unnumbered} acceptance criteria have no id; write them as "- [ ] AC-1: …" so tests can reference them.`);
  const ids = rfc.acs.map((a) => a.id).filter(Boolean);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) errors.push(`duplicate acceptance criteria ids: ${[...new Set(dup)].join(', ')}.`);
  if (!rfc.affects.length) warnings.push('affected_areas is empty, so scope cannot be checked.');
  return { errors, warnings };
}

// ---------- specs, change records, ADRs ----------
export function getSpec(root, ref) {
  const key = resolveRfcKey(root, ref);
  const e = key && listKeyed(root, SPEC_DIR, 'SPEC').find((x) => x.key === key);
  if (!e) return null;
  const text = read(e.absPath);
  const acs = [...new Set([...text.matchAll(/^\s*(?:[-*]|#{1,6}|\|)\s*(?:\[[ xX]\]\s*)?\**\s*(AC-\d+)\b/gm)].map((m) => m[1]))];
  return { ...e, id: `SPEC-${e.key}`, text, acs };
}
export function getChangeRecord(root, ref) {
  const key = resolveRfcKey(root, ref);
  return (key && listKeyed(root, CR_DIR, 'CR').find((x) => x.key === key)) || null;
}

function listNumbered(root, dir, prefix) {
  const abs = path.join(root, dir);
  if (!exists(abs)) return [];
  const re = new RegExp(`^${prefix}-(\\d{4})(?:-.*)?\\.md$`);
  return fs
    .readdirSync(abs)
    .map((f) => ({ f, m: f.match(re) }))
    .filter((x) => x.m)
    .map(({ f, m }) => ({ num: m[1], file: f, relPath: `${dir}/${f}`, absPath: path.join(abs, f) }))
    .sort((a, b) => a.num.localeCompare(b.num));
}
export const listAdrs = (root) => listNumbered(root, ADR_DIR, 'ADR');
export const nextAdrNumber = (root) => pad(Math.max(0, ...listAdrs(root).map((a) => parseInt(a.num, 10))) + 1);

// ---------- acceptance-criteria ↔ test links ----------
/** Finds RFC-yyyy-nnn:AC-n (also REQ-/SPEC-) in test files. Map("2026-001:AC-1" -> [files]). */
export function findAcRefs(root, testGlobs) {
  const refs = new Map();
  for (const f of listRepoFiles(root)) {
    if (!matchAny(f, testGlobs)) continue;
    const abs = path.join(root, f);
    let text;
    try {
      if (fs.statSync(abs).size > 2_000_000) continue;
      text = read(abs);
    } catch {
      continue;
    }
    for (const m of text.matchAll(/\b(?:RFC|REQ|SPEC)-(\d{4})-(\d{3,4})\s*[:/]\s*(AC-\d+)\b/g)) {
      const key = `${m[1]}-${pad3(parseInt(m[2], 10))}:${m[3]}`;
      if (!refs.has(key)) refs.set(key, []);
      if (!refs.get(key).includes(toPosix(f))) refs.get(key).push(toPosix(f));
    }
  }
  return refs;
}

/** Coverage of the RFC's acceptance criteria by tests. */
export function acCoverage(root, cfg, ref) {
  const rfc = getRfc(root, ref);
  if (!rfc) return null;
  const spec = getSpec(root, rfc.key);
  const refs = findAcRefs(root, cfg.paths.tests);
  const rows = rfc.acs.filter((a) => a.id).map((a) => ({ ac: a.id, text: a.text, checked: a.checked, tests: refs.get(`${rfc.key}:${a.id}`) || [] }));
  const known = new Set(rows.map((r) => r.ac));
  return {
    rfc,
    spec,
    rows,
    missing: rows.filter((r) => !r.tests.length).map((r) => r.ac),
    unnumbered: rfc.acs.filter((a) => !a.id).length,
    extra: spec ? spec.acs.filter((a) => !known.has(a)) : [],
  };
}

