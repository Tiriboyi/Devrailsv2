// Minimal YAML frontmatter support for flat documents: scalars, null, inline lists and block lists.

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function scalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (/^(null|~)$/i.test(v)) return null;
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^\[.*\]$/.test(v)) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlow(inner).map(scalar).filter((x) => x !== '' && x !== null);
  }
  if (/^".*"$/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v.replace(/\s+#.*$/, '');
}

function splitFlow(s) {
  const out = [];
  let cur = '';
  let q = null;
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseYaml(src) {
  const obj = {};
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):(?:[ \t]+(.*)|[ \t]*)$/);
    if (!m) continue;
    const [, key, rest = ''] = m;
    if (rest.trim() === '') {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s*/.test(lines[i + 1])) items.push(scalar(lines[++i].replace(/^\s+-\s*/, '')));
      obj[key] = items.length ? items : '';
    } else obj[key] = scalar(rest);
  }
  return obj;
}

export function splitFrontmatter(text = '') {
  const m = String(text).match(FM_RE);
  if (!m) return { fm: null, raw: '', body: String(text) };
  return { fm: parseYaml(m[1]), raw: m[1], body: String(text).slice(m[0].length) };
}

const NEEDS_QUOTES = /^[\s\-?:,[\]{}#&*!|>'"%@`]|: | #|\s$|^(null|true|false|yes|no|on|off|~)$|^[\d.+-]+$/i;

export function yamlScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(yamlScalar).join(', ')}]`;
  if (typeof v === 'boolean') return String(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // dates stay plain, as in the RFC format
  if (s === '' || NEEDS_QUOTES.test(s) || /[,[\]{}]/.test(s)) return JSON.stringify(s);
  return s;
}

/** Set top-level keys in the frontmatter, keeping every other line as it is. */
export function setFields(text, fields) {
  const m = String(text).match(FM_RE);
  if (!m) throw new Error('Document has no YAML frontmatter.');
  const lines = m[1].split(/\r?\n/);
  for (const [key, value] of Object.entries(fields)) {
    const line = `${key}: ${yamlScalar(value)}`;
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (i < 0) {
      lines.push(line);
      continue;
    }
    let n = 1;
    while (i + n < lines.length && /^\s+-\s*/.test(lines[i + n])) n++;
    lines.splice(i, n, line);
  }
  return `---\n${lines.join('\n')}\n---\n` + String(text).slice(m[0].length);
}
