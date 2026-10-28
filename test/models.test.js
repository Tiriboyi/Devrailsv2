import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cli, initRepo, hook, read } from './helpers.js';

const fmModel = (text) => (text.match(/^---\n[\s\S]*?^model: (.*)$[\s\S]*?^---$/m) || [])[1] ?? null;

test('init routes each step to a model and writes the helper subagents', () => {
  const dir = initRepo('models');
  assert.equal(fmModel(read(dir, '.claude/commands/rails-ticket.md')), 'opus');
  assert.equal(fmModel(read(dir, '.claude/commands/rails-implement.md')), 'sonnet');
  assert.equal(fmModel(read(dir, '.claude/commands/rails-status.md')), 'haiku');
  assert.equal(fmModel(read(dir, '.github/prompts/rails-ticket.prompt.md')), null, 'Copilot uses the picker until names are configured');

  const explorer = read(dir, '.claude/agents/rails-explorer.md');
  assert.match(explorer, /^name: rails-explorer$/m);
  assert.match(explorer, /^model: haiku$/m);
  assert.match(explorer, /^disallowedTools: Edit, Write, MultiEdit, NotebookEdit, Bash$/m);
  assert.doesNotMatch(explorer, /mcp__serena__/, 'no Serena tools when Serena is off');
  assert.match(read(dir, '.claude/agents/rails-test-runner.md'), /^model: haiku$/m);
  assert.match(read(dir, '.claude/agents/rails-reviewer.md'), /^model: opus$/m);
  assert.match(read(dir, '.claude/agents/rails-test-runner.md'), /npm test/);
  assert.match(read(dir, '.github/agents/rails-reviewer.agent.md'), /^tools: \["read", "search"\]$/m);
  assert.match(read(dir, 'AGENTS.md'), /\| subagent `rails-explorer` \| haiku \| picker \|/);
});

test('models set / off / on / reset regenerate commands, agents and AGENTS.md', () => {
  const dir = initRepo('models-set', ['--serena']);
  assert.match(read(dir, '.claude/agents/rails-explorer.md'), /mcp__serena__find_referencing_symbols/);

  assert.equal(cli(dir, ['models', 'set', 'implement', 'haiku']).code, 0);
  assert.equal(fmModel(read(dir, '.claude/commands/rails-implement.md')), 'haiku');
  assert.match(read(dir, 'AGENTS.md'), /\| `\/rails-implement` \| haiku \|/);

  assert.equal(cli(dir, ['models', 'set', 'ticket', '--copilot', 'Big A (copilot), Big B (copilot)']).code, 0);
  assert.equal(fmModel(read(dir, '.github/prompts/rails-ticket.prompt.md')), '"Big A (copilot)"');
  assert.equal(cli(dir, ['models', 'set', 'explorer', '--copilot', 'Fast (copilot)']).code, 0);
  assert.match(read(dir, '.github/agents/rails-explorer.agent.md'), /^model: \["Fast \(copilot\)"\]$/m);

  assert.notEqual(cli(dir, ['models', 'set', 'implement', 'gpt']).code, 0);
  assert.notEqual(cli(dir, ['models', 'set', 'nonsense', 'haiku']).code, 0);

  assert.equal(cli(dir, ['models', 'off']).code, 0);
  assert.equal(fmModel(read(dir, '.claude/commands/rails-ticket.md')), null);
  assert.match(read(dir, '.claude/agents/rails-explorer.md'), /^model: inherit$/m);
  assert.match(read(dir, 'AGENTS.md'), /Model routing is off/);

  assert.equal(cli(dir, ['models', 'reset']).code, 0);
  assert.equal(fmModel(read(dir, '.claude/commands/rails-implement.md')), 'sonnet');
});

test('--no-models starts with routing off; agents cannot edit their own definitions', () => {
  const dir = initRepo('no-models', ['--no-models']);
  assert.equal(fmModel(read(dir, '.claude/commands/rails-ticket.md')), null);
  for (const f of ['.claude/agents/rails-explorer.md', '.claude/commands/rails-ticket.md', '.github/agents/rails-reviewer.agent.md', '.github/prompts/rails-rfc.prompt.md']) {
    assert.equal(hook(dir, { tool_name: 'Edit', tool_input: { file_path: f, old_string: 'a', new_string: 'b' } }).code, 2, f);
  }
});
