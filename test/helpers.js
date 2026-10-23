import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'devrailsv2.js');

const baseEnv = () => {
  const env = { ...process.env, NO_COLOR: '1', DEVRAILS_NO_SERENA_CLI: '1', GIT_AUTHOR_NAME: 'Test Dev', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Test Dev', GIT_COMMITTER_EMAIL: 'dev@example.com' };
  for (const k of ['CLAUDECODE', 'CI', 'GITHUB_ACTIONS', 'GITHUB_BASE_REF', 'GITHUB_HEAD_REF', 'GITHUB_EVENT_PATH', 'TF_BUILD']) delete env[k];
  return env;
};

export function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `devrailsv2-${name}-`));
}

export function cli(cwd, args, { env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...baseEnv(), ...env }, input });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Async variant: needed when the test process also hosts a mock HTTP server. */
export function cliAsync(cwd, args, { env = {} } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...baseEnv(), ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.stdin.end();
    p.on('close', (code) => resolve({ code, out }));
  });
}

export function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: baseEnv() });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
export const git = (cwd, ...args) => sh(cwd, 'git', args);

export function initRepo(name, initArgs = []) {
  const dir = tmpDir(name);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test Dev');
  git(dir, 'config', 'user.email', 'dev@example.com');
  const r = cli(dir, ['init', '--yes', '--tracker', 'none', '--approvers', 'dev@example.com', ...initArgs]);
  if (r.code !== 0) throw new Error(`init failed: ${r.out}`);
  git(dir, 'add', '-A');
  const year = JSON.parse(fs.readFileSync(path.join(dir, '.rails/config.json'), 'utf8')).setupRfc;
  const c = git(dir, 'commit', '-q', '-m', `RFC-${year}: adopt devrailsv2`);
  if (c.code !== 0) throw new Error(`setup commit failed: ${c.out}`);
  return dir;
}

/** Simulates the human approving an RFC (what `rfc approve` writes) and commits it. */
export function approve(dir, key) {
  const rfcDir = path.join(dir, 'docs/rfc');
  const file = fs.readdirSync(rfcDir).find((f) => f.startsWith(`RFC-${key}`));
  const p = path.join(rfcDir, file);
  fs.writeFileSync(
    p,
    fs.readFileSync(p, 'utf8')
      .replace(/^status:.*$/m, 'status: approved')
      .replace(/^approved_by:.*$/m, 'approved_by: Test Dev <dev@example.com>')
      .replace(/^approved_on:.*$/m, 'approved_on: 2026-10-22'),
  );
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `RFC-${key}: approve`);
  return path.relative(dir, p);
}

/** Replaces the placeholders of a freshly drafted RFC with real content and the given criteria. */
export function fillRfc(dir, key, criteria) {
  const rfcDir = path.join(dir, 'docs/rfc');
  const p = path.join(rfcDir, fs.readdirSync(rfcDir).find((f) => f.startsWith(`RFC-${key}`)));
  let t = fs.readFileSync(p, 'utf8');
  t = t
    .replace('<request>', 'Calculate invoice totals.')
    .replace('<business reason>', 'Totals are wrong on invoices.')
    .replace('`<Confirmed|Likely|Unclear|Missing|Contradiction>`', '`Confirmed`')
    .replace('`<claim type>`', '`behaviour`')
    .replace('<claim>', 'Totals ignore lines.')
    .replace('; <sources>', '; src/invoice.js')
    .replace('<sources>', 'src/invoice.js')
    .replace('<yyyy-mm-dd>', '2026-10-22')
    .replace('<desired outcome>', 'Totals are correct.')
    .replace('- [ ] AC-1: <acceptance criterion>', criteria.map((c, i) => `- [ ] AC-${i + 1}: ${c}`).join('\n'))
    .replace('<out of scope>', 'Currency conversion.')
    .replace('<dependencies>', 'None.')
    .replace('<verification plan>', 'Unit tests.');
  fs.writeFileSync(p, t);
  return path.relative(dir, p);
}

export const hook = (dir, payload) => cli(dir, ['hook', 'claude'], { env: { CLAUDE_PROJECT_DIR: dir }, input: JSON.stringify(payload) });

export function write(dir, rel, content) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}
export const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

export function mockServer(routes) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const key = `${req.method} ${req.url.split('?')[0]}`;
      const h = routes[key];
      if (!h) {
        res.writeHead(404).end('{}');
        return;
      }
      const body = typeof h === 'function' ? h(req) : h;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
