import { readJson, closePrompts, PKG_ROOT, c } from './util.js';
import path from 'node:path';

const BOOL = new Set([
  'yes', 'force', 'dry-run', 'fast-track', 'no-serena', 'keep-assets', 'no-images', 'azure', 'run-tests', 'staged', 'ci', 'json', 'branch', 'help', 'version', 'no-git', 'no-branch', 'quiet',
]);

export function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-y') flags.yes = true;
    else if (a === '-h') flags.help = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
      let v = eq > 0 ? a.slice(eq + 1) : undefined;
      if (v === undefined) {
        if (BOOL.has(k) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) v = true;
        else v = argv[++i];
      }
      flags[k] = v;
    } else pos.push(a);
  }
  return { pos, flags };
}

const HELP = `
${c.bold('devrailsv2')} — spec-driven, test-first guardrails for AI coding agents

${c.bold('Setup')}
  init                      Interactive setup: new repo, existing repo, or migration
  auth [test]               Choose/change how tickets are fetched (GitHub / Azure DevOps)
  update                    Refresh tooling, hooks, prompts and managed instruction blocks
  doctor                    Check that hooks, tooling, auth and Serena are in place
  serena enable|disable     Connect Serena (MCP code intelligence) for Claude Code and Copilot
  serena status             Show the Serena setup and how its tools are gated

${c.bold('Workflow')}
  ticket <id>               Fetch a ticket + screenshots into docs/analysis/ (gh:123, ado:456, or 123)
                            [--keep-assets] commit screenshots  [--no-images]
  ticket lint <id>          Is the ticket complete enough for an agent? (exit 1 if not)
  ticket templates --azure  Create Azure DevOps work item templates   [--team "<team>"] [--dry-run]
  rfc new "<title>"         Draft a Request for Change   [--ticket id] [--affects globs] [--fast-track]
  rfc list | show <id>      List or print RFCs (ids: RFC-2026-001, 2026-001 or 1)
  rfc lint [id]             Check an RFC against the required format
  rfc start <id>            Make an approved RFC active and switch to its branch
  rfc approve <id>          Human only: approve an RFC (sets status, approved_by, approved_on)
  rfc reject <id>           Human only: reject an RFC   [--reason "…"]
  spec new [--rfc id]       Optional spec detailing an approved RFC's acceptance criteria
  spec show [id]            Acceptance-criteria coverage by tests
  adr new "<title>"         Record an architecture decision
  done [--rfc id]           Write the change record, CHANGELOG and STATUS   [--run-tests]
  status                    Where are we: active RFC, AC coverage, next step

${c.bold('Gate')}
  check                     Full check of current work against the base branch
  check --staged            Pre-commit check
  check --commit-msg <file> Commit message check
  check --ci                Pull-request gate (GitHub Actions / Azure Pipelines)
  hook claude|session-start Claude Code hooks (reads JSON on stdin)

Global: --yes (non-interactive)  --force  --dry-run
`;

export async function main(argv) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos.shift();
  if (flags.version || cmd === 'version') {
    console.log(readJson(path.join(PKG_ROOT, 'package.json'))?.version ?? 'unknown');
    return 0;
  }
  if (!cmd || cmd === 'help' || (flags.help && !cmd)) {
    console.log(HELP);
    return 0;
  }
  const commands = {
    init: () => import('./commands/init.js'),
    auth: () => import('./commands/auth.js'),
    update: () => import('./commands/update.js'),
    doctor: () => import('./commands/doctor.js'),
    serena: () => import('./commands/serena.js'),
    ticket: () => import('./commands/ticket.js'),
    rfc: () => import('./commands/rfc.js'),
    spec: () => import('./commands/spec.js'),
    adr: () => import('./commands/adr.js'),
    done: () => import('./commands/done.js'),
    status: () => import('./commands/status.js'),
    check: () => import('./commands/check.js'),
    hook: () => import('./commands/hook.js'),
  };
  if (!commands[cmd]) {
    console.error(`Unknown command "${cmd}".\n${HELP}`);
    return 1;
  }
  try {
    const mod = await commands[cmd]();
    return await mod.default({ pos, flags });
  } finally {
    closePrompts();
  }
}
