// PR upkeep's reads (clerk#89): repo-scoped REST only, so it runs in Actions and in a cloud session alike. No judgement
// here: practice/upkeep.mjs decides. A read that fails becomes a value the rules refuse (null or 'unknown'), never a default.
import { list, listWhile, get } from './github.mjs';
import { srsCli, srs } from './cli.mjs';
import { loadReports } from './agenda.mjs';
import { issueRef } from './settings.mjs';
import { cycleStart, countMerged, countOpen, pauseReports, pauseState, quorumReport, quorumVerdict, receivedReportIds, routePR, sameChange } from '../practice/upkeep.mjs';

// Each group's state: {label: {budget, maxUnacked, cycleStart, merged, open, pause, why?}}; why is the failed read behind an 'unknown' count. Merges are counted in every
// repo upkeep merges in (settings.repos), not only the group's own, so no group PR merges outside its budget.
// gates: loadWorkflow(repo).gates. repo: the programme path, where a session's `receives` are read (clerk#167); without it only a +1 acknowledges.
export function groupStates(st, groups, gates, now = new Date().toISOString(), repo = null) {
  const O = st.githubOwner, out = {};
  const starts = Object.fromEntries(groups.map((g) => [g.label, cycleStart(now, g.cycleClose)]));
  const since = Object.values(starts).sort()[0];
  let closed = null, open = null, why;
  try { closed = st.repos.flatMap((r) => listWhile(`repos/${O}/${r}/pulls?state=closed&sort=updated&direction=desc`, (p) => p.updated_at >= since)); } catch (e) { why = e.message.split('\n')[0]; }
  try { open = st.repos.flatMap((r) => list(`repos/${O}/${r}/pulls?state=open&per_page=100`)); } catch (e) { why ??= e.message.split('\n')[0]; }
  let reportComments = null;
  const R = issueRef(st.reportIssue, O);
  try { reportComments = list(`repos/${R.path}/comments?per_page=100`); } catch { /* unreadable: paused */ }
  const rec = repo ? receives(repo, groups) : null;
  for (const g of groups) {
    const reports = reportComments && pauseReports(reportComments, g.label, g.maxUnacked);
    let acked = null;
    try { acked = reports && new Set(reports.filter((c) => list(`repos/${O}/${R.repo}/issues/comments/${c.id}/reactions?per_page=100`)
      .some((x) => x.content === '+1' && x.user?.login === O)).map((c) => c.id)); } catch { /* unreadable: paused */ }
    if (acked && rec) for (const id of receivedReportIds(reports, rec.runReports.find((x) => x.label === g.label)?.records ?? [], rec.receivedIds, g.label)) acked.add(id);
    out[g.label] = { budget: g.budget, maxUnacked: g.maxUnacked, cycleStart: starts[g.label],
      merged: closed ? countMerged(closed, g.label, starts[g.label], gates) : 'unknown', open: open ? countOpen(open, g.label, gates) : 'unknown',
      pause: pauseState(reports, acked, g.maxUnacked), ...(why && { why }) };
  }
  return out;
}

// The programme's receives and each group's run-report records; unreadable adds nothing, so the group stays as paused as a +1-only read.
function receives(repo, groups) {
  try { const cli = srsCli(repo), S = (a) => srs(cli, repo, a); return loadReports(S, groups.map((g) => ({ ...g, log: S(['container', 'get', g.logId]).container }))); }
  catch { return null; }
}

// Does the default branch require status checks? Native auto-merge (clerk#217) and a carried quorum (af1c9258) are safe only then; no protection reads as none.
const requiresChecks = (owner, repo, branch) => {
  try { return (get(`repos/${owner}/${repo}/branches/${branch}/protection`).required_status_checks?.contexts ?? []).length > 0; } catch { return false; }
};

// Does the quorum carry to this head (af1c9258)? Compares are read only when it would otherwise hold and names another commit.
// true, false, or null when a compare is unreadable; only true carries.
export function quorumCarried(owner, repo, defaultBranch, comments, headSha, requiredChecks) {
  if (!requiredChecks || quorumVerdict(comments, headSha) === 'ok' || quorumVerdict(comments, headSha, { carried: true }) !== 'ok') return false;
  const files = (sha) => get(`repos/${owner}/${repo}/compare/${defaultBranch}...${sha}`).files;
  try { return sameChange(files(quorumReport(comments, headSha).quorumSha), files(headSha)); } catch { return null; }
}

// One PR's quorum as the desk and `clerk quorum` read it, by the same rule as upkeep. Throws when the comments are unreadable.
export function readQuorum(owner, repo, defaultBranch, number, headSha) {
  const comments = list(`repos/${owner}/${repo}/issues/${number}/comments?per_page=100`);
  return quorumReport(comments, headSha, { carried: quorumCarried(owner, repo, defaultBranch, comments, headSha, requiresChecks(owner, repo, defaultBranch)) });
}

// One repo's open PRs in the shape upkeepPlan reads; comments only where a group quorum is needed (null when unreadable).
export function repoPRs(owner, repo, groupLabels, gates) {
  const defaultBranch = get(`repos/${owner}/${repo}`).default_branch, requiredChecks = requiresChecks(owner, repo, defaultBranch);
  const prs = list(`repos/${owner}/${repo}/pulls?state=open&per_page=100`).filter((p) => !p.draft).map((p) => {
    const full = get(`repos/${owner}/${repo}/pulls/${p.number}`); // mergeable_state is only on the single-PR read
    const pr = { number: p.number, title: p.title, body: p.body ?? '', headSha: p.head.sha, labels: p.labels.map((l) => l.name), draft: p.draft,
      base: p.base.ref, state: String(full.mergeable_state ?? 'unknown').toUpperCase(), autoMerge: Boolean(p.auto_merge) };
    if (routePR(pr, { groupLabels, defaultBranch, gates }).needsQuorum) {
      try { pr.comments = list(`repos/${owner}/${repo}/issues/${p.number}/comments?per_page=100`); } catch { pr.comments = null; }
      if (pr.comments) pr.carried = quorumCarried(owner, repo, defaultBranch, pr.comments, pr.headSha, requiredChecks);
    }
    return pr;
  });
  return { repo, defaultBranch, requiredChecks, prs };
}
