import { findRoot, log, c } from '../util.js';
import { loadConfig } from '../config.js';
import { getRfc } from '../docs.js';
import { sessionFiles, readRecords, summarize, tokens, cacheHit, staticOverhead, projectsDir, encodeProjectPath, DEFAULT_PRICES } from '../usage.js';

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const usd = (a) => (a.unpriced && !a.cost ? '   n/a' : `$${a.cost.toFixed(2)}`.padStart(7));
const pct = (x) => `${Math.round(x * 100)}%`;

function table(title, map, { limit = 12, label = (x) => x } = {}) {
  const rows = [...map.entries()].sort((a, b) => b[1].cost - a[1].cost || tokens(b[1]) - tokens(a[1])).slice(0, limit);
  if (!rows.length) return;
  console.log(`\n${c.bold(title)}`);
  console.log(c.dim(`  ${'name'.padEnd(34)} ${'requests'.padStart(8)} ${'tokens'.padStart(8)} ${'cache'.padStart(6)} ${'est.'.padStart(7)}`));
  for (const [name, a] of rows) {
    console.log(`  ${label(name).slice(0, 34).padEnd(34)} ${String(a.requests).padStart(8)} ${k(tokens(a)).padStart(8)} ${pct(cacheHit(a)).padStart(6)} ${usd(a)}`);
  }
}

export default async function usage({ flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  const prices = { ...DEFAULT_PRICES, ...(cfg.usage?.prices || {}) };
  const days = flags.days && flags.days !== true ? Number(flags.days) : 30;
  const since = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : null;

  const files = sessionFiles(root);
  let records = readRecords(files, { since });
  if (flags.rfc && flags.rfc !== true) {
    const key = String(flags.rfc).replace(/^RFC-/i, '');
    records = records.filter((r) => r.rfc && (r.rfc === key || r.rfc.endsWith(`-${key.padStart(3, '0')}`)));
  }
  const s = summarize(records, prices);
  const st = staticOverhead(root);

  if (flags.json) {
    const plain = (m) => Object.fromEntries([...m.entries()].map(([n, a]) => [n, { ...a, sessions: a.sessions.size, tokens: tokens(a), cacheHit: cacheHit(a) }]));
    console.log(JSON.stringify({ days, total: { ...s.total, sessions: s.total.sessions.size, tokens: tokens(s.total), cacheHit: cacheHit(s.total) }, byRfc: plain(s.by.rfc), byStep: plain(s.by.step), byModel: plain(s.by.model), startContext: s.startContext, static: st }, null, 2));
    return 0;
  }

  console.log(c.bold(`devrailsv2 usage · Claude Code · last ${days > 0 ? `${days} days` : 'all time'}`) + c.dim(`  (${files.length} log file(s) in ${projectsDir()})`));
  if (!records.length) {
    log.warn(`No Claude Code sessions found for this repository (looked for ${encodeProjectPath(root)}*). Logs exist only on the machine where Claude Code ran.`);
  } else {
    const t = s.total;
    console.log(`  sessions ${t.sessions.size} · requests ${t.requests} · tokens ${k(tokens(t))} (input ${k(t.input)}, output ${k(t.output)}, cache write ${k(t.cacheWrite)}, cache read ${k(t.cacheRead)})`);
    console.log(`  cache hit rate ${pct(cacheHit(t))} · estimated cost ${usd(t).trim()}${t.unpriced ? c.dim(` (${t.unpriced} request(s) on models without a price)`) : ''}`);
    table('By RFC', s.by.rfc, {
      label: (n) => {
        const r = n.startsWith('RFC-') ? getRfc(root, n.slice(4)) : null;
        return r ? `${n}${r.type === 'fast-track' ? ' [fast]' : ''} ${r.title}` : n;
      },
    });
    table('By step', s.by.step);
    table('By model', s.by.model);
  }

  console.log(`\n${c.bold('Fixed overhead per request')}`);
  if (s.startContext) console.log(`  measured: a new session starts at ~${k(s.startContext)} tokens of context (median first request)`);
  console.log(`  AGENTS.md ~${k(st.agents)} tokens · CLAUDE.md extras ~${k(st.claude)}${st.mcp.length ? ` · MCP servers: ${st.mcp.join(', ')} (their tool definitions are sent too)` : ''}`);
  console.log(c.dim(`  largest AGENTS.md sections: ${st.sections.slice(0, 4).map((x) => `${x.title} ~${k(x.tokens)}`).join(' · ')}`));

  // ---- hints ----
  const hints = [];
  if (records.length && tokens(s.total)) {
    const hit = cacheHit(s.total);
    if (hit < 0.7) hints.push(`Cache hit rate is ${pct(hit)}. Common causes: pauses longer than the cache lifetime, switching models mid-session, or editing AGENTS.md/CLAUDE.md/MCP config during a session. Each forces the whole prefix to be re-sent at full price.`);
    const multi = [...s.sessions.values()].filter((x) => x.rfcs.size > 1).length;
    if (multi) hints.push(`${multi} session(s) span more than one RFC. Start a fresh session per RFC: context from the previous RFC is re-sent on every request.`);
    const long = [...s.sessions.values()].filter((x) => x.peak > 120000).length;
    if (long) hints.push(`${long} session(s) grew past 120k tokens of context. Delegate searches and test runs to rails-explorer / rails-test-runner, or /compact earlier.`);
    const sub = [...s.by.step.entries()].filter(([n]) => n.startsWith('subagent')).reduce((n, [, a]) => n + a.requests, 0);
    if (s.total.requests > 40 && sub / s.total.requests < 0.1) hints.push('Subagents handle under 10% of requests. The main agent is probably reading files and test logs itself, which grows every later request.');
  }
  if (st.agents > 2500) hints.push(`AGENTS.md is ~${k(st.agents)} tokens. Keep only always-needed rules there and move step-specific detail into the /rails-* commands or docs/guides (loaded only when used). Run \`devrailsv2 update\` after upgrading devrailsv2.`);
  if (hints.length) {
    console.log(`\n${c.bold('Where to look')}`);
    for (const h of hints) log.warn(h);
  }
  console.log(c.dim('\nCosts are estimates from list prices (override in .rails/config.json → usage.prices). On a subscription, watch tokens and limits rather than dollars. GitHub Copilot does not expose token counts.'));
  return 0;
}
