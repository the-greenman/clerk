// The programme's settings: ONE record of com.semanticops.programme/programme in the programme repo. Code reads it here, never hard-codes it.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { srsCli, srs } from './cli.mjs';

export const SETTINGS_TYPE = 'com.semanticops.programme/programme';
const camel = (s) => s.replace(/_(\w)/g, (_, c) => c.toUpperCase());

// Pure: the record's fieldValues -> {title, githubOwner, governedRepos, repos, reportIssue, ...}. Throws unless there is exactly one record.
export function settingsFrom(records, repo = '') {
  if (records.length !== 1) throw new Error(`${repo || 'programme repo'} needs exactly one ${SETTINGS_TYPE} record (settings); found ${records.length}`);
  const fv = records[0].record.fieldValues ?? {};
  const s = Object.fromEntries(Object.entries(fv).map(([k, v]) => [camel(k === 'programme_title' ? 'title' : k), v]));
  return { ...s, repos: fv.governed_repos ?? [] };
}

export function loadSettings(repo, cli = srsCli(repo)) {
  const out = srs(cli, repo, ['record', 'list', '--type', SETTINGS_TYPE]);
  return settingsFrom(out.records ?? out.instances ?? [], repo);
}

// "repo#n" -> {repo, number, path: "<owner>/<repo>/issues/<n>"}
export function issueRef(ref, owner) {
  const m = /^([\w.-]+)#(\d+)$/.exec(ref ?? '');
  if (!m) throw new Error(`settings issue "${ref}" is not <repo>#<n>`);
  return { repo: m[1], number: Number(m[2]), path: `${owner}/${m[1]}/issues/${m[2]}` };
}

// The programme repo itself: slug from its origin remote, worktree base ~/dev/.wt/<name>, default branch from origin/HEAD (else gh).
export function programmeRepo(repo) {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const slug = git('remote', 'get-url', 'origin').replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, '$1');
  const name = slug.split('/')[1];
  let defaultBranch;
  try { defaultBranch = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, ''); }
  catch { defaultBranch = execFileSync('gh', ['api', `repos/${slug}`, '--jq', '.default_branch'], { encoding: 'utf8' }).trim(); }
  return { slug, name, defaultBranch, wtBase: join(homedir(), 'dev/.wt', name) };
}
