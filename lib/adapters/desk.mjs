// The desk's input (clerk#64): srs CLI reads and gh REST only (no GraphQL: cloud sessions refuse it, clerk#55). No judgement here; practice/desk.mjs builds the body.
import { srsCli, srs, gh, groupState } from './cli.mjs';
import { list, get, prFull, closingRefs } from './github.mjs';
import { parentChain, loadProgramme } from './ground.mjs';
import { loadSettings, issueRef } from './settings.mjs';
import { loadWorkflow } from './workflow.mjs';
import { loadGroups } from './groups.mjs';
import { loadReports, loadReportComments, groupQueue } from './agenda.mjs';
import { OWNER_LOG } from '../practice/roles.mjs';
import { EXERCISE_TYPE } from '../practice/agenda.mjs';
import { DESK_LABEL } from '../practice/desk.mjs';
import { latestHealth } from '../practice/doctor.mjs';
import { quorumVerdict } from '../practice/upkeep.mjs';
import { derive } from '../../scripts/roadmap.mjs';

const rows = (p) => p.records ?? p.instances ?? [];
const warn = (what, e) => console.error(`desk: ${what} unreadable, skipped (${String(e.stderr || e.message).trim().split('\n')[0]})`);
const perRepo = (repos, what, f) => repos.flatMap((r) => { try { return f(r); } catch (e) { warn(`${what} in ${r}`, e); return []; } });
const issueRow = (r) => (i) => ({ repo: r, number: i.number, title: i.title, url: i.html_url, createdAt: i.created_at, labels: i.labels });

// The quorum upkeep would accept for this head commit (before budget and pause): one rule, practice/upkeep.mjs.
const quorumApproved = (owner, repo, p) => quorumVerdict(list(`repos/${owner}/${repo}/issues/${p.number}/comments?per_page=100`), p.head.sha) === 'ok';

