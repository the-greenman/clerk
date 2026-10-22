// The owner's desk (clerk#64): one issue body that says everything needing the owner, one line per thread, and counts for the rest.
// Pure: adapters/desk.mjs gathers the input. "If it is not here, it does not need you."
import * as A from './agenda.mjs';
import { healthState } from './doctor.mjs';

export const DESK_LABEL = 'desk';
const DAY = 864e5;
const cell = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const link = (ref, url) => (url ? `[${ref}](${url})` : ref);
const md = (iso) => (iso ? String(iso).slice(5, 10) : '-');
const labelNames = (p) => (p.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
const refOf = (x) => `${x.repo}#${x.number}`;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)];
const paused = (g) => String(g.pause ?? '').startsWith('paused');
const more = (xs, n, f) => xs.slice(0, n).map(f).join(', ') + (xs.length > n ? `, and ${xs.length - n} more` : '');
export const ageDays = (iso, now) => Math.max(0, Math.floor((Date.parse(now) - Date.parse(iso)) / DAY));

// Why an approved group PR has not merged: the first gate that holds it.
export function heldBecause(pr, group) {
  if (group && paused(group)) return `group paused (${group.pause.replace(/^paused:\s*/, '')})`;
  if (pr.mergeStateStatus && pr.mergeStateStatus !== 'CLEAN') return `merge state ${pr.mergeStateStatus.toLowerCase()}`;
  const checks = A.checksState(pr);
  if (/failing|pending/.test(checks)) return `checks ${checks}`;
  if (group && Number(group.merged) >= Number(group.budget)) return `budget used (${group.merged} of ${group.budget} this cycle)`;
  return 'nothing visible; upkeep should merge it on its next run';
}

// The thread a PR belongs to: its group (by label), else the first epic its closing issue's parent chain reaches, else none.
export function threadOf(pr, groups, epics) {
  const g = groups.find((x) => labelNames(pr).includes(x.label));
  if (g) return { kind: 'group', key: g.title };
  // the nearest epic up the chain: an issue under clerk#19 under semanticops.com#33 belongs to clerk#19
  const e = (pr.chain ?? []).map((r) => epics.find((x) => (x.refs ?? [x.ref]).includes(r))).find(Boolean);
  return e ? { kind: 'epic', key: e.ref } : null;
}

