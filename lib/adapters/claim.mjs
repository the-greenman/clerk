// Claim I/O: read the issue, PRs, branches and affirmed problems; write assignee, label and comment through gh.
import { srsCli, srs, gh, ghJson } from './cli.mjs';

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
  const branches = ghJson(['api', '--paginate', '--slurp', `repos/${owner}/${repo}/branches?per_page=100`]).flat().map((b) => b.name);
  return { issue: { ...i, repo, number: n }, prs, branches };
}

// Set In progress the way the board does: the `status: in progress` label (reconcile mirrors it to the board Status).
export function writeClaim(owner, repo, n, assignee, comment) {
  gh(['issue', 'edit', String(n), '--repo', `${owner}/${repo}`, '--add-assignee', assignee, '--add-label', 'status: in progress']);
  gh(['issue', 'comment', String(n), '--repo', `${owner}/${repo}`, '--body', comment]);
}