export async function gatherDesk(repo) {
  const cli = srsCli(repo), S = (a) => srs(cli, repo, a), st = loadSettings(repo, cli), W = loadWorkflow(repo, cli), O = st.githubOwner, now = new Date().toISOString();
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
    groups.push({ ...g, ...state, runReports: runReports.find((x) => x.group === g.title)?.records ?? [], queue: groupQueue(O, g, decisions, state, W) });
  }

  let epics = [];
  try { const { records, relations, affirmed, outlines } = loadProgramme(cli, repo); epics = derive(records, relations, now.slice(0, 10), affirmed, outlines).epics.filter((e) => !e.parked); }
  catch (e) { warn('roadmap ranking', e); }
  epics = epics.flatMap((e) => { try { const i = get(`repos/${O}/${e.repo}/issues/${e.number}`); return i.state === 'open' ? [{ ...e, url: i.html_url, updatedAt: i.updated_at }] : []; } catch (x) { warn(e.ref, x); return [{ ...e }]; } });

  // Active work inside each ranked epic (clerk#204): its sequences (a sub-issue with open children) with the next open, unblocked
  // task, and its ready and claimed items. One level of sequences; unreadable reads lose only that epic's detail.
  const ref = (i, r) => `${i.repository_url?.split('/').pop() ?? r}#${i.number}`;
  const subs = (r, n) => list(`repos/${O}/${r}/issues/${n}/sub_issues?per_page=100`);
  const blocked = (r, n) => { try { return list(`repos/${O}/${r}/issues/${n}/dependencies/blocked_by?per_page=100`).some((b) => b.state === 'open'); } catch { return false; } };
  const has = (i, l) => (i.labels ?? []).some((x) => (x.name ?? x) === l);
  epics = epics.map((e) => {
    try {
      const kids = subs(e.repo, e.number).filter((k) => k.state === 'open'), seqs = [];
      let ready = 0, claimed = 0;
      for (const k of kids) {
        const kr = k.repository_url?.split('/').pop() ?? e.repo;
        if (has(k, W.ready)) ready++; if (has(k, W.inProgress)) claimed++;
        if (!(k.sub_issues_summary?.total > (k.sub_issues_summary?.completed ?? 0))) continue;
        const parts = subs(kr, k.number).filter((x) => x.state === 'open');
        for (const x of parts) { if (has(x, W.ready)) ready++; if (has(x, W.inProgress)) claimed++; }
        const next = parts.find((x) => !blocked(x.repository_url?.split('/').pop() ?? kr, x.number));
        seqs.push({ ref: ref(k, kr), title: k.title, url: k.html_url, open: parts.length, next: next ? { ref: ref(next, kr), title: next.title, url: next.html_url } : null });
      }
      return { ...e, seqs, work: { ready, claimed } };
    } catch (x) { warn(`${e.ref} sub-issues`, x); return e; }
  });
  // The central lane (D4, D5, D15: work no group holds): its ready queue, as `clerk queue` reads it.
  const central = { lane: W.lane, ready: perRepo(st.repos, 'central-lane queue', (r) => list(`repos/${O}/${r}/issues?labels=${encodeURIComponent(`${W.ready},${W.lane}`)}&state=open&per_page=100`).filter((i) => !i.pull_request).map(issueRow(r))) };
  const groupLabels = new Set(groups.map((g) => g.label));
  const prs = perRepo(st.repos, 'open PRs', (r) => list(`repos/${O}/${r}/pulls?state=open&per_page=100`).map((p) => {
    const names = p.labels.map((l) => l.name), ownerMerge = names.includes(W.gates.owner), grouped = !ownerMerge && names.some((n) => groupLabels.has(n));
    const base = ownerMerge || grouped ? prFull(O, r, p) : { number: p.number, title: p.title, body: p.body, url: p.html_url, isDraft: p.draft, repo: r, labels: p.labels, updatedAt: p.updated_at };
    const c = grouped ? null : closingRefs(p.body).find((x) => (x.owner ?? O) === O); // a group PR is threaded by its label; no walk needed
    const chain = c ? [`${c.repo ?? r}#${c.number}`, ...parentChain(O, c.repo ?? r, c.number).map((x) => x.ref)] : [];
    return { ...base, chain, approved: grouped && quorumApproved(O, r, p), base: p.base?.ref ?? null, headRef: p.head?.ref ?? null };
  }));

  // Claims with no open PR yet (clerk#204): who claimed (the claim comment) and when, so a stalled claim is seen.
  const prRefs = new Set(prs.flatMap((p) => p.chain?.slice(0, 1) ?? []));
  const claims = perRepo(st.repos, 'claims', (r) => list(`repos/${O}/${r}/issues?labels=${encodeURIComponent(W.inProgress)}&state=open&per_page=100`).filter((i) => !i.pull_request && !prRefs.has(`${r}#${i.number}`)).map((i) => {
    let by = null, since = i.updated_at;
    try { const c = list(`repos/${O}/${r}/issues/${i.number}/comments?per_page=100`).filter((x) => /^Claimed by /m.test(x.body ?? '')).pop(); if (c) { by = /^Claimed by (\S+?)[.,:;)]*(?:\s|$)/m.exec(c.body)?.[1] ?? null; since = c.created_at; } } catch { /* who stays unknown */ }
    return { ...issueRow(r)(i), by, since };
  }));

  // The cloud canary's latest `clerk doctor --post` marker on the digest issue; undefined when unreadable (the desk then says nothing).
  let health; try { health = latestHealth(list(`repos/${Dg.path}/comments?per_page=100`), 'cloud'); } catch (e) { warn('digest issue (health)', e); }

  return {
    now, owner: O, health, decisions, ownerLog, groups, received: receivedIds, reportComments: reports, acked, exercises, prs, epics, central, claims,
    reportIssue: { ref: st.reportIssue, url: `https://github.com/${R.path}`, repo: R.repo }, digestIssue: { ref: st.digestIssue, url: `https://github.com/${Dg.path}`, repo: Dg.repo },
    claimLabel: W.inProgress, gates: W.gates,
    assigned: perRepo(st.repos, 'assigned issues', (r) => list(`repos/${O}/${r}/issues?assignee=${O}&state=open&per_page=100`).filter((i) => !i.pull_request).map(issueRow(r))),
    // Parked blockers of ranked work (clerk#113): reconcile labels them with the bound blocks-ranked label (own label or parked epic);
    // here only their open dependents are read. No binding, no label: nothing to list (f58db200).
    parkedBlockers: !W.blocksRanked ? [] : perRepo(st.repos, 'parked blockers', (r) => list(`repos/${O}/${r}/issues?labels=${encodeURIComponent(W.blocksRanked)}&state=open&per_page=100`).filter((i) => !i.pull_request).map((i) => ({
      ...issueRow(r)(i),
      // one unreadable edge list loses only this issue's dependents (the desk shows `?`), not the repo's whole list
      blocks: (() => { try { return list(`repos/${O}/${r}/issues/${i.number}/dependencies/blocking?per_page=100`).filter((b) => b.state === 'open').map((b) => `${b.repository_url?.split('/').pop() ?? r}#${b.number}`); } catch (e) { warn(`${r}#${i.number} blocking edges`, e); return []; } })(),
    }))),
    needsInput: perRepo(st.repos, 'needs-input issues', (r) => list(`repos/${O}/${r}/issues?labels=${encodeURIComponent(W.needsInput)}&state=open&per_page=100`).filter((i) => !i.pull_request).map(issueRow(r))),
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
