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

test('quick drafts a fast-track RFC in the RFC format with only three sections to write', () => {
  const dir = repoWithCode('quick-draft');
  let r = cli(dir, ['quick', 'Fix button padding', '--affects', 'src/ui/Button.css']);
  assert.equal(r.code, 0, r.out);
  const t = read(dir, rfcPath(dir));
  for (const line of [`id: RFC-${K1}`, 'type: fast-track', 'status: draft', 'approved_by: null', 'affected_areas: [src/ui/Button.css]']) assert.ok(t.includes(`\n${line}\n`), line);
  for (const h of ['Request', 'Business Reason', 'Current Evidence', 'Desired Outcome', 'Acceptance Criteria', 'Out Of Scope', 'Dependencies And Open Decisions', 'Verification Plan', 'Change History']) assert.match(t, new RegExp(`^## ${h}$`, 'm'));
  r = cli(dir, ['rfc', 'lint', K1]);
  assert.match(r.out, /placeholders not filled in: Request, Desired Outcome, Verification Plan\./);
  assert.doesNotMatch(r.out, /no acceptance criteria/);

  const dir2 = repoWithCode('quick-full');
  assert.equal(cli(dir2, ['quick', 'Fix button padding', '--affects', 'src/ui/Button.css', '--ticket', 'GH#9', '--criterion', 'Given 375 px, the button has 12 px padding', ...full]).code, 0);
  r = cli(dir2, ['rfc', 'lint', K1]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /is complete/);
  assert.match(read(dir2, rfcPath(dir2)), /- \[ \] AC-1: Given 375 px/);
  assert.match(read(dir2, rfcPath(dir2)), /Ticket: GH#9/);
});

test('quick needs --affects, is refused in strict mode, and --approve is human-only', () => {
  const dir = repoWithCode('quick-guard');
  assert.notEqual(cli(dir, ['quick', 'No scope']).code, 0);
  const agent = cli(dir, ['quick', 'X', '--affects', 'src/ui/Button.css', '--approve', ...full], { env: { CLAUDECODE: '1' } });
  assert.notEqual(agent.code, 0);
  assert.match(agent.out, /human action/);
  assert.ok(!fs.existsSync(path.join(dir, 'docs/rfc', `RFC-${K1}-x.md`)), 'nothing is written when refused');
  assert.equal(hook(dir, { tool_name: 'Bash', tool_input: { command: 'node .rails/tool/bin/devrailsv2.js quick "x" --affects a --approve' } }).code, 2);
  assert.equal(hook(dir, { tool_name: 'Bash', tool_input: { command: 'node .rails/tool/bin/devrailsv2.js quick "x" --affects a' } }).code, 0);

  const cfg = JSON.parse(read(dir, '.rails/config.json'));
  cfg.strictness = 'strict';
  write(dir, '.rails/config.json', JSON.stringify(cfg));
  assert.match(cli(dir, ['quick', 'X', '--affects', 'a']).out, /disabled in strict mode/);
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
