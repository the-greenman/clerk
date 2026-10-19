// The owner-side reads behind the agenda (bin/clerk.mjs) and the desk (adapters/desk.mjs): one copy. Tolerant where the
// programme repository lacks a type: a missing type is an empty list, never a failure.
import { gh, ghJson } from './cli.mjs';
import { openPRsLabelled } from './github.mjs';
import * as A from '../practice/agenda.mjs';

const rows = (p) => p.records ?? p.instances ?? [];
const memberSet = (c) => new Set((c.memberInstanceIds ?? []).map((m) => m.instanceId ?? m));

// S: (args) -> srs payload. groupLogs: groups with their log container. -> {receivedIds, runReports:[{group, label, records}]}
export function loadReports(S, groupLogs) {
  let receivedIds = new Set(), runReports = [];
  try { receivedIds = new Set((S(['relation', 'list', '--type', 'com.semanticops.programme/receives']).relations ?? []).map((x) => x.targetId)); } catch { /* no receives yet */ }
  try {
    const rl = rows(S(['record', 'list', '--type', 'com.mudemocracy.stewardship/run-report']));
    runReports = groupLogs.map((g) => ({ group: g.title, label: g.label, records: rl.filter((r) => memberSet(g.log).has(r.instanceId)) }));
  } catch { /* no run-reports */ }
  return { receivedIds, runReports };
}

// The report issue's latest marked report comments and the ids the owner acknowledged with a +1. reportIssue: "<owner>/<repo>/issues/<n>".
export function loadReportComments(reportIssue, ownerLogin) {
  const comments = gh(['api', `repos/${reportIssue}/comments`, '--paginate', '--jq', '.[]|{id,body,created_at,author_association,html_url}'])
    .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  // ponytail: only the latest 5 reports are checked for a +1; older ones are history.
  const reports = comments.filter((c) => c.author_association === 'OWNER' && A.reportCycle(c)).slice(-5);
  const reactions = Object.fromEntries(reports.map((c) => [c.id, ghJson(['api', `repos/${reportIssue.split('/issues')[0]}/issues/comments/${c.id}/reactions`])]));
  const acked = new Set(reports.filter((c) => reactions[c.id].some((x) => x.content === '+1' && x.user?.login === ownerLogin)).map((c) => c.id));
  return { reports, acked };
}

// A group's queue, live via gh REST: { ready: ordered issues, inFlight, merged, budget }, or null when unreadable.
// gr: a group with its log; decisions: governance/decision records; state: groupState(repo, gr).
export function groupQueue(ghOwner, gr, decisions, state) {
  try {
    const issues = gr.repos.flatMap((r) => gh(['api', '-X', 'GET', `repos/${ghOwner}/${r}/issues`, '-f', `labels=ready,${gr.label}`, '-f', 'state=open', '-f', 'per_page=100',
      '--jq', '.[]|select(.pull_request|not)|{number,title,created_at,assignee:(.assignee!=null),labels:[.labels[].name]}']).trim().split('\n').filter(Boolean).map((l) => ({ ...JSON.parse(l), repo: r })))
      .filter((i) => !i.assignee && !i.labels.some((l) => ['needs-input', 'parked'].includes(l))); // ponytail: the builder also drops issues with a branch or PR; not checked here
    const inFlight = gr.repos.reduce((n, r) => n + openPRsLabelled(ghOwner, r, gr.label, { light: true }).length, 0);
    return { ready: A.orderQueue(issues, A.localPriorities(decisions.filter((r) => memberSet(gr.log).has(r.instanceId)))), inFlight, merged: Number(state.merged) || 0, budget: Number(state.budget) || gr.budget };
  } catch { return null; /* queue unknown */ }
}

// Stalled work for the agenda (clerk#38): live via gh REST, tolerant of failure (an unreadable repo is skipped, never fatal).
// Branches with an open or merged PR are skipped; branches are remote only; paging stops at 100 per repo (ponytail). epicRefs: ["repo#n"]; repos: governed repo names. Local worktrees are not read (a cloud session has none); branches stand in for them.
export function loadStalled(ghOwner, repos, epicRefs, now, opts) {
  const safe = (f, dflt) => { try { return f(); } catch { return dflt; } };
  const json = (path) => JSON.parse(gh(['api', path]) || 'null');
  const claims = repos.flatMap((r) => safe(() => json(`repos/${ghOwner}/${r}/issues?labels=${encodeURIComponent('status: in progress')}&state=open&per_page=100`), [])
    .filter((i) => !i.pull_request).map((i) => ({ ref: `${r}#${i.number}`, updatedAt: i.updated_at })));
  const branches = repos.flatMap((r) => safe(() => {
    const def = json(`repos/${ghOwner}/${r}`).default_branch;
    // a branch with an open PR is in review and one whose PR merged is done (squash merges leave ahead_by > 0): neither is stalled
    const settled = new Set(json(`repos/${ghOwner}/${r}/pulls?state=all&per_page=100`).filter((p) => p.state === 'open' || p.merged_at).map((p) => p.head.ref));
    return json(`repos/${ghOwner}/${r}/branches?per_page=100`).filter((b) => b.name !== def && !settled.has(b.name)).flatMap((b) => safe(() => {
      const c = json(`repos/${ghOwner}/${r}/compare/${def}...${b.name}?per_page=1`); // ahead_by is exact; the head's own date comes from the head commit, as compare lists oldest first
      if (!(c.ahead_by > 0)) return [];
      return [{ repo: r, name: b.name, aheadBy: c.ahead_by, lastCommitAt: json(`repos/${ghOwner}/${r}/commits/${b.commit.sha}`).commit.committer.date }];
    }, []));
  }, []));
  const epics = epicRefs.flatMap((ref) => safe(() => {
    const [r, n] = ref.split('#'), e = json(`repos/${ghOwner}/${r}/issues/${n}`);
    if (e.state !== 'open') return [];
    const kids = json(`repos/${ghOwner}/${r}/issues/${n}/sub_issues?per_page=100`); // a failed read skips the epic: judging it on its own date alone would call a busy epic quiet
    return [{ ref, activityAt: [e.updated_at, ...kids.map((k) => k.updated_at)].sort().at(-1) }];
  }, []));
  return A.stalledItems({ claims, branches, epics }, now, opts);
}
