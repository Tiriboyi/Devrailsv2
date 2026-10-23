// Claude Code hooks.
//  PreToolUse:   exit 0 = allow, exit 2 = block (stderr is shown to Claude so it can correct course)
//  SessionStart: stdout is added to Claude's context
import path from 'node:path';
import { findRoot, exists, read, toPosix, matchAny, matchAffects, CLI } from '../util.js';
import { loadConfig, getActiveRfcId, FREE_PATHS, PROTECTED_PATHS } from '../config.js';
import { getRfc, acCoverage, isSetupKey } from '../docs.js';
import { splitFrontmatter } from '../frontmatter.js';
import { isSerenaTool, classifySerenaTool, serenaToolName, serenaTargets } from '../serena.js';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const ch of process.stdin) chunks.push(ch);
  return Buffer.concat(chunks).toString('utf8');
}

export function bashRules(cfg) {
  const label = cfg.approval?.prLabel || 'rfc-approved';
  return [
    { re: /\brfc\s+(approve|reject)\b/, msg: 'Approving or rejecting an RFC is a human action. Ask the user to do it.' },
    { re: new RegExp(`\\b${label.replace(/[-]/g, '\\-')}\\b`), msg: `Adding or removing the "${label}" label is a human action.` },
    { re: /--no-verify\b|\bgit\s+commit\b[^|;&\n]*\s-n\b/, msg: 'Skipping git hooks (--no-verify) is not allowed.' },
    { re: /core\.hooksPath/, msg: 'Changing core.hooksPath is not allowed.' },
    { re: /(?:>{1,2}|\btee\b|\bsed\s+-i|\bperl\s+-[a-z]*i|\b(?:cp|mv|rm)\b)[^|;&\n]*(docs\/rfc\/|\.rails\/(config\.json|tool\/)|\.githooks\/|\.claude\/settings\.json)/, msg: 'Writing to RFCs or devrailsv2 tooling from the shell is not allowed. Use the editor tools (RFCs) or ask the user (tooling).' },
    { re: /\bgit\s+push\b[^|;&\n]*\s(--force|-f)\b[^|;&\n]*\b(main|master)\b/, msg: 'Force-pushing to the main branch is not allowed.' },
  ];
}

function block(msg) {
  process.stderr.write(`devrailsv2 blocked this action: ${msg}\n`);
  return 2;
}

/** The file content after the tool call, or null if the edit would not apply. */
function applyEdits(current, tool, ti) {
  if (tool === 'Write') return String(ti.content ?? '');
  const edits = tool === 'MultiEdit' ? ti.edits || [] : [ti];
  let t = current;
  for (const e of edits) {
    if (e.old_string == null) continue;
    if (!t.includes(e.old_string)) return null;
    t = e.replace_all ? t.split(e.old_string).join(e.new_string ?? '') : t.replace(e.old_string, () => e.new_string ?? '');
  }
  return t;
}
const filled = (v) => !(v === null || v === undefined || v === '' || /^(null|~)$/i.test(String(v)));
function approvalState(text) {
  const fm = splitFrontmatter(text || '').fm || {};
  return { status: String(fm.status ?? '').toLowerCase(), by: filled(fm.approved_by) ? String(fm.approved_by) : '', on: filled(fm.approved_on) ? String(fm.approved_on) : '' };
}

/** Agents may draft and edit draft RFCs; status, approved_by and approved_on are human-only; approved RFCs are frozen. */
function rfcEditDecision(rel, current, next) {
  if (next === null) return { allow: true };
  const before = current === null ? null : approvalState(current);
  const after = approvalState(next);
  const humanMsg = 'Only a human can approve or reject an RFC (status, approved_by, approved_on). Leave status: draft and ask the user to run `devrailsv2 rfc approve`.';
  if (!before || ['', 'draft'].includes(before.status)) {
    if (after.status && after.status !== 'draft') return { block: humanMsg };
    if ((after.by && after.by !== before?.by) || (after.on && after.on !== before?.on)) return { block: humanMsg };
    return { allow: true };
  }
  if (after.status === 'draft') return { allow: true }; // revoking sends it back for re-approval
  return { block: `${rel} is ${before.status} and frozen. To change it, set "status: draft" (this revokes approval) and ask the user to re-approve, or draft a new RFC.` };
}

/** Approved, active, non-setup RFC required. Returns { rfc } or { block }. */
function requireActiveRfc(root, what) {
  const active = getActiveRfcId(root);
  if (!active) {
    return { block: `There is no active RFC, so ${what} cannot be changed. Draft one (${CLI} rfc new "<title>"), stop and ask the user to approve it, then run ${CLI} rfc start <id>.` };
  }
  const rfc = getRfc(root, active);
  if (!rfc) return { block: `The active RFC-${active} does not exist in docs/rfc/.` };
  if (rfc.status !== 'approved') {
    return { block: `RFC-${active} is "${rfc.status}". Code can only change after a human approves it. Stop and ask the user.` };
  }
  return { rfc };
}

/** The rule for changing one repo-relative path (anything except RFC documents). */
function gatePath(root, cfg, rel) {
  if (matchAny(rel, PROTECTED_PATHS)) {
    return { block: `${rel} is devrailsv2 tooling/agent configuration and is protected. Ask the user to change it.` };
  }
  if (matchAny(rel, FREE_PATHS)) return { allow: true };
  const r = requireActiveRfc(root, rel);
  if (r.block) return r;
  const { rfc } = r;
  if (isSetupKey(rfc.key) && !matchAffects(rel, rfc.affects)) {
    return { block: `RFC-${rfc.key} only covers the devrailsv2 setup. Draft a new RFC for this change.` };
  }
  if (cfg.strictness === 'strict' && rfc.affects.length && !matchAffects(rel, rfc.affects) && !matchAny(rel, cfg.paths.tests) && !rel.startsWith('docs/') && rel !== 'CHANGELOG.md') {
    return { block: `${rel} is outside RFC-${rfc.key}'s affected_areas (${rfc.affects.join(', ')}). Set the RFC back to draft, update it and ask for re-approval.` };
  }
  return { allow: true };
}

