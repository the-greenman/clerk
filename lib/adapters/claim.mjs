// Claim I/O: read the issue, PRs, branches and affirmed problems; write assignee, label and comment through the GitHub REST API.
import { srsCli, srs, ghJson } from './cli.mjs';
import { isStaleBranch } from '../practice/claim.mjs';
import { addAssignees, addLabels, comment as postComment } from './github.mjs';

export function affirmedProblemIds(repo, cli = srsCli(repo)) {
  const c = srs(cli, repo, ['container', 'list']).containers.find((x) => x.title === 'Affirmed');
  if (!c) return new Set();
  const ids = new Set(srs(cli, repo, ['container', 'get', c.containerId]).container.memberInstanceIds.map((m) => m.instanceId));
  const rows = srs(cli, repo, ['record', 'list']);
  return new Set((rows.records ?? rows.instances ?? []).filter((r) => ids.has(r.instanceId) && r.record.typeName === 'problem').map((r) => r.record.fieldValues?.problem_id).filter(Boolean));
}

export function readIssue(owner, repo, n) {
  const i = ghJson(['api', `repos/${owner}/${repo}/issues/${n}`]);
  const prs = ghJson(['api', '--paginate', '--slurp', `repos/${owner}/${repo}/pulls?state=open&per_page=100`]).flat().map((p) => ({ ...p, repo }));
  const all = ghJson(['api', '--paginate', '--slurp', `repos/${owner}/${repo}/branches?per_page=100`]).flat().map((b) => b.name);
  // Only a branch that names this issue is looked at; an abandoned one is reported as stale, not as a hold (clerk claim).
  const def = ghJson(['api', `repos/${owner}/${repo}`]).default_branch, staleBranches = [];
  const branches = all.filter((name) => {
    if (!name.startsWith(`${n}-`)) return true;
    try {
      const c = ghJson(['api', `repos/${owner}/${repo}/compare/${def}...${encodeURIComponent(name)}`]);
      const last = c.commits?.at(-1)?.commit?.committer?.date ?? c.merge_base_commit?.commit?.committer?.date;
      if (!last || !isStaleBranch({ aheadBy: c.ahead_by, behindBy: c.behind_by, lastCommitAt: last }, Date.now())) return true;
      staleBranches.push(name); return false;
    } catch { return true; }
  });
  const timeline = ghJson(['api', '--paginate', '--slurp', `repos/${owner}/${repo}/issues/${n}/timeline?per_page=100`]).flat();
  return { issue: { ...i, repo, number: n, timeline }, prs, branches, staleBranches };
}

// Claim over REST: the in_progress label (claimLabel); reconcile moves the board column to match, since a claim label wins
// over an earlier column. assignee: the owner's login for the owner's own claim, else null (an agent claim never assigns, clerk#68).
export function writeClaim(owner, repo, n, assignee, comment, claimLabel) {
  const slug = `${owner}/${repo}`;
  if (assignee) addAssignees(slug, n, [assignee]);
  addLabels(slug, n, [claimLabel]);
  postComment(slug, n, comment);
}
