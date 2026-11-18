import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, initRepo, tmpDir } from './helpers.js';
import { encodeProjectPath, costOf, DEFAULT_PRICES } from '../src/usage.js';

const Y = String(new Date().getFullYear());
const now = new Date().toISOString();
const asst = (o) => JSON.stringify({ type: 'assistant', sessionId: o.session, gitBranch: o.branch, timestamp: now, requestId: o.req, isSidechain: !!o.side, message: { id: o.id, model: o.model, usage: { input_tokens: o.input ?? 10, output_tokens: o.output ?? 100, cache_creation_input_tokens: o.write ?? 0, cache_read_input_tokens: o.read ?? 0 } } });
const cmd = (session, name) => JSON.stringify({ type: 'user', sessionId: session, timestamp: now, message: { content: `<command-name>/${name}</command-name>` } });

function fakeLogs(repo) {
  const projects = tmpDir('projects');
  const dir = path.join(projects, encodeProjectPath(repo));
  fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
  const b = `rfc/${Y}-001-totals`;
  fs.writeFileSync(path.join(dir, 's1.jsonl'), [
    cmd('s1', 'rails-ticket'),
    asst({ session: 's1', branch: 'main', id: 'm1', req: 'r1', model: 'claude-opus-5-5', write: 20000, read: 0 }),
    asst({ session: 's1', branch: 'main', id: 'm1', req: 'r1', model: 'claude-opus-5-5', write: 20000, read: 0 }), // duplicate line of the same response
    cmd('s1', 'rails-implement'),
    asst({ session: 's1', branch: b, id: 'm2', req: 'r2', model: 'claude-sonnet-5-5', read: 20000, write: 2000 }),
    asst({ session: 's1', branch: b, id: 'm3', req: 'r3', model: '<synthetic>', input: 0, output: 0 }),
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-abc.jsonl'), asst({ session: 's1', branch: b, id: 'm4', req: 'r4', model: 'claude-haiku-5-5', side: true, read: 5000, write: 1000 }));
  fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-abc.meta.json'), JSON.stringify({ agentType: 'rails-explorer' }));
  // another repo's logs must be ignored
  fs.mkdirSync(path.join(projects, '-somewhere-else'));
  fs.writeFileSync(path.join(projects, '-somewhere-else', 'x.jsonl'), asst({ session: 'x', branch: 'main', id: 'z', req: 'z', model: 'claude-opus-5-5', input: 999999 }));
  return projects;
}

test('cost estimate uses cache multipliers', () => {
  const c = costOf({ input: 1e6, output: 0, cacheWrite: 1e6, cacheRead: 1e6 }, 'claude-sonnet-x', DEFAULT_PRICES);
  assert.equal(Number(c.toFixed(4)), Number((3 + 3 * 1.25 + 3 * 0.1).toFixed(4)));
  assert.equal(costOf({ input: 1, output: 1, cacheWrite: 0, cacheRead: 0 }, 'something-new', DEFAULT_PRICES), null);
});

test('usage attributes tokens to RFCs, steps, subagents and models', () => {
  const dir = initRepo('usage');
  const env = { DEVRAILS_CLAUDE_PROJECTS: fakeLogs(dir) };
  const j = JSON.parse(cli(dir, ['usage', '--json'], { env }).out);
  assert.equal(j.total.requests, 3, 'duplicates and synthetic entries are dropped, other repos ignored');
  assert.equal(j.byRfc[`RFC-${Y}-001`].requests, 2);
  assert.ok(j.byStep['/rails-ticket'] && j.byStep['/rails-implement'] && j.byStep['subagent: rails-explorer']);
  assert.equal(j.byModel['claude-haiku-5-5'].requests, 1);
  assert.equal(j.startContext, 20010);
  assert.ok(j.static.agents > 500 && j.static.sections.length > 3);

  const text = cli(dir, ['usage'], { env }).out;
  assert.match(text, /By RFC/);
  assert.match(text, /subagent: rails-explorer/);
  assert.match(text, /a new session starts at ~20\.0k tokens/);
  assert.equal(JSON.parse(cli(dir, ['usage', '--json', '--rfc', '1'], { env }).out).total.requests, 2);
});

test('usage without logs explains where it looked', () => {
  const dir = initRepo('usage-empty');
  const r = cli(dir, ['usage'], { env: { DEVRAILS_CLAUDE_PROJECTS: tmpDir('none') } });
  assert.equal(r.code, 0);
  assert.match(r.out, /No Claude Code sessions found/);
  assert.match(r.out, /AGENTS\.md ~/);
});
