import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATES = path.join(PKG_ROOT, 'templates');
export const CLI = 'node .rails/tool/bin/devrailsv2.js';

// ---------- files ----------
export const exists = (p) => fs.existsSync(p);
export const read = (p) => fs.readFileSync(p, 'utf8');
export function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
export function readJson(p, fallback = null) {
  try {
    return JSON.parse(read(p));
  } catch {
    return fallback;
  }
}
export const writeJson = (p, obj) => write(p, JSON.stringify(obj, null, 2) + '\n');
export const toPosix = (p) => p.replace(/\\/g, '/');

// ---------- processes ----------
export function run(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    error: r.error,
  };
}
export const git = (args, cwd) => run('git', args, { cwd });
export function gitLines(args, cwd) {
  const r = git(args, cwd);
  return r.ok && r.stdout ? r.stdout.split(/\r?\n/).filter(Boolean) : [];
}
export function gitUser(cwd) {
  const name = git(['config', 'user.name'], cwd).stdout;
  const email = git(['config', 'user.email'], cwd).stdout;
  return { name, email, display: [name, email && `<${email}>`].filter(Boolean).join(' ') };
}
export function isGitRepo(cwd) {
  return git(['rev-parse', '--is-inside-work-tree'], cwd).stdout === 'true';
}
export function currentBranch(cwd) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).stdout;
}

// ---------- globs ----------
const reCache = new Map();
export function globToRegex(glob) {
  if (reCache.has(glob)) return reCache.get(glob);
  let re = '';
  const g = toPosix(glob.trim());
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const rx = new RegExp(`^${re}$`, 'i');
  reCache.set(glob, rx);
  return rx;
}
export const matchAny = (file, globs = []) =>
  globs.some((g) => g && globToRegex(g).test(toPosix(file)));
/** Like matchAny, but a plain path ("src/billing") also covers everything below it. */
export const matchAffects = (file, entries = []) =>
  entries.some((e) => {
    const g = toPosix(String(e).trim()).replace(/\/+$/, '');
    if (!g) return false;
    if (/[*?]/.test(g)) return globToRegex(g).test(toPosix(file));
    const f = toPosix(file).toLowerCase();
    return f === g.toLowerCase() || f.startsWith(`${g.toLowerCase()}/`);
  });

// ---------- text ----------
export const pad = (n) => String(n).padStart(4, '0');
export const today = () => new Date().toISOString().slice(0, 10);
export function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'change'
  );
}
export function render(tpl, vars) {
  return tpl.replace(/@@(\w+)@@/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
}
export const template = (rel, vars = {}) => render(read(path.join(TEMPLATES, rel)), vars);

const START = '<!-- devrailsv2:start -->';
const END = '<!-- devrailsv2:end -->';
export function upsertBlock(existing, block) {
  const i = existing.indexOf(START);
  const j = existing.indexOf(END);
  if (i >= 0 && j > i) return existing.slice(0, i) + block.trim() + existing.slice(j + END.length);
  return existing.replace(/\s*$/, '\n\n') + block.trim() + '\n';
}
export function insertAfterMarker(text, marker, line) {
  const i = text.indexOf(marker);
  if (i < 0) return text.replace(/\s*$/, '\n') + line + '\n';
  const at = i + marker.length;
  return text.slice(0, at) + '\n' + line + text.slice(at);
}
export function replaceBetween(text, startMarker, endMarker, inner) {
  const i = text.indexOf(startMarker);
  const j = text.indexOf(endMarker);
  if (i < 0 || j < i) return text.replace(/\s*$/, '\n\n') + `${startMarker}\n${inner}\n${endMarker}\n`;
  return text.slice(0, i + startMarker.length) + '\n' + inner + '\n' + text.slice(j);
}
export function stripHtml(html = '') {
  return String(html)
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, t) => `\n${'#'.repeat(Math.max(3, +n))} ${t.replace(/<[^>]+>/g, '').trim()}\n`)
    .replace(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, (m, src) => `![${(m.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || 'image'}](${src})`)
    .replace(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, t) => {
      const text = t.replace(/<[^>]+>/g, '').trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- repo ----------
export function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (exists(path.join(dir, '.rails', 'config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const top = git(['rev-parse', '--show-toplevel'], start);
  return top.ok && top.stdout ? path.resolve(top.stdout) : path.resolve(start);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', 'build', 'coverage', '.rails', '.vs', '.idea']);
export function listRepoFiles(root) {
  if (isGitRepo(root)) {
    return gitLines(['ls-files', '--cached', '--others', '--exclude-standard'], root).map(toPosix);
  }
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
      } else out.push(toPosix(path.relative(root, path.join(dir, e.name))));
    }
  };
  walk(root);
  return out;
}

// ---------- console ----------
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const color = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = { green: color(32), yellow: color(33), red: color(31), dim: color(2), bold: color(1), cyan: color(36) };
export const log = {
  info: (m) => console.log(m),
  ok: (m) => console.log(`${c.green('✔')} ${m}`),
  warn: (m) => console.log(`${c.yellow('!')} ${m}`),
  err: (m) => console.log(`${c.red('✖')} ${m}`),
  step: (m) => console.log(`${c.cyan('→')} ${m}`),
};

// ---------- prompts ----------
let rl = null;
const getRl = () => (rl ??= readline.createInterface({ input: process.stdin, output: process.stdout }));
export function closePrompts() {
  rl?.close();
  rl = null;
}
export const isInteractive = (flags = {}) => !flags.yes && process.stdin.isTTY && process.stdout.isTTY;
export async function ask(q, def = '') {
  const a = (await getRl().question(`${q}${def ? c.dim(` (${def})`) : ''}: `)).trim();
  return a || def;
}
export async function select(q, options, defValue) {
  console.log(c.bold(q));
  const defIdx = Math.max(0, options.findIndex((o) => o.value === defValue));
  options.forEach((o, i) => console.log(`  ${i + 1}) ${o.label}${o.hint ? c.dim(` — ${o.hint}`) : ''}`));
  for (;;) {
    const n = parseInt(await ask('Choose', String(defIdx + 1)), 10);
    if (n >= 1 && n <= options.length) return options[n - 1].value;
    console.log('Please enter one of the numbers above.');
  }
}
export async function confirm(q, def = true) {
  const a = (await ask(`${q} ${def ? '[Y/n]' : '[y/N]'}`)).toLowerCase();
  return a ? a.startsWith('y') : def;
}
