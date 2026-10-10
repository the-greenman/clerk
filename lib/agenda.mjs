// Pure agenda building and item formatting. No I/O: everything takes parsed JSON.
export const REPORT_MARK = /^<!-- wg-report cycle=[0-9-]+ -->/;
export const ESCALATOR = 'agent:tpr-steward';

const lines = (a) => (Array.isArray(a) ? a : []);
export const fv = (r) => r.record.fieldValues ?? {};
const memberSet = (c) => new Set(lines(c?.memberInstanceIds).map((m) => (typeof m === 'string' ? m : m.instanceId)));

// Proposed decisions in the SemanticOps log awaiting ratification.
export function ratifyItems(records, mainLog) {
  const m = memberSet(mainLog);
  return records.filter((r) => r.record.lifecycleState === 'proposed' && m.has(r.instanceId));
}

// Escalations: proposed in the group log by the group steward, not yet in the SemanticOps log.
export function escalationItems(records, groupLog, mainLog) {
  const g = memberSet(groupLog), m = memberSet(mainLog);
  return records.filter((r) => r.record.lifecycleState === 'proposed' && r.record.createdBy?.id === ESCALATOR
    && g.has(r.instanceId) && !m.has(r.instanceId));
}

// Report comments (owner-authored, marked) lacking a +1 from owner. reactions: {commentId: [{content,user:{login}}]}
export function unackedReports(comments, reactions, ownerLogin) {
  return comments
    .filter((c) => c.author_association === 'OWNER' && REPORT_MARK.test(c.body))
    .filter((c) => !lines(reactions[c.id]).some((x) => x.content === '+1' && x.user?.login === ownerLogin));
}

export const mergeItems = (prs) => prs.filter((p) => !p.isDraft && p.mergeStateStatus === 'CLEAN'
  && lines(p.labels).some((l) => l.name === 'gate:owner-merge'));

export function agendaLines({ ratify, decide, ack, merge, status }) {
  const row = (n, label, items) => `  ${n}. ${label.padEnd(12)} ${String(items.length).padStart(3)}`;
  return [
    'Owner agenda',
    row(1, 'Ratify', ratify), row(2, 'Decide', decide), row(3, 'Acknowledge', ack), row(4, 'Merge', merge),
    '', ...status.map((s) => '  ' + s),
  ];
}

export const statusLine = (name, pause, merged, budget) =>
  `${name}: ${pause.startsWith('paused') ? pause.toUpperCase() : 'running'}, merged ${merged}/${budget} this cycle`;

const short = (s, n = 300) => { s = String(s ?? '-').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const who = (r) => `${r.record.createdBy?.name ?? r.record.createdBy?.id ?? 'unattributed'}, ${String(r.record.createdAt).slice(0, 10)}`;

export function decisionScreen(r) {
  const f = fv(r);
  return [`${f.title}  [${r.instanceId.slice(0, 8)}]`, `  Resolution: ${short(f.decision_statement, 400)}`, `  Why:        ${short(f.rationale)}`,
    `  Options:    ${short(f.alternatives_considered)}`, `  Review:     ${short(f.revisit_when, 160)}`, `  Recorded:   ${who(r)}`];
}

export function escalationScreen(r) {
  const f = fv(r);
  return [`${f.title}  [${r.instanceId.slice(0, 8)}]`, `  Question:       ${short(f.decision_question, 400)}`,
    `  Why it matters: ${short(f.friction || f.context)}`, `  Options:        ${short(f.alternatives_considered)}`,
    `  Recommendation: ${short(f.decision_statement, 400)}`, `  Raised:         ${who(r)}`];
}

export const reportScreen = (c) => [`Report, ${c.created_at.slice(0, 10)}  ${c.html_url}`, ...c.body.split('\n').slice(0, 12).map((l) => '  ' + l)];

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
