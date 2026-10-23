import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { cliAsync, initRepo, read } from './helpers.js';
import { parseSections, detectKind, readiness, extractImages } from '../src/tickets.js';

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/**
 * Mock server. route(key, base) returns JSON, a Buffer (served as PNG), { redirect } or undefined (404).
 * Every request is recorded with its Authorization header and body.
 */
function server(route) {
  const seen = [];
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const key = `${req.method} ${req.url.split('?')[0]}`;
        seen.push({ key, url: req.url, auth: req.headers.authorization || '', body: body ? JSON.parse(body) : null });
        const out = route(key, base);
        if (out === undefined) return res.writeHead(404).end('{}');
        if (Buffer.isBuffer(out)) return res.writeHead(200, { 'Content-Type': 'image/png' }).end(out);
        if (out.redirect) return res.writeHead(302, { Location: out.redirect }).end();
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
      });
    });
    let base;
    s.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${s.address().port}`;
      resolve({ close: () => s.close(), url: base, seen });
    });
  });
}

const UI_FORM = (img) => `### Page or component

/invoices/:id

### Type of change

Bug in existing UI

### Current state

The total is cut off on mobile.
<img width="375" alt="current" src="${img}">

### Expected result / design

Total stays visible.

### Steps to reproduce

_No response_

### Viewports / browsers

Mobile (< 768 px), Safari (iOS)

### Acceptance criteria

- Given a 375 px viewport, when I open an invoice, then the total is visible.
`;

test('sections, kind detection and image extraction', () => {
  const s = parseSections(UI_FORM('https://x/y.png'));
  assert.deepEqual(s.map((x) => x.title).slice(0, 3), ['Page or component', 'Type of change', 'Current state']);
  assert.equal(s.find((x) => x.title === 'Steps to reproduce').body, '_No response_');
  assert.equal(detectKind({ labels: ['frontend'] }), 'ui');
  assert.equal(detectKind({ type: 'Bug' }), 'bug');
  assert.equal(detectKind({ type: 'User Story', sections: s }), 'ui', 'UI form headings are enough');
  assert.equal(detectKind({ type: 'User Story' }), 'feature');
  assert.deepEqual(extractImages('a ![s](https://h/a.png "t") <img src="https://h/b.png?x=1&amp;y=2"> ![d](data:image/png;base64,xx)'), ['https://h/a.png', 'https://h/b.png?x=1&y=2']);
});

test('readiness: complete and incomplete tickets', () => {
  const ui = readiness({ labels: ['frontend'], body: UI_FORM('https://x/y.png'), images: ['https://x/y.png'] });
  assert.equal(ui.kind, 'ui');
  assert.ok(ui.ready, JSON.stringify(ui.missing));
  const noShot = readiness({ labels: ['frontend'], body: UI_FORM('https://x/y.png'), images: [] });
  assert.ok(!noShot.ready);
  assert.deepEqual(noShot.missing.map((m) => m.name), ['Screenshot or design link']);
  const figma = readiness({ labels: ['frontend'], body: `${UI_FORM('')}\nDesign: https://www.figma.com/file/abc`, images: [] });
  assert.ok(figma.ready, 'a design link counts');

  const bug = readiness({ type: 'Bug', body: 'Export is broken, fix it asap', images: [] });
  assert.equal(bug.kind, 'bug');
  assert.deepEqual(bug.missing.map((m) => m.name), ['Steps to reproduce', 'Expected behaviour', 'Actual behaviour', 'Environment / version']);
  assert.ok(bug.vague.length >= 1);

  const story = readiness({ type: 'User Story', body: 'As a clerk I want CSV export so that I can reconcile.', acceptance: '- Given…', images: [] });
  assert.ok(story.ready, 'user story sentence and the separate acceptance field count');
});

