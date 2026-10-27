// PR upkeep's merge rules (clerk#89): pure. Which open PRs merge, update their branch or wait, and why. Every rule fails
// closed: anything unreadable or malformed means no merge. adapters/upkeep.mjs reads GitHub; scripts/upkeep.mjs acts.
import { REPORT_MARK, fv } from './agenda.mjs';
import { parseDecisions, ownerHasWork } from './pr-decisions.mjs';

// gates: {auto, owner}, the merge_gate labels from the programme's bindings (loadWorkflow(repo).gates).
export const QUORUM_MARK = '<!-- wg-quorum -->';
// <!-- wg-quorum --> builder=agent:x reviewer=agent:y gates=green@<sha> mandate=<ruling> verdict=approve (routines/wg-reviewer.md)
const QUORUM = /^<!-- wg-quorum --> builder=(agent:\S+) reviewer=(agent:\S+) gates=(\w+)@([0-9a-f]{7,40}) mandate=(\S+) verdict=(\w+)\b/;

// A quorum comment's first line -> {builder, reviewer, gates, sha, mandate, verdict}, or null when it is not well formed.
export function parseQuorum(body = '') {
  const m = QUORUM.exec(body.split('\n')[0]);
  return m && { builder: m[1], reviewer: m[2], gates: m[3], sha: m[4], mandate: m[5], verdict: m[6] };
}

// The latest owner-account quorum comment decides. comments: [{body, created_at, author_association}] -> 'ok' or why not.
// Public repos let anyone comment, so only the owner account counts (routines post as it). The quorum names the commit it
// reviewed: a different head, however it got there, is unreviewed.
export function quorumVerdict(comments, headSha) {
  const last = comments.filter((c) => c.author_association === 'OWNER' && c.body?.startsWith(QUORUM_MARK))
    .sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
  if (!last) return 'no quorum comment';
  const q = parseQuorum(last.body);
  if (!q) return 'quorum comment malformed';
  if (q.builder === q.reviewer) return 'builder and reviewer are the same actor';
  if (q.verdict !== 'approve') return `verdict ${q.verdict}`;
  if (q.gates !== 'green') return `gates ${q.gates}`;
  if (!headSha?.startsWith(q.sha)) return `quorum is for ${q.sha.slice(0, 8)}, head is ${String(headSha).slice(0, 8)}`;
  return 'ok';
}

// Delegated merges left this cycle. A budget or count that is not a whole number blocks: never merge on an unknown.
export function budgetVerdict(merged, budget) {
  if (!Number.isInteger(budget) || budget < 0) return 'no budget in the charter';
  if (!Number.isInteger(merged)) return 'merges this cycle unknown';
  return merged >= budget ? `over budget (${merged} of ${budget} merged this cycle)` : 'ok';
}

// The most recent cycle close (HH:MM UTC) at or before now, as an ISO second.
export function cycleStart(now, close) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(close ?? '');
  if (!m) throw new Error(`cycle close "${close}" is not HH:MM`);
  const t = new Date(now), c = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), +m[1], +m[2]));
  if (t < c) c.setUTCDate(c.getUTCDate() - 1);
  return c.toISOString().replace('.000Z', 'Z');
}

// PRs (REST rows) labelled for a group and not escalated: merged since a time, or open.
const names = (p) => (p.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
const delegated = (p, label, gates) => names(p).includes(label) && !names(p).includes(gates.owner);
export const countMerged = (prs, label, since, gates) => prs.filter((p) => delegated(p, label, gates) && p.merged_at && p.merged_at >= since).length;
export const countOpen = (prs, label, gates) => prs.filter((p) => delegated(p, label, gates) && p.state === 'open').length;

// The group's reports the pause rule reads: the owner's latest maxUnacked report comments for this label. An untagged
// report (written before tags) counts for every group, so it can pause but never un-pause.
export function pauseReports(comments, label, maxUnacked) {
  return comments.filter((c) => c.author_association === 'OWNER' && REPORT_MARK.test(c.body ?? ''))
    .filter((c) => (REPORT_MARK.exec(c.body)[2] ?? label) === label)
    .sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-Math.max(1, maxUnacked));
}
// The ids of the group's tagged report comments whose cycle is a run-report record a session `receives` (clerk#167): receiving
// in a session acknowledges a report without a GitHub reaction. An untagged comment is never received this way: it can pause,
// never un-pause. runReports: the group's run-report records; received: Set of record ids a session receives.
export function receivedReportIds(comments, runReports, received, label) {
  const cycles = new Set(runReports.filter((r) => received.has(r.instanceId)).map((r) => String(fv(r).run_date ?? '').slice(0, 10)));
  return new Set(comments.filter((c) => { const m = REPORT_MARK.exec(c.body ?? ''); return m && m[2] === label && cycles.has(m[1]); }).map((c) => c.id));
}
// reports: pauseReports(...); acked: Set of report ids the owner gave a +1 or a session received, or null when unreadable -> 'ok' or 'paused: ...'.
export function pauseState(reports, acked, maxUnacked) {
  if (!Number.isInteger(maxUnacked) || maxUnacked < 1) return 'paused: no pause limit in the charter';
  if (!reports || !acked) return 'paused: reports unreadable';
  const un = reports.filter((r) => !acked.has(r.id)).length;
  return reports.length >= maxUnacked && un >= maxUnacked ? `paused: ${un} reports unacknowledged` : 'ok';
}

