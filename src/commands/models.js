import { findRoot, log, c } from '../util.js';
import { loadConfig, saveConfig } from '../config.js';
import { generate } from '../scaffold.js';
import { modelsFor, defaultModelsConfig, TASKS, CLAUDE_MODELS } from '../models.js';

const WHAT = {
  ticket: '/rails-ticket (analysis)', rfc: '/rails-rfc', spec: '/rails-spec', implement: '/rails-implement', done: '/rails-done',
  status: '/rails-status', explorer: 'rails-explorer subagent', testRunner: 'rails-test-runner subagent', reviewer: 'rails-reviewer subagent',
};

function show(cfg) {
  const m = modelsFor(cfg);
  console.log(`${c.bold('Model routing')}  ${m.enabled ? c.green('on') : c.yellow('off (everything uses the session model)')}`);
  for (const t of TASKS) console.log(`  ${t.padEnd(11)} ${m.claude[t].padEnd(8)} ${c.dim(m.copilot[t].join(' → ') || 'Copilot: picker')}  ${c.dim(WHAT[t])}`);
}

function regenerate(root, cfg) {
  saveConfig(root, cfg);
  const changed = generate(root, cfg).filter((a) => !/kept|unchanged/.test(a.act));
  log.ok(`Updated ${changed.length} file(s). Commit them with an RFC (they are devrailsv2 tooling).`);
}

export default async function models({ pos, flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  cfg.models ??= defaultModelsConfig();
  const sub = pos[0] || 'show';

  if (sub === 'show') return show(cfg), 0;
  if (sub === 'on' || sub === 'off') {
    cfg.models.enabled = sub === 'on';
    regenerate(root, cfg);
    return show(cfg), 0;
  }
  if (sub === 'reset') {
    cfg.models = defaultModelsConfig();
    regenerate(root, cfg);
    return show(cfg), 0;
  }
  if (sub === 'set') {
    const [task, model] = pos.slice(1);
    if (!TASKS.includes(task)) throw new Error(`Unknown step "${task}". Steps: ${TASKS.join(', ')}.`);
    if (flags.copilot) {
      const names = flags.copilot === true ? [] : String(flags.copilot).split(',').map((s) => s.trim()).filter(Boolean);
      cfg.models.copilot ??= {};
      cfg.models.copilot[task] = names;
    } else {
      if (!CLAUDE_MODELS.includes(model)) throw new Error(`Usage: devrailsv2 models set <step> <${CLAUDE_MODELS.join('|')}>   or   models set <step> --copilot "Model A (copilot), Model B (copilot)"`);
      cfg.models.claude ??= {};
      cfg.models.claude[task] = model;
    }
    regenerate(root, cfg);
    return show(cfg), 0;
  }
  throw new Error('Usage: devrailsv2 models [show | set <step> <model> | set <step> --copilot "<names>" | on | off | reset]');
}
