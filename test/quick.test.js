import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, git, initRepo, approve, hook, read, write } from './helpers.js';

const Y = String(new Date().getFullYear());
const K1 = `${Y}-001`;
const rfcPath = (dir) => `docs/rfc/${fs.readdirSync(path.join(dir, 'docs/rfc')).find((f) => f.startsWith(`RFC-${K1}`))}`;
const full = ['--request', 'Button touches the edge on mobile', '--outcome', '12 px padding below 768 px', '--verify', 'Checked at 375 px'];

function repoWithCode(name, extra = []) {
  const dir = initRepo(name, extra);
  write(dir, 'src/ui/Button.css', '.btn { padding: 4px; }\n');
  write(dir, 'src/ui/logic.js', 'export const x = 1;\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'existing code');
  return dir;
}

test('quick drafts a complete fast-track RFC; rfc new --fast-track uses the same short route', () => {
  const dir = repoWithCode('quick-draft');
  let r = cli(dir, ['quick', 'Fix button padding']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /micro: ≤ 10 lines, ≤ 3 files/);
  const t = read(dir, rfcPath(dir));
  for (const line of [`id: RFC-${K1}`, 'type: fast-track', 'status: draft', 'approved_by: null', 'affected_areas: []']) assert.ok(t.includes(`\n${line}\n`), line);
  for (const h of ['Request', 'Business Reason', 'Current Evidence', 'Desired Outcome', 'Acceptance Criteria', 'Out Of Scope', 'Dependencies And Open Decisions', 'Verification Plan', 'Change History']) assert.match(t, new RegExp(`^## ${h}$`, 'm'));
  r = cli(dir, ['rfc', 'lint', K1]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /is complete/, 'nothing left to fill in');
  assert.match(git(dir, 'status', '--porcelain').out, /^A  docs\/rfc\//m, 'the draft is staged');

  const dir2 = repoWithCode('quick-rfcnew');
  r = cli(dir2, ['rfc', 'new', 'Change submit button color', '--fasttrack']);
  assert.equal(r.code, 0, r.out);
  assert.match(read(dir2, rfcPath(dir2)), /^type: fast-track$/m);
  assert.match(read(dir2, rfcPath(dir2)), /Micro change: at most 10 changed lines/);

  const dir3 = repoWithCode('quick-full');
  assert.equal(cli(dir3, ['quick', 'Fix button padding', '--affects', 'src/ui/Button.css', '--ticket', 'GH#9', '--criterion', 'Given 375 px, the button has 12 px padding', ...full]).code, 0);
  assert.match(read(dir3, rfcPath(dir3)), /- \[ \] AC-1: Given 375 px/);
  assert.match(read(dir3, rfcPath(dir3)), /Ticket: GH#9/);
  assert.match(read(dir3, rfcPath(dir3)), /affected_areas: \[src\/ui\/Button\.css\]/);
});

test('quick is refused in strict mode, and approving is human-only', () => {
  const dir = repoWithCode('quick-guard');
  const agent = cli(dir, ['quick', 'X', '--approve'], { env: { CLAUDECODE: '1' } });
  assert.notEqual(agent.code, 0);
  assert.match(agent.out, /human action/);
  // without --approve an agent only drafts
  const draft = cli(dir, ['quick', 'Y'], { env: { CLAUDECODE: '1' } });
  assert.equal(draft.code, 0);
  assert.match(read(dir, rfcPath(dir)), /^status: draft$/m);
  assert.equal(hook(dir, { tool_name: 'Bash', tool_input: { command: 'node .rails/tool/bin/devrailsv2.js quick "x" --approve' } }).code, 2);
  assert.equal(hook(dir, { tool_name: 'Bash', tool_input: { command: 'node .rails/tool/bin/devrailsv2.js quick "x"' } }).code, 0);

  const cfg = JSON.parse(read(dir, '.rails/config.json'));
  cfg.strictness = 'strict';
  write(dir, '.rails/config.json', JSON.stringify(cfg));
  assert.match(cli(dir, ['quick', 'X']).out, /disabled in strict mode/);
});

test('micro fast-track: one commit with an automatic RFC prefix, no change record or tests; limits enforced', () => {
  const dir = repoWithCode('micro');
  cli(dir, ['quick', 'Change submit button color']);
  approve(dir, K1); // what the human's "Approve it now? Y" writes (committed here by the helper)
  git(dir, 'branch', 'base-main', 'HEAD~1');
  assert.equal(cli(dir, ['rfc', 'start', '1']).code, 0);
  write(dir, 'src/ui/Button.css', '.btn { padding: 4px; color: green; }\n');
  write(dir, 'src/ui/logic.js', 'export const x = 2;\n');
  git(dir, 'add', '-A');
  const c = git(dir, 'commit', '-q', '-m', 'change submit button color');
  assert.equal(c.code, 0, c.out);
  assert.match(git(dir, 'log', '-1', '--format=%s').out, new RegExp(`^RFC-${K1}: change submit button color`), 'prefix added automatically');
  const env = { GITHUB_ACTIONS: 'true', GITHUB_HEAD_REF: `rfc/${K1}-change-submit-button-color` };
  const ci = cli(dir, ['check', '--ci', '--base', 'base-main'], { env });
  assert.match(ci.out, /CHANGELOG\.md was not updated/, 'approve (not this test helper) writes the CHANGELOG line');
  assert.doesNotMatch(ci.out, /change record/i);
  assert.doesNotMatch(ci.out, /no tests changed/);
  assert.doesNotMatch(ci.out, /affected_areas is empty/);

  write(dir, 'src/ui/logic.js', Array.from({ length: 12 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');
  git(dir, 'add', '-A');
  const big = git(dir, 'commit', '-q', '-m', 'more');
  assert.notEqual(big.code, 0);
  assert.match(big.out, /Micro change is \d+ lines .* the limit is 10/);
});

test('new RFC ids skip ids used on other branches', () => {
  const dir = repoWithCode('ids');
  git(dir, 'checkout', '-q', '-b', 'rfc/elsewhere');
  cli(dir, ['quick', 'First']);
  git(dir, 'commit', '-q', '-m', `RFC-${K1}: draft`);
  git(dir, 'checkout', '-q', 'main');
  cli(dir, ['quick', 'Second']);
  assert.ok(fs.readdirSync(path.join(dir, 'docs/rfc')).some((f) => f.startsWith(`RFC-${Y}-002-second`)));
});

test('fast-track gate: cosmetic-only passes without tests; logic or out-of-scope changes fail', () => {
  const dir = repoWithCode('quick-gate');
  cli(dir, ['quick', 'Fix button padding', '--affects', 'src/ui/Button.css', ...full]);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `RFC-${K1}: draft`);
  approve(dir, K1);
  git(dir, 'branch', 'base-main');
  assert.equal(cli(dir, ['rfc', 'start', '1']).code, 0);
  write(dir, 'src/ui/Button.css', '.btn { padding: 12px; }\n');
  git(dir, 'commit', '-q', '-am', `RFC-${K1}: padding`);
  const done = cli(dir, ['done', '--base', 'base-main']);
  assert.equal(done.code, 0, done.out);
  const cr = fs.readdirSync(path.join(dir, 'docs/changes')).find((f) => f.startsWith(`CR-${K1}`));
  assert.match(read(dir, `docs/changes/${cr}`), /\(fast-track\)/);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `RFC-${K1}: docs`);
  const env = { GITHUB_ACTIONS: 'true', GITHUB_HEAD_REF: `rfc/${K1}-fix-button-padding` };
  let ci = cli(dir, ['check', '--ci', '--base', 'base-main'], { env });
  assert.equal(ci.code, 0, ci.out);
  assert.match(ci.out, /Only cosmetic files changed/);

  write(dir, 'src/ui/logic.js', 'export const x = 2;\n');
  const blocked = git(dir, 'commit', '-q', '-am', `RFC-${K1}: sneak logic in`);
  assert.notEqual(blocked.code, 0, 'the pre-commit hook already refuses files outside a fast-track RFC');
  assert.match(blocked.out, /Fast-track RFCs may only touch the files they list/);
  // someone bypasses the local hook: CI is the backstop
  git(dir, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-am', `RFC-${K1}: sneak logic in`);
  ci = cli(dir, ['check', '--ci', '--base', 'base-main'], { env });
  assert.equal(ci.code, 1);
  assert.match(ci.out, /no tests changed/);
  assert.match(ci.out, /Fast-track RFCs may only touch the files they list/);
});

test('cosmetic paths are configurable and also apply to regular RFCs', () => {
  const dir = repoWithCode('cosmetic-cfg');
  const cfg = JSON.parse(read(dir, '.rails/config.json'));
  assert.ok(cfg.paths.cosmetic.includes('**/*.css'), 'init writes the defaults so they can be edited');
});

// ---------- abuse guards ----------
const setCfg = (dir, fn) => {
  const cfg = JSON.parse(read(dir, '.rails/config.json'));
  fn(cfg);
  write(dir, '.rails/config.json', JSON.stringify(cfg, null, 2));
  git(dir, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-am', 'config');
};

test('fast-track refuses broad scope, folders, protected areas and too many files', () => {
  const dir = repoWithCode('ft-scope');
  write(dir, 'src/auth/login.ts', 'export {}\n');
  for (const [affects, why] of [
    ['src/**', /uses \*\*/],
    ['src/ui', /whole folder/],
    ['src/auth/login.ts', /protected area/],
    ['src/db/migrations/001.sql', /protected area/],
    ['.github/workflows/ci.yml', /protected area/],
    [Array.from({ length: 11 }, (_, i) => `src/ui/f${i}.css`).join(','), /at most 10/],
  ]) {
    const r = cli(dir, ['quick', 'Tweak', '--affects', affects, ...full]);
    assert.equal(r.code, 1, `${affects}: ${r.out}`);
    assert.match(r.out, why, affects);
    fs.rmSync(path.join(dir, 'docs/rfc', fs.readdirSync(path.join(dir, 'docs/rfc')).find((f) => f.startsWith(`RFC-${K1}`))));
  }
  // a single-folder * pattern is fine
  assert.equal(cli(dir, ['quick', 'Icons', '--affects', 'src/ui/icons/*.svg', ...full]).code, 0);
  assert.equal(cli(dir, ['rfc', 'lint', K1]).code, 0);
});

test('a hand-approved fast-track RFC that breaks the rules still fails the gate', () => {
  const dir = repoWithCode('ft-handapproved');
  cli(dir, ['quick', 'Tweak', '--affects', 'src/ui/Button.css', ...full]);
  const p = rfcPath(dir);
  write(dir, p, read(dir, p).replace('affected_areas: [src/ui/Button.css]', 'affected_areas: ["src/**"]'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `RFC-${K1}: draft`);
  approve(dir, K1);
  git(dir, 'branch', 'base-main');
  cli(dir, ['rfc', 'start', '1']);
  write(dir, 'src/ui/Button.css', '.btn { padding: 12px; }\n');
  const r = git(dir, 'commit', '-q', '-am', `RFC-${K1}: change`);
  assert.notEqual(r.code, 0, 'pre-commit refuses it');
  assert.match(r.out, /uses \*\*/);
});

test('fast-track size limit, one per PR, and the hook keeps edits inside the listed files', () => {
  const dir = repoWithCode('ft-size');
  setCfg(dir, (c) => (c.fastTrack.maxLines = 20));
  cli(dir, ['quick', 'Rename label', '--affects', 'src/ui/logic.js', ...full]);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `RFC-${K1}: draft`);
  approve(dir, K1);
  git(dir, 'branch', 'base-main');
  cli(dir, ['rfc', 'start', '1']);

  // hook: inside the list ok, outside blocked (standard mode, not just strict)
  assert.equal(hook(dir, { tool_name: 'Write', tool_input: { file_path: 'src/ui/logic.js', content: 'x' } }).code, 0);
  assert.equal(hook(dir, { tool_name: 'Write', tool_input: { file_path: 'test/logic.test.js', content: 'x' } }).code, 0, 'tests are allowed');
  const out = hook(dir, { tool_name: 'Write', tool_input: { file_path: 'src/ui/other.js', content: 'x' } });
  assert.equal(out.code, 2);
  assert.match(out.out, /not listed in fast-track/);

  // too many lines
  write(dir, 'src/ui/logic.js', Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');
  write(dir, 'test/logic.test.js', "import { test } from 'node:test';\n");
  git(dir, 'add', '-A');
  const big = git(dir, 'commit', '-q', '-m', `RFC-${K1}: big`);
  assert.notEqual(big.code, 0);
  assert.match(big.out, /limit is 20/);

  // two fast-track RFCs in one pull request
  git(dir, 'reset', '-q', '--hard');
  write(dir, 'src/ui/logic.js', 'export const x = 2;\n');
  write(dir, 'test/logic.test.js', "import { test } from 'node:test';\n");
  git(dir, 'add', '-A');
  assert.equal(git(dir, 'commit', '-q', '-m', `RFC-${K1}: small`).code, 0);
  cli(dir, ['quick', 'Second tweak', '--affects', 'src/ui/Button.css', ...full]);
  const k2 = `${Y}-002`;
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `RFC-${k2}: draft`);
  approve(dir, k2);
  write(dir, 'src/ui/Button.css', '.btn { padding: 12px; }\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', `RFC-${k2}: padding`);
  const ci = cli(dir, ['check', '--ci', '--base', 'base-main'], { env: { GITHUB_ACTIONS: 'true', GITHUB_HEAD_REF: `rfc/${K1}-rename-label` } });
  assert.equal(ci.code, 1);
  assert.match(ci.out, /only one is allowed per pull request/);
});

test('audit shows the fast-track share and flags split work', () => {
  const dir = repoWithCode('ft-audit');
  for (let i = 1; i <= 3; i++) {
    cli(dir, ['quick', `Padding ${i}`, '--affects', 'src/ui/Button.css', ...full]);
    const key = `${Y}-00${i}`;
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', `RFC-${key}: draft`);
    approve(dir, key);
    write(dir, 'src/ui/Button.css', `.btn { padding: ${i}px; }\n`);
    git(dir, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-am', `RFC-${key}: padding`);
  }
  const r = cli(dir, ['audit']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /fast-track: 3 \(100%\)/);
  assert.match(r.out, /Possible split work: RFC-\d{4}-001, RFC-\d{4}-002, RFC-\d{4}-003/);
});

test('documentation is always fast-track: any size, any number of files, no tests, no protected areas', () => {
  const dir = repoWithCode('docs-ft');
  cli(dir, ['quick', 'Rewrite the developer docs']);
  approve(dir, K1);
  git(dir, 'branch', 'base-main', 'HEAD~1');
  cli(dir, ['rfc', 'start', '1']);
  const big = Array.from({ length: 80 }, (_, i) => `Line ${i}`).join('\n') + '\n';
  for (const f of ['README.md', 'docs/setup.md', 'docs/auth/login-flow.md', 'src/ui/README.md', 'notes/release-notes.txt', 'docs/api.rst']) write(dir, f, big);
  git(dir, 'add', '-A');
  const c = git(dir, 'commit', '-q', '-m', 'docs');
  assert.equal(c.code, 0, c.out);
  const ci = cli(dir, ['check', '--ci', '--base', 'base-main'], { env: { GITHUB_ACTIONS: 'true', GITHUB_HEAD_REF: `rfc/${K1}-rewrite-the-developer-docs` } });
  assert.doesNotMatch(ci.out, /Micro change|protected areas|no tests changed/, ci.out);

  // documentation plus a little code: only the code counts towards the micro limit
  write(dir, 'src/ui/logic.js', 'export const x = 3;\n');
  git(dir, 'add', '-A');
  assert.equal(git(dir, 'commit', '-q', '-m', 'docs + tiny code').code, 0);

  // doc-looking files that aren't docs still count
  write(dir, 'requirements.txt', Array.from({ length: 12 }, (_, i) => `pkg${i}==1.0`).join('\n') + '\n');
  git(dir, 'add', '-A');
  const req = git(dir, 'commit', '-q', '-m', 'deps');
  assert.notEqual(req.code, 0);
  assert.match(req.out, /Micro change is \d+ lines/);
});

test('listed fast-track may name doc folders and ** for documentation', () => {
  const dir = repoWithCode('docs-listed');
  const r = cli(dir, ['quick', 'Docs refresh', '--affects', 'docs/**, src/**/*.md, README.md', ...full]);
  assert.equal(r.code, 0, r.out);
  assert.equal(cli(dir, ['rfc', 'lint', K1]).code, 0);
});

test('.gitignore and .editorconfig need no RFC at all', () => {
  const dir = repoWithCode('no-rfc');
  git(dir, 'branch', 'base-main');
  // no active RFC: the hook allows the edit, the commit needs no prefix, CI passes
  assert.equal(hook(dir, { tool_name: 'Write', tool_input: { file_path: '.gitignore', content: 'dist/\n' } }).code, 0);
  assert.equal(hook(dir, { tool_name: 'Write', tool_input: { file_path: 'src/ui/.gitignore', content: 'tmp/\n' } }).code, 0);
  write(dir, '.gitignore', `${read(dir, '.gitignore')}dist/\ncoverage/\n`);
  write(dir, '.editorconfig', 'root = true\n');
  git(dir, 'add', '-A');
  const c = git(dir, 'commit', '-q', '-m', 'ignore build output');
  assert.equal(c.code, 0, c.out);
  const ci = cli(dir, ['check', '--ci', '--base', 'base-main'], { env: { GITHUB_ACTIONS: 'true', GITHUB_HEAD_REF: 'chore/gitignore' } });
  assert.equal(ci.code, 0, ci.out);
  // mixed with code: the code still needs an RFC
  write(dir, '.gitignore', `${read(dir, '.gitignore')}tmp/\n`);
  write(dir, 'src/ui/logic.js', 'export const x = 9;\n');
  git(dir, 'add', '-A');
  assert.notEqual(git(dir, 'commit', '-q', '-m', 'mixed').code, 0);
});
