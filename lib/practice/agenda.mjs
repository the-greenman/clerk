// Pure agenda building and item formatting. No I/O: everything takes parsed JSON.
// A report's first line: <!-- wg-report cycle=YYYY-MM-DD group=<wg:label> -->; the group tag is optional (untagged = written before tags).
export const REPORT_MARK = /^<!-- wg-report cycle=([0-9-]+)(?: group=(\S+))? -->/;
export const ESCALATOR = 'agent:tpr-steward';

const lines = (a) => (Array.isArray(a) ? a : []);
export const fv = (r) => r.record.fieldValues ?? {};
const memberSet = (c) => new Set(lines(c?.memberInstanceIds).map((m) => (typeof m === 'string' ? m : m.instanceId)));

// Proposed decisions awaiting ratification in this role's log. A decision is ratified by the context that
// decided it: one also listed in a parent's log (an escalation the parent decided) is the parent's, so it is
// excluded here and only the parent's role can ratify it.
export function ratifyItems(records, log, parentLogs = []) {
  const m = memberSet(log), parents = parentLogs.map(memberSet);
  return records.filter((r) => r.record.lifecycleState === 'proposed' && m.has(r.instanceId) && !parents.some((p) => p.has(r.instanceId)));
}

// Escalations: proposed in the group log by the group steward, not yet in the SemanticOps log.
export function escalationItems(records, groupLog, mainLog) {
  const g = memberSet(groupLog), m = memberSet(mainLog);
  return records.filter((r) => r.record.lifecycleState === 'proposed' && r.record.createdBy?.id === ESCALATOR
    && g.has(r.instanceId) && !m.has(r.instanceId));
}

// Proposed decisions in none of the given logs: no agenda shows them, so no session can take them.
export function unloggedItems(records, logs) {
  const all = logs.map(memberSet);
  return records.filter((r) => r.record.lifecycleState === 'proposed' && !all.some((s) => s.has(r.instanceId)));
}

// Working-group reports. A report is a run-report record (group log) and/or its #31 comment (marker line carries the cycle date).
// runReports: records; received: Set of record ids a session `receives`; comments: marked #31 comments; acked: Set of comment ids with the owner's +1.
export const reportCycle = (c) => REPORT_MARK.exec(c.body)?.[1];
export const reportGroup = (c) => REPORT_MARK.exec(c.body)?.[2]; // the group label, or undefined when untagged
export function reportItems(runReports, received, comments, acked, group) {
  const marked = comments.filter((c) => reportCycle(c));
  const byDate = (d) => marked.find((c) => reportCycle(c) === d);
  // A report received as a comment (owner's +1) before its record landed stays received.
  const fromRecords = runReports.filter((r) => !received.has(r.instanceId) && !acked.has(byDate(String(fv(r).run_date ?? '').slice(0, 10))?.id)).map((r) => {
    const cycle = String(fv(r).run_date ?? '').slice(0, 10), comment = byDate(cycle);
    return { instanceId: r.instanceId, recordId: r.instanceId, group, cycle, comment, text: fv(r).chose ?? comment?.body ?? '' };
  });
  const paired = new Set(runReports.map((r) => String(fv(r).run_date ?? '').slice(0, 10)));
  const commentOnly = marked.filter((c) => !paired.has(reportCycle(c)) && !acked.has(c.id))
    .map((c) => ({ instanceId: `comment:${c.id}`, group, cycle: reportCycle(c), comment: c, commentOnly: true, text: c.body }));
  return [...fromRecords, ...commentOnly].sort((x, y) => x.cycle.localeCompare(y.cycle));
}
export const reportTitle = (it) => `${it.group} report ${it.cycle}`;

const SECTION_LABELS = [['decisions', 'Decisions for you'], ['decided', 'Decided within mandate'], ['done', 'Done'], ['stuck', 'Stuck(?: or lost)?'],
  ['budget', 'Budget'], ['learned', 'What we learned'], ['other', 'Awaiting ratification|Next cycle|Local priorities|Logs by context|Build triggers']];
// Split report text into its standard sections (see routines/wg-steward.md); text before the first heading is dropped.
export function parseReport(text) {
  const out = {}; let cur = null;
  for (const line of String(text ?? '').split('\n')) {
    const m = SECTION_LABELS.map(([k, l]) => [k, new RegExp(`^\\s*(?:#+\\s*)?(?:\\d+b?[.)]\\s*)?\\**(?:${l})\\b\\**:?\\**\\s*(.*)$`, 'i').exec(line)]).find(([, x]) => x);
    if (m) { cur = m[0]; out[cur] = m[1][1] ? [m[1][1]] : []; } else if (cur && !REPORT_MARK.test(line)) out[cur].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.map((l) => l.trim()).filter(Boolean)]));
}

