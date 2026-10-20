// The desk's input (clerk#64): srs CLI reads and gh REST only (no GraphQL: cloud sessions refuse it, clerk#55). No judgement here; practice/desk.mjs builds the body.
import { srsCli, srs, gh, groupState } from './cli.mjs';
import { list, get, prFull, closingRefs } from './github.mjs';
import { parentChain, loadProgramme } from './ground.mjs';
import { loadSettings, issueRef } from './settings.mjs';
import { loadGroups } from './groups.mjs';
import { loadReports, loadReportComments, groupQueue } from './agenda.mjs';
import { OWNER_LOG } from '../practice/roles.mjs';
import { EXERCISE_TYPE } from '../practice/agenda.mjs';
import { DESK_LABEL } from '../practice/desk.mjs';
import { quorumVerdict } from '../practice/upkeep.mjs';
import { derive } from '../../scripts/roadmap.mjs';

const rows = (p) => p.records ?? p.instances ?? [];
const warn = (what, e) => console.error(`desk: ${what} unreadable, skipped (${String(e.stderr || e.message).trim().split('\n')[0]})`);
const perRepo = (repos, what, f) => repos.flatMap((r) => { try { return f(r); } catch (e) { warn(`${what} in ${r}`, e); return []; } });
const issueRow = (r) => (i) => ({ repo: r, number: i.number, title: i.title, url: i.html_url, createdAt: i.created_at, labels: i.labels });

// The quorum upkeep would accept for this head commit (before budget and pause): one rule, practice/upkeep.mjs.
const quorumApproved = (owner, repo, p) => quorumVerdict(list(`repos/${owner}/${repo}/issues/${p.number}/comments?per_page=100`), p.head.sha) === 'ok';

export async function gatherDesk(repo) {
  const cli = srsCli(repo), S = (a) => srs(cli, repo, a), st = loadSettings(repo, cli), O = st.githubOwner, now = new Date().toISOString();
  const decisions = rows(S(['record', 'list', '--type', 'governance/decision']));
  const containers = S(['container', 'list']).containers, getLog = (id) => S(['container', 'get', id]).container;
  const ownerC = containers.find((c) => c.title === OWNER_LOG);
  if (!ownerC) throw new Error(`no container titled "${OWNER_LOG}" (the owner's decision log)`);
  const ownerLog = getLog(ownerC.containerId), groupLogs = loadGroups(repo, cli).map((g) => ({ ...g, log: getLog(g.logId) }));
  const { receivedIds, runReports } = loadReports(S, groupLogs);
  const R = issueRef(st.reportIssue, O), Dg = issueRef(st.digestIssue, O);
  const { reports, acked } = loadReportComments(R.path, O);
  let exercises = []; try { exercises = rows(S(['record', 'list', '--type', EXERCISE_TYPE])); } catch { /* no exercises */ }
  const groups = [];
  for (const g of groupLogs) {
    const state = await groupState(repo, g);
    groups.push({ ...g, ...state, runReports: runReports.find((x) => x.group === g.title)?.records ?? [], queue: groupQueue(O, g, decisions, state) });
  }

  let epics = [];
  try { const { records, relations, affirmed, outlines } = loadProgramme(cli, repo); epics = derive(records, relations, now.slice(0, 10), affirmed, outlines).epics.filter((e) => !e.parked); }
  catch (e) { warn('roadmap ranking', e); }
  epics = epics.flatMap((e) => { try { const i = get(`repos/${O}/${e.repo}/issues/${e.number}`); return i.state === 'open' ? [{ ...e, url: i.html_url, updatedAt: i.updated_at }] : []; } catch (x) { warn(e.ref, x); return [{ ...e }]; } });

  const groupLabels = new Set(groups.map((g) => g.label));
  const prs = perRepo(st.repos, 'open PRs', (r) => list(`repos/${O}/${r}/pulls?state=open&per_page=100`).map((p) => {
    const names = p.labels.map((l) => l.name), ownerMerge = names.includes('gate:owner-merge'), grouped = !ownerMerge && names.some((n) => groupLabels.has(n));
    const base = ownerMerge || grouped ? prFull(O, r, p) : { number: p.number, title: p.title, body: p.body, url: p.html_url, isDraft: p.draft, repo: r, labels: p.labels, updatedAt: p.updated_at };
    const c = grouped ? null : closingRefs(p.body).find((x) => (x.owner ?? O) === O); // a group PR is threaded by its label; no walk needed
    const chain = c ? [`${c.repo ?? r}#${c.number}`, ...parentChain(O, c.repo ?? r, c.number).map((x) => x.ref)] : [];
    return { ...base, chain, approved: grouped && quorumApproved(O, r, p) };
  }));

  return {
    now, owner: O, decisions, ownerLog, groups, received: receivedIds, reportComments: reports, acked, exercises, prs, epics,
    reportIssue: { ref: st.reportIssue, url: `https://github.com/${R.path}`, repo: R.repo }, digestIssue: { ref: st.digestIssue, url: `https://github.com/${Dg.path}`, repo: Dg.repo },
    assigned: perRepo(st.repos, 'assigned issues', (r) => list(`repos/${O}/${r}/issues?assignee=${O}&state=open&per_page=100`).filter((i) => !i.pull_request).map(issueRow(r))),
    needsInput: perRepo(st.repos, 'needs-input issues', (r) => list(`repos/${O}/${r}/issues?labels=needs-input&state=open&per_page=100`).filter((i) => !i.pull_request).map(issueRow(r))),
  };
}

// The one open issue labelled `desk` in the digest issue's repo. Never created here: none or several is an error to fix by hand.
export function findDeskIssue(owner, repoName) {
  const xs = list(`repos/${owner}/${repoName}/issues?labels=${DESK_LABEL}&state=open&per_page=100`).filter((i) => !i.pull_request);
  if (xs.length !== 1) throw new Error(`${owner}/${repoName} has ${xs.length} open issues labelled "${DESK_LABEL}"${xs.length ? ` (${xs.map((i) => '#' + i.number).join(', ')})` : ''}; the desk needs exactly one. Pin one and label it; the clerk never creates it.`);
  return xs[0];
}

// Rewrite the issue body in place (REST PATCH), never a comment.
export const postDesk = (owner, repoName, n, body) => gh(['api', '-X', 'PATCH', `repos/${owner}/${repoName}/issues/${n}`, '-f', `body=${body}`]);