test('GitHub ticket: screenshots downloaded, token only sent to GitHub, readiness written', async () => {
  const other = await server((key) => (key === 'GET /other.png' ? PNG : undefined));
  const gh = await server((key, base) => {
    if (key === 'GET /repos/me/demo/issues/7') {
      return {
        number: 7, title: 'Total cut off on mobile', html_url: 'https://github.com/me/demo/issues/7', state: 'open', labels: [{ name: 'frontend' }], comments: 1,
        body: `${UI_FORM(`${base}/assets/shot.png`)}\n![external](${other.url}/other.png)\n`,
      };
    }
    if (key === 'GET /repos/me/demo/issues/7/comments') return [{ user: { login: 'anna' }, body: `Also here: ![again](${base}/assets/redirect.png)` }];
    if (key === 'GET /assets/shot.png') return PNG;
    if (key === 'GET /assets/redirect.png') return { redirect: `${other.url}/other.png` };
    return undefined;
  });
  const dir = initRepo('ticket-gh', ['--tracker', 'github', '--gh-repo', 'me/demo', '--gh-auth', 'token-env']);
  const r = await cliAsync(dir, ['ticket', '7'], { env: { DEVRAILS_GITHUB_API: gh.url, GITHUB_TOKEN: 'secret-token' } });
  gh.close();
  other.close();
  assert.equal(r.code, 0, r.out);
  const a = read(dir, 'docs/analysis/TICKET-gh-7.md');
  assert.match(a, /detected: ui/);
  assert.match(a, /\*\*Ready for analysis\*\*/);
  assert.match(a, /\*\*anna:\*\*/);
  assert.match(a, /Open every image file below/);
  for (const n of ['01', '02', '03']) assert.match(a, new RegExp(`\`\\.rails/runtime/tickets/gh-7/image-${n}\\.png\``));
  assert.equal(fs.readdirSync(path.join(dir, '.rails/runtime/tickets/gh-7')).length, 3);
  assert.ok(gh.seen.filter((x) => x.key.startsWith('GET /assets')).every((x) => x.auth === 'Bearer secret-token'), 'GitHub-hosted images get the token');
  assert.equal(other.seen.length, 2, 'direct link + redirect target');
  assert.ok(other.seen.every((x) => x.auth === ''), 'the token never reaches another host, also not via a redirect');
  assert.match(read(dir, '.gitignore'), /\.rails\/runtime\//, 'downloaded screenshots are not committed');
});

test('Azure DevOps ticket: attachments, inline images and comments; lint reports gaps', async () => {
  const ado = await server((key, base) => {
    if (key === 'GET /org/Proj/_apis/wit/workitems/41') {
      return {
        id: 41,
        fields: {
          'System.Title': 'Export fails',
          'System.State': 'Active',
          'System.WorkItemType': 'Bug',
          'Microsoft.VSTS.TCM.ReproSteps': `<h3>Steps to reproduce</h3><ol><li>Open invoices</li></ol><h3>Expected behaviour</h3><div>CSV</div><h3>Actual behaviour</h3><div>500 <img src="${base}/org/Proj/_apis/wit/attachments/aaa?fileName=inline.png"></div>`,
          'Microsoft.VSTS.TCM.SystemInfo': 'prod, v2.3',
        },
        relations: [
          { rel: 'AttachedFile', url: `${base}/org/Proj/_apis/wit/attachments/bbb`, attributes: { name: 'error.png' } },
          { rel: 'AttachedFile', url: `${base}/org/Proj/_apis/wit/attachments/ccc`, attributes: { name: 'log.txt' } },
        ],
      };
    }
    if (key === 'GET /org/Proj/_apis/wit/workItems/41/comments') return { comments: [{ createdBy: { displayName: 'Bob' }, text: '<div>Still broken</div>' }] };
    if (key.startsWith('GET /org/Proj/_apis/wit/attachments/')) return PNG;
    if (key === 'GET /org/Proj/_apis/wit/workitems/42') return { id: 42, fields: { 'System.Title': 'Make it better', 'System.WorkItemType': 'Bug', 'System.Description': 'Broken, fix it' } };
    return undefined;
  });
  const dir = initRepo('ticket-ado', ['--tracker', 'azure', '--ado-org', 'org', '--ado-project', 'Proj', '--ado-auth', 'pat-env']);
  const env = { DEVRAILS_ADO_URL: ado.url, AZURE_DEVOPS_PAT: 'pat' };

  const r = await cliAsync(dir, ['ticket', 'ado:41', '--keep-assets'], { env });
  assert.equal(r.code, 0, r.out);
  const a = read(dir, 'docs/analysis/TICKET-ado-41.md');
  assert.match(a, /detected: bug/);
  assert.match(a, /\*\*Ready for analysis\*\*/);
  assert.match(a, /\*\*Bob:\*\*\n> Still broken/);
  assert.match(a, /`docs\/analysis\/assets\/ado-41\/image-01\.png`/);
  assert.match(a, /`docs\/analysis\/assets\/ado-41\/image-02\.png`/);
  assert.match(a, /attachment \(not downloaded\): log\.txt/);
  const downloads = ado.seen.filter((x) => x.key.includes('/attachments/'));
  assert.equal(downloads.length, 2, 'the text attachment is not downloaded');
  assert.ok(downloads.every((x) => x.auth.startsWith('Basic ')));

  const lint = await cliAsync(dir, ['ticket', 'lint', 'ado:42'], { env });
  ado.close();
  assert.equal(lint.code, 1);
  assert.match(lint.out, /Ask the requester/);
  assert.match(lint.out, /exact steps to reproduce/);
});

test('Azure DevOps work item templates: dry run and creation', async () => {
  const ado = await server(() => ({}));
  const dir = initRepo('ado-tpl', ['--tracker', 'azure', '--ado-org', 'org', '--ado-project', 'Proj', '--ado-auth', 'pat-env']);
  const env = { DEVRAILS_ADO_URL: ado.url, AZURE_DEVOPS_PAT: 'pat' };
  const dry = await cliAsync(dir, ['ticket', 'templates', '--azure', '--dry-run'], { env });
  assert.equal(dry.code, 0, dry.out);
  assert.equal(JSON.parse(dry.out).length, 3);
  assert.equal(ado.seen.length, 0);
  const real = await cliAsync(dir, ['ticket', 'templates', '--azure', '--team', 'Billing Team'], { env });
  ado.close();
  assert.equal(real.code, 0, real.out);
  const posted = ado.seen;
  assert.equal(posted.length, 3);
  assert.ok(posted[0].url.startsWith('/org/Proj/Billing%20Team/_apis/wit/templates'));
  assert.equal(posted[0].body.workItemTypeName, 'Bug');
  assert.match(posted[0].body.fields['Microsoft.VSTS.TCM.ReproSteps'], /<h3>Steps to reproduce<\/h3>/);
  assert.equal(posted[2].body.fields['System.Tags'], 'frontend');
});

test('init writes GitHub issue forms and the ticket guide', async () => {
  const dir = initRepo('forms', ['--tracker', 'github', '--gh-repo', 'me/demo']);
  for (const f of ['bug.yml', 'feature.yml', 'ui.yml', 'config.yml']) assert.ok(fs.existsSync(path.join(dir, '.github/ISSUE_TEMPLATE', f)), f);
  assert.match(read(dir, '.github/ISSUE_TEMPLATE/ui.yml'), /label: Viewports \/ browsers/);
  assert.match(read(dir, 'docs/guides/ticket-format.md'), /ticket lint <id>/);
  const azureOnly = initRepo('forms-ado', ['--tracker', 'azure', '--ado-org', 'o', '--ado-project', 'p', '--ado-auth', 'pat-env']);
  assert.ok(!fs.existsSync(path.join(azureOnly, '.github/ISSUE_TEMPLATE')));
});
