import { findRoot, isInteractive, ask, select, run, git, log, c } from '../util.js';
import { loadConfig, saveConfig } from '../config.js';

const isWin = process.platform === 'win32';
export const az = (args) => run('az', args, { shell: isWin });

export function detectGithubRepo(root) {
  const url = git(['remote', 'get-url', 'origin'], root).stdout;
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/i);
  return m ? m[1] : '';
}
export function detectAzure(root) {
  const url = git(['remote', 'get-url', 'origin'], root).stdout;
  const m = url.match(/dev\.azure\.com[:/](?:v3\/)?([^/]+)\/([^/]+)\//i) || url.match(/([^/.]+)\.visualstudio\.com\/([^/]+)\//i);
  return m ? { org: decodeURIComponent(m[1]), project: decodeURIComponent(m[2]) } : {};
}

/** Asks (or reads flags) for tracker + auth. Tokens are never stored — only env var names. */
export async function configureTracker(root, flags = {}, current = {}) {
  const interactive = isInteractive(flags);
  const provider =
    flags.tracker ||
    (interactive
      ? await select('Where do your tickets live?', [
          { label: 'GitHub Issues', value: 'github' },
          { label: 'Azure DevOps Boards', value: 'azure' },
          { label: 'Both', value: 'both' },
          { label: 'None for now', value: 'none', hint: 'you can add one later with `devrailsv2 auth`' },
        ], current.provider || 'github')
      : current.provider || 'none');
  if (!['github', 'azure', 'both', 'none'].includes(provider)) throw new Error(`Unknown tracker "${provider}" (github | azure | both | none).`);

  const t = { provider, default: provider === 'both' ? 'github' : provider };

  if (provider === 'github' || provider === 'both') {
    const cur = current.github || {};
    const repo = flags['gh-repo'] || (interactive ? await ask('GitHub repository (owner/name)', cur.repo || detectGithubRepo(root)) : cur.repo || detectGithubRepo(root));
    const auth =
      flags['gh-auth'] ||
      (interactive
        ? await select('How should devrailsv2 authenticate to GitHub?', [
            { label: 'GitHub CLI', value: 'gh-cli', hint: 'recommended — uses `gh auth login`, nothing stored' },
            { label: 'Token in an environment variable', value: 'token-env', hint: 'good for CI or machines without gh' },
          ], cur.auth || 'gh-cli')
        : cur.auth || 'gh-cli');
    let tokenEnv = flags['gh-token-env'] || cur.tokenEnv || 'GITHUB_TOKEN';
    if (auth === 'token-env' && interactive && !flags['gh-token-env']) tokenEnv = await ask('Environment variable that holds the token', tokenEnv);
    t.github = { repo, auth, tokenEnv };
  }

  if (provider === 'azure' || provider === 'both') {
    const cur = current.azure || {};
    const det = detectAzure(root);
    const org = flags['ado-org'] || (interactive ? await ask('Azure DevOps organisation (the name in dev.azure.com/<org>)', cur.org || det.org || '') : cur.org || det.org || '');
    const project = flags['ado-project'] || (interactive ? await ask('Azure DevOps project', cur.project || det.project || '') : cur.project || det.project || '');
    const auth =
      flags['ado-auth'] ||
      (interactive
        ? await select('How should devrailsv2 authenticate to Azure DevOps?', [
            { label: 'Azure CLI', value: 'az-cli', hint: 'uses `az login` + azure-devops extension, nothing stored' },
            { label: 'Personal access token in an environment variable', value: 'pat-env', hint: 'Work Items (Read) scope is enough' },
          ], cur.auth || 'az-cli')
        : cur.auth || 'az-cli');
    let patEnv = flags['ado-pat-env'] || cur.patEnv || 'AZURE_DEVOPS_PAT';
    if (auth === 'pat-env' && interactive && !flags['ado-pat-env']) patEnv = await ask('Environment variable that holds the PAT', patEnv);
    t.azure = { org, project, auth, patEnv };
  }

  if (provider === 'both') {
    t.default = flags['default-tracker'] || (interactive
      ? await select('Default tracker when an id has no prefix?', [
          { label: 'GitHub', value: 'github' },
          { label: 'Azure DevOps', value: 'azure' },
        ], current.default || 'github')
      : current.default || 'github');
  }
  return t;
}

export async function testAuth(cfg) {
  const t = cfg.tracker || { provider: 'none' };
  let ok = true;
  if (t.provider === 'none') {
    log.info('No tracker configured. Run `devrailsv2 auth` to add one.');
    return true;
  }
  if (t.github) {
    if (t.github.auth === 'gh-cli') {
      const r = run('gh', ['auth', 'status']);
      if (r.error) (ok = false), log.err('GitHub: `gh` is not installed. Install it from https://cli.github.com or switch to token auth.');
      else if (!r.ok) (ok = false), log.err('GitHub: gh is not logged in. Run `gh auth login`.');
      else log.ok(`GitHub: gh CLI authenticated${t.github.repo ? ` (repo ${t.github.repo})` : ''}`);
    } else {
      const token = process.env[t.github.tokenEnv];
      if (!token) (ok = false), log.err(`GitHub: environment variable ${t.github.tokenEnv} is not set.`);
      else {
        try {
          const res = await fetch(`${githubApi(t.github)}/repos/${t.github.repo}`, { headers: ghHeaders(token) });
          if (res.ok) log.ok(`GitHub: token works for ${t.github.repo}`);
          else (ok = false), log.err(`GitHub: API returned ${res.status} for ${t.github.repo}`);
        } catch (e) {
          ok = false;
          log.err(`GitHub: ${e.message}`);
        }
      }
    }
  }
  if (t.azure) {
    if (t.azure.auth === 'az-cli') {
      const r = az(['account', 'show', '--output', 'none']);
      if (r.error) (ok = false), log.err('Azure DevOps: `az` is not installed. Install the Azure CLI, or switch to PAT auth.');
      else if (!r.ok) (ok = false), log.err('Azure DevOps: not logged in. Run `az login` (and `az extension add --name azure-devops`).');
      else log.ok(`Azure DevOps: az CLI authenticated (org ${t.azure.org}, project ${t.azure.project})`);
    } else {
      const pat = process.env[t.azure.patEnv];
      if (!pat) (ok = false), log.err(`Azure DevOps: environment variable ${t.azure.patEnv} is not set.`);
      else {
        try {
          const url = `${adoBase(t.azure)}/${encodeURIComponent(t.azure.org)}/_apis/projects/${encodeURIComponent(t.azure.project)}?api-version=7.1`;
          const res = await fetch(url, { headers: adoHeaders(pat) });
          if (res.ok) log.ok(`Azure DevOps: PAT works for ${t.azure.org}/${t.azure.project}`);
          else (ok = false), log.err(`Azure DevOps: API returned ${res.status}`);
        } catch (e) {
          ok = false;
          log.err(`Azure DevOps: ${e.message}`);
        }
      }
    }
  }
  return ok;
}

// Overridable for GitHub Enterprise Server / Azure DevOps Server (and tests).
export const githubApi = (gh = {}) => (gh.apiUrl || process.env.DEVRAILS_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
export const adoBase = (ado = {}) => (ado.baseUrl || process.env.DEVRAILS_ADO_URL || 'https://dev.azure.com').replace(/\/+$/, '');

export const ghHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'devrailsv2',
  'X-GitHub-Api-Version': '2022-11-28',
});
export const adoHeaders = (pat) => ({
  Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
  Accept: 'application/json',
});

export function describeTracker(t) {
  if (!t || t.provider === 'none') return 'none';
  const parts = [];
  if (t.github) parts.push(`GitHub ${t.github.repo || '(repo not set)'} via ${t.github.auth === 'gh-cli' ? 'gh CLI' : `$${t.github.tokenEnv}`}`);
  if (t.azure) parts.push(`Azure DevOps ${t.azure.org}/${t.azure.project} via ${t.azure.auth === 'az-cli' ? 'az CLI' : `$${t.azure.patEnv}`}`);
  return parts.join(' + ') + (t.provider === 'both' ? ` (default: ${t.default})` : '');
}

export default async function auth({ pos, flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  if (pos[0] === 'test') return (await testAuth(cfg)) ? 0 : 1;
  if (pos[0] === 'show') {
    log.info(`Tracker: ${describeTracker(cfg.tracker)}`);
    return 0;
  }
  cfg.tracker = await configureTracker(root, flags, cfg.tracker);
  saveConfig(root, cfg);
  log.ok(`Tracker set: ${describeTracker(cfg.tracker)}`);
  log.info(c.dim('Tokens are never written to the repo; only the environment variable name is stored.'));
  return (await testAuth(cfg)) ? 0 : 1;
}
