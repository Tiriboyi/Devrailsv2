import { findRoot, isGitRepo, git, log } from '../util.js';
import { loadConfig, saveConfig } from '../config.js';
import { generate, printActions } from '../scaffold.js';

export default async function update({ flags }) {
  const root = findRoot();
  const cfg = loadConfig(root);
  if ('serena' in cfg && !flags['dry-run']) {
    delete cfg.serena; // replaced by CodeSlice; generate() removes the Serena setup
    saveConfig(root, cfg);
  }
  const actions = generate(root, cfg, { dryRun: !!flags['dry-run'] });
  printActions(actions, log);
  if (!flags['dry-run'] && isGitRepo(root)) git(['config', 'core.hooksPath', '.githooks'], root);
  log.info('User-owned files (STATUS, workflow, PR template) were kept. Managed blocks and tool-owned files were refreshed.');
  return 0;
}
