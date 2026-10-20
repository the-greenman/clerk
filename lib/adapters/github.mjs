// GitHub I/O over repo-scoped REST endpoints only (`gh api repos/...`), so the clerk runs the same on a laptop, in Actions
// and in a Claude Code cloud session, which refuses GraphQL (so `gh issue|pr` porcelain) and the search API. Board sync
// (Projects v2) is GraphQL-only and stays in Actions. Nothing here knows about the agenda.
import { gh } from './cli.mjs';
import { signComment } from '../practice/pr-decisions.mjs';

// The session actor signs every comment the clerk posts (clerk#77): agents post with the owner's token.
const actorId = () => { try { return JSON.parse(process.env.SRS_ACTOR ?? 'null')?.id ?? null; } catch { return null; } };

const api = (method, path, fields = []) => gh(['api', '-X', method, path, ...fields.flatMap((f) => ['-f', f])]);
const apiJson = (method, path, fields) => JSON.parse(api(method, path, fields) || 'null');
export const list = (path) => JSON.parse(gh(['api', '--paginate', '--slurp', path])).flatMap((p) => (Array.isArray(p) ? p : p.items ?? []));
export const get = (path) => apiJson('GET', path);
// Page through a list endpoint newest-first, stopping after the first page whose last row fails `more` (no --paginate of all history).
export function listWhile(path, more) {
  const out = [];
  for (let page = 1; ; page++) {
    const rows = get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`) ?? [];
    out.push(...rows);
    if (rows.length < 100 || !more(rows[rows.length - 1])) return out;
  }
}
const labelNames = (xs) => (xs ?? []).map((l) => (typeof l === 'string' ? l : l.name));

// ---- issues ----
export const addLabels = (slug, n, labels) => api('POST', `repos/${slug}/issues/${n}/labels`, labels.map((l) => `labels[]=${l}`));
export const removeLabel = (slug, n, label) => api('DELETE', `repos/${slug}/issues/${n}/labels/${encodeURIComponent(label)}`);
export const addAssignees = (slug, n, logins) => api('POST', `repos/${slug}/issues/${n}/assignees`, logins.map((l) => `assignees[]=${l}`));
export const comment = (slug, n, body) => api('POST', `repos/${slug}/issues/${n}/comments`, [`body=${signComment(body, actorId())}`]);
// Issues (not PRs) created, updated or closed since an ISO date; the caller filters on created_at / closed_at.
export const issuesSince = (slug, since) => list(`repos/${slug}/issues?state=all&since=${since}&per_page=100`).filter((i) => !i.pull_request);

// Issue with comments as bodies and labels as names: {number, title, body, state, labels, comments}.
export function issueWithComments(slug, n) {
  const i = get(`repos/${slug}/issues/${n}`);
  return { ...i, labels: labelNames(i.labels), comments: list(`repos/${slug}/issues/${n}/comments?per_page=100`).map((c) => c.body) };
}

// GitHub's closing keywords. "#n", "repo#n", "owner/repo#n" and issue URLs; -> [{owner?, repo?, number}].
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/|(?:([\w.-]+)\/)?([\w.-]+)?#)(\d+)/gi;
export function closingRefs(body) {
  return [...(body ?? '').matchAll(CLOSE_RE)].map((m) => ({ owner: m[1] ?? m[3], repo: m[2] ?? m[4], number: Number(m[5]) }));
}
const sameIssue = (r, owner, repo, n, prRepo) => r.number === n && (r.owner ?? owner) === owner && (r.repo ?? prRepo) === repo;

// The REST stand-in for GraphQL closedByPullRequestsReferences and ClosedEvent.closer: merged PRs (from cross-reference
// events) whose body closes this issue, and whether the close event came from a commit.
export function closers(owner, repo, n) {
  const tl = list(`repos/${owner}/${repo}/issues/${n}/timeline?per_page=100`);
  const prs = tl.filter((e) => e.event === 'cross-referenced' && e.source?.issue?.pull_request).map((e) => e.source.issue)
    .filter((p) => closingRefs(p.body).some((r) => sameIssue(r, owner, repo, n, p.repository?.name ?? repo)));
  const closed = tl.filter((e) => e.event === 'closed').pop();
  return { closingPrs: prs.map((p) => ({ number: p.number, merged: !!p.pull_request.merged_at })), closer: closed?.commit_id ? { __typename: 'Commit' } : null };
}

// ---- pull requests ----
// Open a PR, label it, return {url, number}.
export function createPR({ slug, base, head, title, body, labels = [] }) {
  const pr = apiJson('POST', `repos/${slug}/pulls`, [`base=${base}`, `head=${head}`, `title=${title}`, `body=${body}`]);
  if (labels.length) addLabels(slug, pr.number, labels);
  return { url: pr.html_url, number: pr.number };
}
// sha: merge only if the head is still this commit (what was reviewed); GitHub refuses otherwise.
export const mergePR = (slug, n, sha) => api('PUT', `repos/${slug}/pulls/${n}/merge`, ['merge_method=merge', ...(sha ? [`sha=${sha}`] : [])]);
export const updateBranch = (slug, n, sha) => api('PUT', `repos/${slug}/pulls/${n}/update-branch`, sha ? [`expected_head_sha=${sha}`] : []);

// Arm auto-merge: `gh pr merge --auto` locally (GraphQL); in a cloud session the CCR REST route. Throws if neither works.
export function enableAutoMerge(slug, n) {
  try { gh(['pr', 'merge', String(n), '-R', slug, '--auto', '--merge']); }
  catch { api('PUT', `repos/${slug}/pulls/${n}/ccr/auto_merge`, ['merge_method=merge']); }
}

// One open PR (a REST list row) in the shape `gh pr list --json number,title,body,url,isDraft,mergeStateStatus,labels,statusCheckRollup` gave.
export function prFull(owner, repo, p) {
  const slug = `${owner}/${repo}`;
  const full = get(`repos/${slug}/pulls/${p.number}`); // mergeable_state is only on the single-PR read
  const checks = get(`repos/${slug}/commits/${p.head.sha}/check-runs?per_page=100`).check_runs ?? [];
  return { number: p.number, title: p.title, body: p.body, url: p.html_url, isDraft: p.draft, repo, headSha: p.head.sha, updatedAt: p.updated_at,
    mergeStateStatus: String(full.mergeable_state ?? 'unknown').toUpperCase(), labels: p.labels,
    statusCheckRollup: checks.map((c) => ({ name: c.name, conclusion: c.conclusion?.toUpperCase() ?? null })) };
}
// Open PRs carrying a label, as prFull. { light: true } returns the list rows only (for counting).
export function openPRsLabelled(owner, repo, label, { light = false } = {}) {
  const prs = list(`repos/${owner}/${repo}/pulls?state=open&per_page=100`).filter((p) => labelNames(p.labels).includes(label));
  return light ? prs : prs.map((p) => prFull(owner, repo, p));
}

// "repo#n" for PRs merged since a date: closed PRs, most recently updated first, until they predate it.
export const mergedPRsSince = (owner, repo, since) => listWhile(`repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc`, (p) => p.updated_at >= since)
  .filter((p) => p.merged_at && p.merged_at >= since).map((p) => `${repo}#${p.number}`);

// A PR as grounding reads it: {number, title, body, labels:[name], mergedAt, state, closingIssue: {repo, number} | null}.
export function prForGrounding(owner, repo, n) {
  const p = get(`repos/${owner}/${repo}/pulls/${n}`);
  const c = closingRefs(p.body).find((r) => (r.owner ?? owner) === owner);
  return { number: p.number, title: p.title, body: p.body, labels: labelNames(p.labels), mergedAt: p.merged_at,
    state: p.merged_at ? 'MERGED' : p.state.toUpperCase(), closingIssue: c ? { repo: c.repo ?? repo, number: c.number } : null };
}