// input: {now, owner, reportIssue:{ref,url}, digestIssue:{ref,url}, decisions, ownerLog, groups:[{title, label, log, pause, merged, budget, runReports, queue}],
//   received:Set, reportComments, acked:Set, exercises, prs:[{repo, number, title, url, body, isDraft, labels, mergeStateStatus?, statusCheckRollup?, updatedAt, chain, approved}],
//   assigned:[{repo, number, title, url, createdAt, labels}] (one carrying claimLabel, the in_progress label, is claimed by someone, not waiting on you), claimLabel, needsInput:[same], epics:[{ref, refs, title, url, priority, rank, updatedAt}]} -> markdown
export function deskBody(input) {
  const { now = new Date(0).toISOString(), groups = [], prs = [], epics = [], needsInput = [] } = input;
  const assigned = (input.assigned ?? []).filter((i) => !labelNames(i).includes(input.claimLabel));
  const decisions = input.decisions ?? [], ownerLog = input.ownerLog ?? { memberInstanceIds: [] };
  const R = input.reportIssue ?? {}, D = input.digestIssue ?? {};
  const SESSION = 'Run a session (`/session` or `scripts/session`)';

  // ---- Needs you ----
  const needs = [];
  const reportRow = (g, items) => [`**WG reports unreceived:** ${g.title} (cycles ${items.map((i) => md(i.cycle)).join(', ')}${R.ref ? `, ${link(R.ref, R.url)}` : ''})`,
    `${SESSION}, go to Reports, press \`r\` on each`,
    paused(g) ? `**Group paused** with ${items.length} unreceived report${items.length > 1 ? 's' : ''}. Nothing builds or merges until this is done.` : `${items.length} unreceived; the group pauses when they pile up.`];
  // One report issue per programme: a comment belongs to the group its marker tags, else the group its second line names ("WG X: cycle ..."), else to the first group, as in the agenda.
  const comments = input.reportComments ?? [], namer = (c) => groups.find((g) => g.label && g.label === A.reportGroup(c)) ?? groups.find((g) => String(c.body ?? '').split('\n')[1]?.startsWith(g.title));
  const reportRows = groups.map((g, i) => [g, A.reportItems(g.runReports ?? [], input.received ?? new Set(), comments.filter((c) => namer(c) === g || (!i && !namer(c))), input.acked ?? new Set(), g.title)])
    .filter(([, items]) => items.length);
  for (const [g, items] of reportRows.filter(([g]) => paused(g))) needs.push(reportRow(g, items));
  const ratify = [...A.ratifyItems(decisions, ownerLog), ...groups.flatMap((g) => (g.log ? A.escalationItems(decisions, g.log, ownerLog) : []))];
  if (ratify.length) needs.push([`**${ratify.length} proposed decision${ratify.length > 1 ? 's' : ''} to ratify:** ${more(ratify, 5, (r) => `${A.fv(r).title} [${r.instanceId.slice(0, 8)}]`)}`,
    `${SESSION}: ratify, set aside or hold each`, 'They stay proposed until a session takes them.']);
  // The cloud canary (clerk doctor --post, routines/canary.md): a failure or a silence is the owner's to know about.
  const H = input.health, hState = 'health' in input && H !== undefined ? healthState(H, now) : null, hLink = H?.url ? ` ([marker](${H.url}))` : '';
  if (hState === 'fail') needs.push([`**Cloud canary failing** since ${md(H.at)}: ${more(H.failing, 3, (l) => l)}${hLink}`, 'Fix the environment or the routine config, then run the canary routine again', 'Every routine stops at its doctor preflight until it passes.']);
  else if (hState === 'stale' || hState === 'absent') needs.push([`**Cloud canary silent**${H ? ` since ${md(H.at)}${hLink}` : ': no marker yet'}`, 'Check the canary routine ran (claude.ai routines, its last run)', 'No cloud self-test in 26 hours: routines may be failing unseen.']);
  const lost = A.unloggedItems(decisions, [ownerLog, ...groups.map((g) => g.log).filter(Boolean)]);
  if (lost.length) needs.push([`**${lost.length} proposed decision${lost.length > 1 ? 's' : ''} in no log:** ${more(lost, 5, (r) => `${A.fv(r).title} [${r.instanceId.slice(0, 8)}]`)}`,
    'Add each to the decision log that owns it (`srs container members add`), or set it aside', 'No session agenda shows them until they are in a log.']);
  const ex = A.exerciseItems(input.exercises ?? [], ownerLog);
  if (ex.length) needs.push([`**${ex.length} open exercise${ex.length > 1 ? 's' : ''}:** ${more(ex, 5, (r) => `${A.fv(r).title} [${r.instanceId.slice(0, 8)}]`)}`,
    `${SESSION}, go to Exercises, give input`, 'They ask for your input before a decision can be drafted.']);
  for (const p of A.mergeItems(prs)) needs.push([`**Owner merge ${link(refOf(p), p.url)}:** ${p.title}`,
    `${/^.*Decision asked:.*$/mi.exec(p.body ?? '')?.[0].replace(/^[\s>*_-]+/, '').trim().replace(/\.$/, '') ?? 'Decision asked: (none stated)'}. Then merge`, `Checks: ${A.checksState(p)}.`]);
  // Any other PR that states a decision for the owner (template T9). "Decision asked: none ..." asks nothing.
  const asked = (p) => /^\W*Decision asked:\s*(?!none\b)(\S.*)$/mi.exec(p.body ?? '')?.[1].trim().replace(/\.$/, '');
  const owners = new Set(A.mergeItems(prs).map(refOf));
  const askers = prs.filter((p) => !p.isDraft && !owners.has(refOf(p)) && asked(p));
  for (const p of askers) needs.push([`**Decision asked in ${link(refOf(p), p.url)}:** ${p.title}`, asked(p), 'It waits on your answer.']);
  for (const p of prs.filter((x) => x.approved)) {
    const g = groups.find((x) => labelNames(p).includes(x.label));
    needs.push([`**Approved, not merged:** ${link(refOf(p), p.url)} ${p.title}`, 'Clear what holds it, or leave it if that is expected', heldBecause(p, g)]);
  }
  for (const [g, items] of reportRows.filter(([g]) => !paused(g))) needs.push(reportRow(g, items));
  if (assigned.length) needs.push([`**Issues assigned to you**, which the nightly worker skips: ${more(assigned, 8, (i) => `${link(refOf(i), i.url)} (${ageDays(i.createdAt, now)} days)`)}`,
    'Close, unassign, or do each', 'They block the queue silently.']);
  const ni = [...needsInput].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (ni.length) needs.push([`**${ni.length} \`needs-input\` issue${ni.length > 1 ? 's' : ''}**, oldest first: ${more(ni, 8, (i) => `${link(refOf(i), i.url)} (${ageDays(i.createdAt, now)} days)`)}`,
    'One pass: answer, park, or close', 'Low urgency. They clutter the queue.']);

  // ---- Threads ----
  const byThread = new Map(), unthreaded = [];
  for (const p of prs) { const t = threadOf(p, groups, epics); if (t) byThread.set(t.key, [...(byThread.get(t.key) ?? []), p]); else unthreaded.push(p); }
  const needsMe = new Set([...A.mergeItems(prs), ...askers, ...prs.filter((x) => x.approved)].map(refOf));
  const latest = (...isos) => isos.filter(Boolean).sort().pop();
  const threads = [];
  for (const g of groups) {
    const q = g.queue, ready = q?.ready ?? [], lastRun = latest(...(g.runReports ?? []).map((r) => String(A.fv(r).run_date ?? '')));
    const pending = reportRows.find(([x]) => x === g);
    // All groups report on one issue, so a group with no unreceived report of its own is paused by another's.
    const next = paused(g) ? `${pending ? 'Receive its reports' : `Paused by the unreceived reports on ${R.ref ?? 'the report issue'}; receiving them un-pauses it`} (Needs you); then ${ready.length} ready` : !q ? 'Queue unreadable' : ready.length ? `${ready.length} ready (${more(ready, 3, refOf)})` : 'Queue is empty and needs feeding';
    threads.push([g.title, paused(g) ? '**paused**' : pending ? 'running, reports waiting' : 'running', md(lastRun), next, paused(g) ? 'you, then group' : ready.length ? 'group' : 'analyst']);
  }
  for (const e of [...epics].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))) {
    const mine = byThread.get(e.ref) ?? [], waiting = mine.filter((p) => needsMe.has(refOf(p)));
    threads.push([`${e.title} (${link(e.ref, e.url)})`, waiting.length ? 'waiting on you' : mine.length ? 'running' : 'idle',
      md(latest(e.updatedAt, ...mine.map((p) => p.updatedAt))),
      waiting.length ? `Answer or merge ${waiting.map(refOf).join(', ')} (Needs you)` : mine.length ? `${mine.length} PR${mine.length > 1 ? 's' : ''} in flight: ${more(mine, 3, refOf)}` : 'No open PR',
      waiting.length ? 'you' : mine.length ? 'agents' : '-']);
  }
  const prNext = (p) => needsMe.has(refOf(p)) ? ['waiting on you', 'Needs you', 'you'] : p.isDraft ? ['draft', 'Finish the draft', 'author']
    : labelNames(p).includes('gate:auto-merge') ? ['running', 'Auto-merges when green', 'agents'] : labelNames(p).includes('gate:owner-merge') ? ['running', 'Get it green and up to date', 'agents']
    : ['unclassified', 'Give it a gate label', 'agent'];
  const unRows = unthreaded.map((p) => { const [state, next, who] = prNext(p); return [`${link(refOf(p), p.url)} ${p.title}`, state, md(p.updatedAt), next, who]; });

  // ---- Running fine ----
  const fine = [...groups.map((g) => `- ${A.statusLine(g.title, String(g.pause ?? 'unknown'), g.merged ?? '?', g.budget ?? '?')}; ${g.queue ? `${g.queue.ready.length} ready, ${g.queue.inFlight} group PRs in flight. ${A.forecast(g.queue.ready.length, Number(g.budget) || 1)}` : 'queue unreadable'}`),
    ...(hState === 'ok' ? [`- Cloud canary ok ${md(H.at)}${hLink}.`] : []),
    `- PRs in flight: ${prs.length} open across ${new Set(prs.map((p) => p.repo)).size} repos (${prs.filter((p) => p.isDraft).length} drafts).`,
    `- History, if you want it: ${[R.ref && `${link(R.ref, R.url)} (group reports)`, D.ref && `${link(D.ref, D.url)} (nightly and upkeep digests)`].filter(Boolean).join(', ') || '-'}. You never need to read them to know what needs you.`];

  return [
    '<!-- desk: rewritten in place by `clerk desk --post`, never appended. Edits here are overwritten. -->',
    '# Desk', '', `**Updated ${String(now).slice(0, 10)}.** Everything that needs you, and one line per thread. If it is not here, it does not need you.`, '',
    '## Needs you', '', ...(needs.length ? table(['#', 'What', 'Action', 'Why now'], needs.map((r, i) => [i + 1, ...r])) : ['Nothing needs you.']), '',
    '## Threads', '', ...(threads.length ? table(['Thread', 'State', 'Last moved', 'Next step', 'Who'], threads) : ['No threads.']), '',
    '### Unthreaded', '', ...(unRows.length ? table(['PR', 'State', 'Last moved', 'Next step', 'Who'], unRows) : ['None: every open PR belongs to a thread.']), '',
    '## Running fine', '', ...fine, '',
  ].join('\n');
}