export const EXERCISE_TYPE = 'governance/exercise';
// Open exercises listed in this role's log (an exercise listed only in a group log is the group's own; the owner's log = a group asking the owner).
// The type has no lifecycle; if a state is present, closed and abandoned are not open.
export const exerciseItems = (records, log) => records.filter((r) => memberSet(log).has(r.instanceId) && !['closed', 'abandoned'].includes(r.record.lifecycleState));
// derived-from relations whose target is the exercise = proposals it fed
export const fedInto = (id, relations) => relations.filter((x) => x.targetId === id).length;

// The group's local priority: refs ("repo#n") in the latest ratified `Local priorities: ...` decision's statement, in order.
export function localPriorities(groupDecisions) {
  const d = groupDecisions.filter((r) => r.record.lifecycleState === 'ratified' && /^Local priorities:/.test(fv(r).title ?? ''))
    .sort((a, b) => String(b.record.createdAt).localeCompare(String(a.record.createdAt)))[0];
  return d ? [...String(fv(d).decision_statement ?? '').matchAll(/([\w.-]+)#(\d+)/g)].map((m) => `${m[1]}#${m[2]}`) : [];
}
// Builder's order: local priority first, then priority: P0|P1|P2 label, then oldest. issues: [{repo, number, title, created_at, labels:[names]}]
export function orderQueue(issues, local = []) {
  const rank = (i) => { const k = local.indexOf(`${i.repo}#${i.number}`); return k >= 0 ? k : 1e3; };
  const pr = (i) => { const m = /^priority:\s*P(\d)/i.exec(i.labels.find((l) => /^priority:/i.test(l)) ?? ''); return m ? Number(m[1]) : 9; };
  return [...issues].sort((a, b) => rank(a) - rank(b) || pr(a) - pr(b) || String(a.created_at).localeCompare(String(b.created_at)));
}
export const forecast = (ready, budget) => ready < budget ? `Queue running dry: ${ready} ready, budget ${budget}. Needs feeding.` : `Queue fed for about ${Math.floor(ready / budget)} cycle${Math.floor(ready / budget) > 1 ? 's' : ''}.`;
export const isDry = (ready, budget) => ready < budget;
// next: { ready: ordered issues, inFlight: n, merged: n, budget: n } -> lines
export const nextLines = (n) => !n ? [] : ['  Next:', `    Ready group issues: ${n.ready.length}`, ...n.ready.slice(0, 3).map((i) => `      ${i.repo}#${i.number} ${short(i.title, 70)}`),
  `    Group PRs in flight: ${n.inFlight}; budget left this cycle: ${Math.max(0, n.budget - n.merged)} of ${n.budget}`, `    ${forecast(n.ready.length, n.budget)}`];

export const mergeItems = (prs) => prs.filter((p) => !p.isDraft && p.mergeStateStatus === 'CLEAN'
  && lines(p.labels).some((l) => l.name === 'gate:owner-merge'));

// Stalled work, read-only (clerk#38): lists, never closes. Inputs are plain rows with ISO dates; `now` is a Date or ms.
// claims: [{ref, updatedAt}] open `status: in progress` issues; branches: [{repo, name, aheadBy, lastCommitAt}]; epics: [{ref, activityAt}]
// (latest activity of the epic or any child). A claim is stale after claimDays of silence (default 1: a live claim keeps committing or commenting),
// a branch with commits not on the default branch, and an epic, after days (default 14).
export const STALLED_DEFAULTS = { claimDays: 1, days: 14 };
export function stalledItems({ claims = [], branches = [], epics = [] }, now, opts = {}) {
  const { claimDays, days } = { ...STALLED_DEFAULTS, ...opts }, t = +now, age = (iso) => (t - Date.parse(iso)) / 864e5;
  const old = (iso, n) => iso && age(iso) > n;
  const out = (rows, n, f) => rows.filter((r) => old(r.at, n)).sort((a, b) => a.at.localeCompare(b.at)).map(f);
  const day = (iso) => Math.floor(age(iso));
  return [
    ...out(claims.map((c) => ({ ...c, at: c.updatedAt })), claimDays, (c) => ({ kind: 'claim', ref: c.ref, days: day(c.at), text: `claim ${c.ref} in progress, no activity for ${day(c.at)}d` })),
    ...out(branches.filter((b) => b.aheadBy > 0).map((b) => ({ ...b, at: b.lastCommitAt })), days, (b) => ({ kind: 'branch', ref: `${b.repo}:${b.name}`, days: day(b.at), text: `branch ${b.repo}:${b.name} unmerged (${b.aheadBy} commit${b.aheadBy > 1 ? 's' : ''}), last commit ${day(b.at)}d ago` })),
    ...out(epics.map((e) => ({ ...e, at: e.activityAt })), days, (e) => ({ kind: 'epic', ref: e.ref, days: day(e.at), text: `epic ${e.ref}: no child activity for ${day(e.at)}d` })),
  ];
}
export const stalledLines = (items) => items.length ? ['  Stalled (read-only; nothing here is closed for you):', ...items.map((i) => '    ' + i.text)] : [];

// done: { 1: n, 2: n, 3: n, 4: n } items dealt with in this session; tally: one line of this session's choices.
export function agendaLines({ ratify, reports, exercises = [], decide, merge, status, stalled = [], done = {}, tally = '' }) {
  const row = (n, label, items) => {
    const d = Math.min(done[n] ?? 0, items.length), left = items.length - d;
    const prog = items.length ? (d ? `   ${d} done · ${left} left` : '') + (items.length && !left ? '  ✓' : '') : '';
    return `  ${n}. ${label.padEnd(42)} ${String(items.length).padStart(3)}${prog}`;
  };
  return [
    'Agenda',
    row(1, 'Decisions since the last session', ratify), row(2, 'Reports from working groups', reports), row(3, 'Exercises: open discussions asking for input', exercises), row(4, 'Decisions for this session', decide), row(5, 'Merges', merge),
    '', ...status.map((s) => '  ' + s), ...(stalled.length ? ['', ...stalledLines(stalled)] : []), ...(tally ? ['', '  ' + tally] : []),
  ];
}

// "This session: 2 ratified · 1 set aside · 1 held · 1 edited · 1 comment · 1 report received · 0 merged"
export function tallyLine(choices, acted = { merge: 0 }) {
  const n = (f) => choices.filter(f).length;
  const parts = [
    [n((c) => ['ratify', 'accept', 'other'].includes(c.action)), 'ratified'], [n((c) => c.action === 'setaside'), 'set aside'],
    [n((c) => c.held), 'held'], [choices.reduce((a, c) => a + (c.edits?.length ?? 0), 0), 'edited'],
    [choices.reduce((a, c) => a + (c.comments?.length ?? 0), 0), 'comment'], [n((c) => c.action === 'receive'), 'report received'], [n((c) => c.exercise), 'exercise taken up'], [acted.merge, 'merged'],
  ].filter(([k]) => k).map(([k, w]) => `${k} ${k > 1 && w === 'comment' ? 'comments' : k > 1 && w === 'report received' ? 'reports received' : k > 1 && w === 'exercise taken up' ? 'exercises taken up' : w}`);
  return parts.length ? `This session so far: ${parts.join(' · ')} (recorded when you end the session; merges act at once)` : '';
}

// The choice already made for an item in this session, as one line, or null.
export function choiceLine(c) {
  if (!c) return null;
  const what = c.held ? `held${c.note ? ` (${c.note})` : ''}` : ({ ratify: 'ratify', setaside: 'set aside', accept: 'accept recommendation', other: 'ratify with your resolution', consider: c.exercise ? 'exercise taken up' : 'taken up', receive: 'report received' })[c.action];
  const extra = [c.edits?.length ? `${c.edits.length} edit${c.edits.length > 1 ? 's' : ''}` : '', c.comments?.length ? `${c.comments.length} comment${c.comments.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
  return `  This session: ${what}${extra ? `; ${extra}` : ''}  (press a key to change it)`;
}

export const statusLine = (name, pause, merged, budget) =>
  `${name}: ${pause.startsWith('paused') ? pause.toUpperCase() : 'running'}, merged ${merged}/${budget} this cycle`;

const short = (s, n = 300) => { s = String(s ?? '-').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const who = (r) => `${r.record.createdBy?.name ?? r.record.createdBy?.id ?? 'unattributed'}, ${String(r.record.createdAt).slice(0, 10)}`;

// Dates (YYYY-MM-DD) of the sessions that took a decision up: `considers` relations joined to session records.
// relations: [{sourceId,targetId}] of type considers; sessions: [{instanceId, record}] -> sorted dates
export const consideredIn = (id, relations, sessions) => {
  const held = new Map(sessions.map((s) => [s.instanceId, String(fv(s).held_at ?? '').slice(0, 10)]));
  return relations.filter((x) => x.targetId === id).map((x) => held.get(x.sourceId) ?? '?').sort();
};
export const historyLine = (dates) => dates.length ? `  History:    Considered in ${dates.length} earlier session${dates.length > 1 ? 's' : ''} (${dates.join(', ')})` : '  History:    Not yet considered in a session';

export function decisionScreen(r, history = [], disc = []) {
  const f = fv(r);
  return [`${f.title}  [${r.instanceId.slice(0, 8)}]`, `  Resolution: ${short(f.decision_statement, 400)}`, `  Why:        ${short(f.rationale)}`,
    `  Options:    ${short(f.alternatives_considered)}`, `  Review:     ${short(f.revisit_when, 160)}`, `  Recorded:   ${who(r)}`, historyLine(history), ...disc];
}

export function exerciseScreen(r, history = [], disc = [], fed = 0) {
  const f = fv(r);
  return [`${f.title}  [${r.instanceId.slice(0, 8)}]  (exercise: no decision attached)`, `  Thinking so far:      ${short(f.thinking_reached, 400)}`, `  Tensions:             ${short(f.tensions)}`,
    `  Input asked for:      ${short(f.unresolved_questions, 400)}`, `  Blocking:             ${short(f.blocking, 160)}`, `  Next action:          ${short(f.next_action, 160)}`,
    `  Raised:               ${who(r)}`, historyLine(history), `  Fed into ${fed} proposal${fed === 1 ? '' : 's'}`, ...disc];
}

export function escalationScreen(r, history = [], disc = []) {
  const f = fv(r);
  return [`${f.title}  [${r.instanceId.slice(0, 8)}]`, `  Question:       ${short(f.decision_question, 400)}`,
    `  Why it matters: ${short(f.friction || f.context)}`, `  Options:        ${short(f.alternatives_considered)}`,
    `  Recommendation: ${short(f.decision_statement, 400)}`, `  Raised:         ${who(r)}`, historyLine(history), ...disc];
}

const trim = (ls, n = 3) => (ls.length > n ? [...ls.slice(0, n), '…  ([o]pen shows all)'] : ls);
// At the owner's level: group, cycle, the standard sections trimmed, pause state. waiting = escalations now on the Decisions for this session section.
export function reportScreen(it, { pause = 'n/a', waiting = 0, exercises = 0, next = null } = {}) {
  const p = parseReport(it.text), sec = (k, label) => p[k]?.length ? [`  ${label}:`, ...trim(p[k]).map((l) => '    ' + short(l, 160))] : [];
  return [`${reportTitle(it)}${it.commentOnly ? '  (comment only)' : ''}`,
    `  Decisions for you: ${waiting} waiting (see Decisions for this session)`, ...sec('decided', 'Decided within mandate (for noting)'),
    ...sec('done', 'Done'), ...sec('stuck', 'Stuck'), ...sec('budget', 'Budget'), ...sec('learned', 'What we learned'),
    ...(exercises ? [`  Exercises open: ${exercises} (asking for input)`] : []), ...nextLines(next),
    `  Group: ${pause.startsWith('paused') ? pause.toUpperCase() : 'running'}`];
}

export function checksState(pr) {
  const c = lines(pr.statusCheckRollup);
  if (!c.length) return 'no checks';
  const bad = c.filter((x) => (x.conclusion || x.state) && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(x.conclusion || x.state));
  const pend = c.filter((x) => !(x.conclusion || x.state));
  return bad.length ? `${bad.length} failing` : pend.length ? `${pend.length} pending` : 'all green';
}

export function prScreen(pr) {
  const asked = /^.*Decision asked:.*$/mi.exec(pr.body ?? '')?.[0].trim();
  return [`${pr.title}`, `  ${pr.repo}#${pr.number}  ${pr.url ?? ''}`, `  ${asked ?? 'Decision asked: (none stated)'}`, `  Checks: ${checksState(pr)}`];
}

export const fullScreen = (r) => Object.entries(fv(r)).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
