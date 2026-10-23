import { findRoot, isGitRepo, git, log } from '../util.js';
import { loadConfig } from '../config.js';
import { generate, printActions } from '../scaffold.js';

export default async function update({ flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  const actions = generate(root, cfg, { dryRun: !!flags['dry-run'] });
  printActions(actions, log);
  if (!flags['dry-run'] && isGitRepo(root)) git(['config', 'core.hooksPath', '.githooks'], root);
  log.info('User-owned files (STATUS, workflow, PR template) were kept. Managed blocks and tool-owned files were refreshed.');
  return 0;
}
