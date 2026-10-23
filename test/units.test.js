import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegex, matchAny, upsertBlock, slugify, stripHtml } from '../src/util.js';
import { parseChecklist, tickCriteria, appendHistory, normalizeRfc, parseKey } from '../src/docs.js';
import { splitFrontmatter, setFields, yamlScalar } from '../src/frontmatter.js';
import { rfcIdsFrom, classify } from '../src/gate.js';
import { parseArgs } from '../src/cli.js';
import { STACKS } from '../src/config.js';

test('globs: ** spans directories, * stays in one segment', () => {
  assert.ok(matchAny('src/a/b/c.js', ['src/**']));
  assert.ok(matchAny('test/x.test.js', ['**/*.test.*']));
  assert.ok(matchAny('x.test.ts', ['**/*.test.*']));
  assert.ok(!matchAny('src/a/b.js', ['src/*.js']));
  assert.ok(matchAny('src\\win\\path.cs', ['src/**']));
  assert.ok(globToRegex('docs/rfc/**').test('docs/rfc/RFC-2026-001-x.md'));
});

test('managed block is inserted once and then replaced in place', () => {
  const block = '<!-- devrailsv2:start -->\nNEW\n<!-- devrailsv2:end -->';
  const once = upsertBlock('# Mine\n', block);
  assert.match(once, /^# Mine\n\n<!-- devrailsv2:start -->\nNEW/);
  const twice = upsertBlock(once.replace('NEW', 'OLD'), block);
  assert.equal(twice, once);
});

test('frontmatter: parse, set fields, quote when needed', () => {
  const t = '---\nid: RFC-2026-003\ntitle: "Export: CSV"\nstatus: draft\napproved_by: null\naffected_areas: [src/a/**, "tests/**"]\nlist:\n  - one\n  - two\n---\n\n# REQ-2026-003 - Export\n';
  const { fm, body } = splitFrontmatter(t);
  assert.equal(fm.title, 'Export: CSV');
  assert.equal(fm.approved_by, null);
  assert.deepEqual(fm.affected_areas, ['src/a/**', 'tests/**']);
  assert.deepEqual(fm.list, ['one', 'two']);
  assert.match(body, /^\n# REQ-2026-003/);
  const u = setFields(t, { status: 'approved', approved_by: 'Ann <a@x.io>', list: ['three'] });
  assert.match(u, /^status: approved$/m);
  assert.match(u, /^approved_by: Ann <a@x\.io>$/m);
  assert.match(u, /^list: \[three\]$/m);
  assert.doesNotMatch(u, /- one/);
  assert.equal(yamlScalar('**/*.cs'), '"**/*.cs"');
  assert.equal(yamlScalar(null), 'null');
  assert.equal(yamlScalar('2026-10-22'), '2026-10-22');
  assert.equal(yamlScalar('42'), '"42"');
});

test('RFC ids, checklists, ticking, history and normalisation', () => {
  assert.equal(parseKey('RFC-2026-7'), '2026-007');
  assert.equal(parseKey('rfc/2026-012-thing'), '2026-012');
  const sec = '## Acceptance Criteria\n\n- [ ] AC-1: one\n- [ ] AC-2: two\n- [ ] unnumbered\n\n## Out Of Scope\n- [ ] AC-9: not a criterion\n';
  const items = parseChecklist(sec.split('## Out')[0]);
  assert.deepEqual(items.map((i) => i.id), ['AC-1', 'AC-2', null]);
  assert.equal(items[0].text, 'one');
  const ticked = tickCriteria(sec, ['AC-2', 'AC-9']);
  assert.match(ticked, /- \[x\] AC-2: two/);
  assert.match(ticked, /- \[ \] AC-9/, 'only the Acceptance Criteria section is touched');
  const h = appendHistory('# x\n\n## Change History\n\n| Date | Author | Change |\n|---|---|---|\n| d1 | a | Created draft |\n', 'd2', 'b|c', 'Approved');
  assert.match(h, /\| d1 \| a \| Created draft \|\n\| d2 \| b\\\|c \| Approved \|/);
  assert.equal(normalizeRfc(`---\nupdated: 1\n---\n${ticked}${h}`), normalizeRfc(`---\nupdated: 2\n---\n${sec}# x`));
});

test('file classification for node and dotnet', () => {
  const node = { paths: STACKS.node };
  assert.equal(classify(node, 'src/app.js'), 'src');
  assert.equal(classify(node, 'src/app.test.js'), 'test');
  assert.equal(classify(node, 'docs/rfc/RFC-2026-001-x.md'), 'free');
  assert.equal(classify(node, 'package.json'), 'other');
  const net = { paths: STACKS.dotnet };
  assert.equal(classify(net, 'src/Billing.Api/Program.cs'), 'src');
  assert.equal(classify(net, 'tests/Billing.Tests/ExportTests.cs'), 'test');
  assert.equal(classify(net, 'src/Billing.Tests/ExportTests.cs'), 'test');
});

test('argument parsing', () => {
  const { pos, flags } = parseArgs(['rfc', 'new', 'My', 'title', '--ticket', 'GH#3', '--fast-track', '--affects=src/**']);
  assert.deepEqual(pos, ['rfc', 'new', 'My', 'title']);
  assert.deepEqual(flags, { ticket: 'GH#3', 'fast-track': true, affects: 'src/**' });
});

test('helpers', () => {
  assert.equal(slugify('Export Invoices (CSV)!'), 'export-invoices-csv');
  assert.equal(stripHtml('<div>Hello&nbsp;<b>world</b></div><ul><li>a</li></ul>'), 'Hello world\n- a');
});
