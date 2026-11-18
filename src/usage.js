// Token usage from Claude Code's local session logs, attributed to RFCs, workflow steps, subagents and models.
// Reads ~/.claude/projects/<encoded repo path>/*.jsonl (and <session>/subagents/agent-*.jsonl). Nothing is sent anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** USD per million tokens. List prices are estimates: override in .rails/config.json → usage.prices. */
export const DEFAULT_PRICES = {
  opus: { input: 5, output: 25 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 },
};
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;
const CACHE_READ = 0.1;

export function projectsDir() {
  if (process.env.DEVRAILS_CLAUDE_PROJECTS) return process.env.DEVRAILS_CLAUDE_PROJECTS;
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

/** Claude Code names a project's log folder after its path with every non-alphanumeric character replaced by "-". */
export const encodeProjectPath = (p) => path.resolve(p).replace(/[^a-zA-Z0-9]/g, '-');

export function sessionFiles(root) {
  const dir = projectsDir();
  if (!fs.existsSync(dir)) return [];
  const key = encodeProjectPath(root).toLowerCase();
  const out = [];
  for (const d of fs.readdirSync(dir)) {
    const low = d.toLowerCase();
    if (low !== key && !low.startsWith(`${key}-`)) continue; // the repo and folders below it (incl. worktrees)
    const pdir = path.join(dir, d);
    for (const f of fs.readdirSync(pdir)) {
      if (f.endsWith('.jsonl')) out.push({ file: path.join(pdir, f), agentType: null });
      const sub = path.join(pdir, f, 'subagents');
      if (!f.endsWith('.jsonl') && fs.existsSync(sub)) {
        for (const a of fs.readdirSync(sub).filter((x) => x.endsWith('.jsonl'))) {
          let agentType = null;
          try {
            agentType = JSON.parse(fs.readFileSync(path.join(sub, a.replace(/\.jsonl$/, '.meta.json')), 'utf8')).agentType || null;
          } catch {
            /* meta file is optional */
          }
          out.push({ file: path.join(sub, a), agentType });
        }
      }
    }
  }
  return out;
}

const family = (model = '') => (/opus/i.test(model) ? 'opus' : /sonnet/i.test(model) ? 'sonnet' : /haiku/i.test(model) ? 'haiku' : /fable|mythos/i.test(model) ? 'fable' : 'other');

export function costOf(u, model, prices) {
  const p = prices[family(model)];
  if (!p) return null;
  const write1h = u.cacheWrite1h || 0;
  const write5m = Math.max(0, (u.cacheWrite || 0) - write1h);
  return (
    (u.input * p.input + u.output * p.output + write5m * p.input * CACHE_WRITE_5M + write1h * p.input * CACHE_WRITE_1H + u.cacheRead * p.input * CACHE_READ) /
    1e6
  );
}

const rfcFromBranch = (b = '') => {
  const m = String(b).match(/(?:^|\/)rfc\/(\d{4})-(\d{3,4})\b/i);
  return m ? `${m[1]}-${m[2].padStart(3, '0')}` : null;
};

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('\n');
  return '';
}

/** One record per API response (deduplicated: Claude Code logs a response once per content block). */
export function readRecords(files, { since = null } = {}) {
  const records = [];
  for (const { file, agentType } of files) {
    let lines;
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n');
    } catch {
      continue;
    }
    const seen = new Set();
    let step = null;
    let first = true;
    let subType = agentType;
    for (const line of lines) {
      if (!line.trim()) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (d.type === 'agent_metadata' && d.agentType) subType ||= d.agentType;
      if (d.type === 'user') {
        const cmd = textOf(d.message?.content).match(/<command-name>\/?([\w:-]+)<\/command-name>/);
        if (cmd) step = cmd[1];
        continue;
      }
      if (d.type !== 'assistant' || !d.message?.usage) continue;
      const id = `${d.message.id || ''}|${d.requestId || ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (since && d.timestamp && d.timestamp < since) continue;
      const u = d.message.usage;
      if (d.message.model === '<synthetic>' || !((u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0))) continue; // local placeholders, e.g. failed requests
      const sidechain = !!(agentType !== null || d.isSidechain);
      records.push({
        session: d.sessionId || path.basename(file),
        file,
        time: d.timestamp || '',
        model: d.message.model || 'unknown',
        branch: d.gitBranch || '',
        rfc: rfcFromBranch(d.gitBranch),
        step: sidechain ? `subagent: ${subType || 'unknown'}` : step ? `/${step}` : 'free chat',
        sidechain,
        first: first && !sidechain,
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
        cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
      });
      first = false;
    }
  }
  return records;
}

export function summarize(records, prices) {
  const blank = () => ({ requests: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, unpriced: 0, sessions: new Set() });
  const add = (acc, r) => {
    acc.requests++;
    acc.input += r.input;
    acc.output += r.output;
    acc.cacheWrite += r.cacheWrite;
    acc.cacheRead += r.cacheRead;
    acc.sessions.add(r.session);
    const c = costOf(r, r.model, prices);
    if (c === null) acc.unpriced++;
    else acc.cost += c;
  };
  const total = blank();
  const by = { rfc: new Map(), step: new Map(), model: new Map() };
  for (const r of records) {
    add(total, r);
    for (const [k, key] of [['rfc', r.rfc ? `RFC-${r.rfc}` : r.branch ? `(no RFC: ${r.branch})` : '(no branch)'], ['step', r.step], ['model', r.model]]) {
      if (!by[k].has(key)) by[k].set(key, blank());
      add(by[k].get(key), r);
    }
  }
  const starts = records.filter((r) => r.first).map((r) => r.input + r.cacheWrite + r.cacheRead).sort((a, b) => a - b);
  const perSession = new Map();
  for (const r of records.filter((x) => !x.sidechain)) {
    const s = perSession.get(r.session) || { requests: 0, rfcs: new Set(), peak: 0 };
    s.requests++;
    if (r.rfc) s.rfcs.add(r.rfc);
    s.peak = Math.max(s.peak, r.input + r.cacheWrite + r.cacheRead);
    perSession.set(r.session, s);
  }
  return {
    total,
    by,
    startContext: starts.length ? starts[Math.floor(starts.length / 2)] : null,
    sessions: perSession,
  };
}

export const tokens = (a) => a.input + a.output + a.cacheWrite + a.cacheRead;
export const cacheHit = (a) => {
  const inbound = a.input + a.cacheWrite + a.cacheRead;
  return inbound ? a.cacheRead / inbound : 0;
};

// ---------- static overhead: what devrailsv2 itself adds to every request ----------
export const estimateTokens = (text) => Math.round(String(text || '').length / 3.6);

export function staticOverhead(root) {
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      return '';
    }
  };
  const agents = read('AGENTS.md');
  const claude = read('CLAUDE.md').replace(/^@AGENTS\.md\s*$/m, '');
  const sections = [];
  const parts = agents.split(/^(?=## )/m);
  for (const p of parts) {
    const title = (p.match(/^## (.+)$/m) || [null, '(intro)'])[1];
    sections.push({ title, tokens: estimateTokens(p) });
  }
  sections.sort((a, b) => b.tokens - a.tokens);
  let mcp = [];
  try {
    mcp = Object.keys(JSON.parse(read('.mcp.json') || '{}').mcpServers || {});
  } catch {
    /* ignore */
  }
  return {
    agents: estimateTokens(agents),
    claude: estimateTokens(claude),
    copilot: estimateTokens(read('.github/copilot-instructions.md')),
    sections,
    mcp,
  };
}