// How one open PR is handled. pr: {labels, draft, base, state (CLEAN|BEHIND|DIRTY|…), autoMerge}; labels are matched exactly.
// programme: the PR is in the programme repo, a shared database whose PRs all merge on green (c373c2c1, clerk#208): no gate
// label reads as auto, and an auto PR not yet CLEAN gets GitHub's native auto-merge armed, so it merges between upkeep runs.
// requiredChecks: the repo's default branch requires status checks; there an auto PR is armed too (clerk#217). Never armed in a
// repo without required checks: there native auto-merge merges at once, before CI.
// -> {kind: skip|owner|group|ordinary, group?, needsQuorum?, action: merge|update-branch|null, arm?, why?}
export function routePR(pr, { groupLabels, defaultBranch, gates, programme = false, requiredChecks = false }) {
  // an incomplete gate set would read an escalated PR as ordinary: refuse it, so no merge rule runs without both labels
  if (!gates?.auto || !gates?.owner) throw new Error('upkeep: merge-gate labels missing (programme label bindings)');
  const ls = names(pr);
  if (pr.draft) return { kind: 'skip', action: null, why: 'draft' };
  if (pr.base !== defaultBranch) return { kind: 'skip', action: null, why: `base ${pr.base} is not ${defaultBranch}` };
  const auto = ls.includes(gates.auto), group = ls.find((l) => groupLabels.includes(l));
  // escalated to the owner: never merged here, whatever else it carries; kept up to date so it is ready when the owner looks
  if (ls.includes(gates.owner)) return { kind: 'owner', action: pr.state === 'BEHIND' ? 'update-branch' : null };
  // a group PR merges only on its quorum; no update-branch here (a new commit voids the quorum; the reviewer updates, then re-reviews)
  if (group) return { kind: 'group', group, needsQuorum: auto, action: null };
  const go = auto || programme, arm = go && (programme || requiredChecks) && !pr.autoMerge && pr.state !== 'CLEAN';
  const action = go && pr.state === 'CLEAN' ? 'merge' : (go || pr.autoMerge) && pr.state === 'BEHIND' ? 'update-branch' : null;
  return { kind: 'ordinary', action, ungated: !go, ...(arm && { arm }) };
}

// One run. repos: [{repo, defaultBranch, programme?, requiredChecks?, prs: [{number, title, headSha, labels, draft, base, state, autoMerge, comments?}]}];
// groups: {label: {budget, merged, pause}}. comments is read only for group PRs that need a quorum (null = unreadable).
// -> {actions: [{do, repo, number, sha, why}], waits: {label: [line]}, conflicts: [line], ungated: [line], unasked: [line], merged: {label: n}}
export function upkeepPlan(repos, groups, gates) {
  const groupLabels = Object.keys(groups), merged = Object.fromEntries(groupLabels.map((l) => [l, groups[l].merged]));
  const out = { actions: [], waits: Object.fromEntries(groupLabels.map((l) => [l, []])), conflicts: [], ungated: [], unasked: [], merged };
  for (const { repo, defaultBranch, programme, requiredChecks, prs } of repos) for (const pr of prs) {
    const ref = `${repo}#${pr.number}`, line = `${ref} ${(pr.title ?? '').slice(0, 70)}`, r = routePR(pr, { groupLabels, defaultBranch, gates, programme, requiredChecks });
    if (r.kind === 'skip') continue;
    if (r.kind === 'group') {
      const g = groups[r.group];
      let why = 'awaiting group review';
      if (r.needsQuorum) why = pr.comments ? quorumVerdict(pr.comments, pr.headSha) : 'could not read comments';
      if (why === 'ok') why = budgetVerdict(merged[r.group], g.budget);
      if (why === 'ok' && g.pause !== 'ok') why = g.pause;
      if (why === 'ok' && pr.state === 'CLEAN') {
        out.actions.push({ do: 'merge', repo, number: pr.number, sha: pr.headSha, why: `group quorum ok, ${merged[r.group]} of ${g.budget} merged this cycle` });
        merged[r.group] += 1;
      } else out.waits[r.group].push(`${line} (${why === 'ok' ? `quorum ok, waiting for state ${pr.state}` : why})`);
    } else if (r.action) out.actions.push({ do: r.action, repo, number: pr.number, sha: pr.headSha, why: r.kind === 'owner' ? 'owner merge, kept up to date' : '' });
    if (r.arm) out.actions.push({ do: 'auto-merge', repo, number: pr.number, sha: pr.headSha, why: programme ? 'programme PR, merges on green' : 'auto PR, merges when its required checks pass' });
    if (pr.state === 'DIRTY') out.conflicts.push(line);
    if (r.ungated) out.ungated.push(line);
    if (r.kind === 'owner' && !ownerHasWork(parseDecisions(pr.body ?? ''))) out.unasked.push(line); // back to an agent (clerk#165)
  }
  return out;
}

// The daily digest comment.
export function digestBody(plan, groups, date, gates) {
  const block = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- none');
  const wg = Object.entries(groups).map(([l, g]) => `Working group: ${g.pause === 'ok' ? 'running' : g.pause} - waiting (\`${l}\`, ${plan.merged[l] ?? '?'} of ${g.budget ?? '?'} merged this cycle):\n${block(plan.waits[l] ?? [])}`);
  return [`**PR upkeep digest ${date}** (\`clerk upkeep\`)`, `Conflicts (need a person or agent):\n${block(plan.conflicts)}`,
    `No gate label (classify as \`${gates.auto}\` or \`${gates.owner}\`):\n${block(plan.ungated)}`,
    `Owner merge that asks the owner nothing new and cites no decision it applies (back to an agent: ask, cite the decision, or classify it \`${gates.auto}\`):\n${block(plan.unasked ?? [])}`, ...wg].join('\n\n');
}