function toRel(root, file) {
  const rel = toPosix(path.relative(root, path.resolve(root, String(file))));
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel || '.';
}

function bashDecision(cfg, cmd) {
  for (const r of bashRules(cfg)) if (r.re.test(String(cmd || ''))) return { block: r.msg };
  return { allow: true };
}

/** Serena MCP tools: reads pass; edits go through the same RFC gate as the built-in tools. */
function serenaDecision(root, cfg, tool, ti) {
  const kind = classifySerenaTool(tool);
  const name = serenaToolName(tool);
  if (kind === 'read' || kind === 'memory') return { allow: true };
  if (kind === 'blocked') return { block: `Serena's ${name} is disabled by devrailsv2 (it can change files or configuration without review).` };
  if (kind === 'shell') return bashDecision(cfg, ti.command);

  const targets = serenaTargets(ti).map((t) => toRel(root, t));
  if (targets.some((t) => t === null)) return { block: `Serena's ${name} points outside the repository.` };
  const containsProtected = (rel) => PROTECTED_PATHS.some((g) => g.replace(/\/\*\*$/, '').startsWith(`${rel}/`));
  for (const rel of targets) {
    if (rel.startsWith('docs/rfc') || 'docs/rfc/'.startsWith(`${rel}/`)) return { block: `Edit RFCs with the normal editor tools, not Serena's ${name}, so approval fields can be checked.` };
    if (rel !== '.' && (matchAny(rel, PROTECTED_PATHS) || containsProtected(rel))) {
      return { block: `${rel} is devrailsv2 tooling/agent configuration and is protected. Ask the user to change it.` };
    }
  }

  if (kind === 'file-edit') {
    if (!targets.length) return { block: `Serena's ${name} was called without relative_path.` };
    for (const rel of targets) {
      const d = gatePath(root, cfg, rel);
      if (d.block) return d;
    }
    return { allow: true };
  }

  // multi-file edits (rename, move, replace_in_files, unknown edit tools)
  if (name === 'replace_in_files' && (!targets.length || targets[0] === '.')) {
    return { block: 'replace_in_files across the whole repository could touch RFCs and tooling. Pass relative_path for the folder to change (e.g. src/billing).' };
  }
  const r = requireActiveRfc(root, `code (via Serena's ${name})`);
  if (r.block) return r;
  if (isSetupKey(r.rfc.key)) return { block: `RFC-${r.rfc.key} only covers the devrailsv2 setup. Draft a new RFC for this change.` };
  for (const rel of targets) {
    const d = gatePath(root, cfg, rel);
    if (d.block) return d;
  }
  return { allow: true, note: `${name} may change files that reference the symbol; CI checks the final scope.` };
}

export function decide(root, cfg, input) {
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};

  if (tool === 'Bash') return bashDecision(cfg, ti.command);
  if (isSerenaTool(tool)) return serenaDecision(root, cfg, tool, ti);

  const file = ti.file_path || ti.notebook_path;
  if (!file) return { allow: true };
  const rel = toRel(root, file);
  if (rel === null) return { allow: true }; // outside the repo

  if (rel.startsWith('docs/rfc/')) {
    const abs = path.join(root, rel);
    const current = exists(abs) ? read(abs) : null;
    return rfcEditDecision(rel, current, applyEdits(current ?? '', tool, ti));
  }
  return gatePath(root, cfg, rel);
}

function sessionContext(root, cfg) {
  const lines = [`[devrailsv2] Mode: ${cfg.mode}, strictness: ${cfg.strictness}. Follow AGENTS.md: no code changes without an approved RFC; tests first.`];
  const active = getActiveRfcId(root);
  const rfc = active ? getRfc(root, active) : null;
  if (rfc) {
    lines.push(`Active RFC: RFC-${rfc.key} "${rfc.title}" — ${rfc.status}${rfc.type === 'fast-track' ? ' (fast-track)' : ''}.`);
    if (!isSetupKey(rfc.key)) {
      const cov = acCoverage(root, cfg, rfc.key);
      if (cov) lines.push(`Acceptance criteria: ${cov.rows.length}, ${cov.missing.length} without tests${cov.missing.length ? ` (${cov.missing.join(', ')})` : ''}. Tests reference them as RFC-${rfc.key}:AC-n.`);
    }
  } else lines.push('No active RFC. Any code change needs a new RFC approved by the user first.');
  const statusFile = path.join(root, 'docs/STATUS.md');
  if (exists(statusFile)) {
    const m = read(statusFile).match(/## Next step\s*\n([\s\S]*?)(?:\n## |$)/);
    if (m && m[1].trim()) lines.push(`Next step (docs/STATUS.md): ${m[1].trim().split('\n').slice(0, 4).join(' ')}`);
  }
  return lines.join('\n');
}

export default async function hook({ pos }) {
  const kind = pos[0];
  const raw = await readStdin();
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const root = findRoot(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const cfg = loadConfig(root, { optional: true });
  if (!cfg) return 0; // not a devrailsv2 repo: never block

  if (kind === 'session-start') {
    console.log(sessionContext(root, cfg));
    return 0;
  }
  if (kind === 'claude' || kind === 'pre-tool-use') {
    const d = decide(root, cfg, input);
    return d.block ? block(d.block) : 0;
  }
  throw new Error('Usage: devrailsv2 hook claude|session-start');
}
