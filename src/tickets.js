// Ticket structure: sections, kind (bug / feature / ui), readiness for an AI agent, and screenshots.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = /^\s*(_?no response_?|n\/?a|none|-+|tbd|todo|\.\.\.|<!--[\s\S]*?-->)?\s*$/i;

/** "### Heading\ncontent" sections (GitHub issue forms render exactly like this; ADO headings are converted). */
export function parseSections(md = '') {
  const out = [];
  let cur = null;
  for (const line of String(md).split(/\r?\n/)) {
    const h = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/) || line.match(/^\*\*([^*]{2,80})\*\*:?\s*$/);
    if (h) {
      cur = { title: h[1].trim(), body: [] };
      out.push(cur);
    } else if (cur) cur.body.push(line);
  }
  return out.map((s) => ({ title: s.title, body: s.body.join('\n').trim() }));
}

const filled = (s) => !!s && !EMPTY.test(s.replace(/<!--[\s\S]*?-->/g, ''));

export function extractImages(text = '') {
  const urls = [];
  const add = (u) => {
    const url = String(u).trim().replace(/&amp;/g, '&');
    if (/^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
  };
  for (const m of String(text).matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) add(m[1]);
  for (const m of String(text).matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  return urls;
}

const DESIGN_LINK = /https?:\/\/(?:www\.)?(?:figma\.com|zeplin\.io|xd\.adobe\.com|miro\.com|sketch\.com)\S*/i;

export function detectKind({ labels = [], type = '', tags = '', area = '', sections = [] } = {}) {
  const hay = [...labels, type, tags, area].join(' ').toLowerCase();
  const titles = sections.map((s) => s.title.toLowerCase()).join('|');
  if (/\b(ui|ux|frontend|front-end|design|css|layout|web ?ui|visual)\b/.test(hay) || /page or component|viewport/.test(titles)) return 'ui';
  if (/\b(bug|defect|incident|regression|issue type: bug)\b/.test(hay) || (/steps to reproduce/.test(titles) && /actual/.test(titles))) return 'bug';
  return 'feature';
}

// Each requirement: a label, which section titles satisfy it, whether it is required, and the question to ask when missing.
const REQ = {
  bug: [
    { name: 'Steps to reproduce', match: /steps|repro/, required: true, q: 'What are the exact steps to reproduce it (starting from which page/endpoint, with which data)?' },
    { name: 'Expected behaviour', match: /expected/, required: true, q: 'What should happen instead?' },
    { name: 'Actual behaviour', match: /actual|current|what happen/, required: true, q: 'What happens now (error message, wrong value, screenshot or log)?' },
    { name: 'Environment / version', match: /environment|version|browser|system info|platform/, required: true, q: 'In which environment and version does it happen (prod/test, app version, browser/OS)?' },
    { name: 'Acceptance criteria', match: /acceptance|fixed when|done when/, required: false, q: 'How will we know it is fixed?' },
  ],
  feature: [
    { name: 'Problem / user story', match: /problem|story|goal|summary|description|why/, required: true, q: 'Who needs this and what problem does it solve ("As a … I want … so that …")?' },
    { name: 'Acceptance criteria', match: /acceptance|done when/, required: true, q: 'What are the acceptance criteria (observable results that make this done)?' },
    { name: 'Out of scope', match: /out of scope|non-goals|not included/, required: false, q: 'What is explicitly out of scope?' },
    { name: 'Dependencies / open questions', match: /dependenc|open question|risk/, required: false, q: 'Are there dependencies or open decisions?' },
  ],
  ui: [
    { name: 'Page or component', match: /page|component|screen|route|url|where/, required: true, q: 'Which page, route or component is this about?' },
    { name: 'Current state', match: /current|actual|now/, required: true, q: 'What does it look like or do now? Please add a screenshot.' },
    { name: 'Expected result / design', match: /expected|design|mockup|should/, required: true, q: 'What should it look like? Please add a mockup, annotated screenshot or design link.' },
    { name: 'Screenshot or design link', image: true, required: true, q: 'Please attach a screenshot of the current state and, if available, the design (Figma or annotated image).' },
    { name: 'Viewports / browsers', match: /viewport|browser|device|breakpoint|screen size/, required: true, q: 'Which viewports, devices and browsers must it work on?' },
    { name: 'Acceptance criteria', match: /acceptance|done when/, required: true, q: 'What are the acceptance criteria (observable results that make this done)?' },
    { name: 'Accessibility', match: /accessib|a11y|keyboard|contrast/, required: false, q: 'Any accessibility requirements (keyboard use, contrast, screen reader labels)?' },
  ],
};

/** How ready is this ticket for an agent? Missing required parts become questions for the requester. */
export function readiness(ticket) {
  const sections = parseSections(ticket.body);
  const kind = ticket.kind || detectKind({ ...ticket, sections });
  const text = `${ticket.body}\n${ticket.acceptance || ''}`;
  const rows = REQ[kind].map((r) => {
    let ok;
    if (r.image) ok = (ticket.images?.length || 0) > 0 || DESIGN_LINK.test(text);
    else if (r.name === 'Acceptance criteria' && filled(ticket.acceptance || '')) ok = true;
    else if (r.name === 'Problem / user story' && /\bas an? .{2,80}\bi want\b/i.test(text)) ok = true;
    else ok = sections.some((s) => r.match.test(s.title.toLowerCase()) && filled(s.body));
    return { ...r, ok };
  });
  const missing = rows.filter((r) => r.required && !r.ok);
  const vague = [];
  if (String(ticket.body || '').trim().length < 40 && !sections.length) vague.push('The ticket body is very short and has no structure.');
  if (/\b(asap|etc\.?|and so on|something like|somehow|fix it|make it work|as discussed)\b/i.test(text)) vague.push('The ticket uses vague wording (e.g. "etc.", "as discussed", "make it work"); ask what exactly is meant.');
  return { kind, rows, missing, ready: !missing.length, vague, questions: [...missing.map((r) => r.q), ...rows.filter((r) => !r.required && !r.ok).map((r) => `(optional) ${r.q}`)] };
}

export function readinessMarkdown(r) {
  const table = ['| Part | Required | Present |', '|---|---|---|', ...r.rows.map((x) => `| ${x.name} | ${x.required ? 'yes' : 'no'} | ${x.ok ? '✅' : x.required ? '❌' : '—'} |`)].join('\n');
  const verdict = r.ready
    ? `**Ready for analysis** (detected type: ${r.kind}).`
    : `**Not ready** (detected type: ${r.kind}): ${r.missing.length} required part(s) missing. Ask the requester before drafting an RFC; do not guess.`;
  const qs = r.questions.length ? `\n\n**Questions for the requester**\n${r.questions.map((q) => `- ${q}`).join('\n')}` : '';
  const vague = r.vague.length ? `\n\n**Watch out**\n${r.vague.map((v) => `- ${v}`).join('\n')}` : '';
  return `${verdict}\n\n${table}${qs}${vague}`;
}

// ---------- downloading screenshots ----------
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };
export const MAX_IMAGES = 12;
export const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Downloads images into dir. Credentials are sent only to hosts for which authFor(url) returns headers,
 * and redirects are followed by hand so a token never travels to another host.
 */
export async function downloadImages(urls, dir, authFor = () => ({})) {
  const results = [];
  for (const [i, url] of urls.slice(0, MAX_IMAGES).entries()) {
    try {
      let current = url;
      let res;
      for (let hop = 0; hop < 5; hop++) {
        res = await fetch(current, { headers: authFor(current), redirect: 'manual' });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          current = new URL(res.headers.get('location'), current).toString();
          continue;
        }
        break;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!EXT[type]) throw new Error(`not an image (${type || 'unknown type'})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error('larger than 10 MB');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `image-${String(i + 1).padStart(2, '0')}.${EXT[type]}`);
      fs.writeFileSync(file, buf);
      results.push({ url, file });
    } catch (e) {
      results.push({ url, error: e.message });
    }
  }
  for (const url of urls.slice(MAX_IMAGES)) results.push({ url, error: `skipped (more than ${MAX_IMAGES} images)` });
  return results;
}

export function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}
