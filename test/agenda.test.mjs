import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../lib/practice/agenda.mjs';
import { summarise, sessionTitle, heldAtIso, stamp } from '../lib/practice/session.mjs';
import { authorise, resolveContext, ROLES } from '../lib/practice/roles.mjs';

const d = (id, state, by, title = id) => ({ instanceId: id, record: { lifecycleState: state, createdBy: { id: by }, createdAt: '2026-10-10T10:00:00Z', fieldValues: { title } } });
const log = (...ids) => ({ memberInstanceIds: ids.map((instanceId) => ({ instanceId })) });
const recs = [d('a', 'proposed', 'agent:orchestrator'), d('b', 'ratified', 'human:x'), d('c', 'proposed', 'agent:tpr-steward'),
  d('e', 'proposed', 'agent:tpr-steward'), d('f', 'proposed', 'agent:other')];

test('ratify: proposed and in the main log only', () => {
  assert.deepEqual(A.ratifyItems(recs, log('a', 'b', 'e')).map((r) => r.instanceId), ['a', 'e']);
});
test('decide: steward proposals in the group log, not yet in the main log', () => {
  assert.deepEqual(A.escalationItems(recs, log('a', 'c', 'e', 'f'), log('e')).map((r) => r.instanceId), ['c']);
});
const run = (id, date, chose) => ({ instanceId: id, record: { fieldValues: { title: 'Run ' + date, run_date: date, chose } } });
const mark = (id, date, body = 'x') => ({ id, body: `<!-- wg-report cycle=${date} -->\n${body}`, created_at: date + 'T11:30:00Z', html_url: 'u' + id });
const REPORT = ['1. Decisions for you: None', '2. Decided within mandate:', '- a (why: b)', '- c', '- d', '- e', '3. Done: 2 PRs', '4. Stuck or lost: none',
  '5. Budget: 2 of 10', '5b. Awaiting ratification: none', 'What we learned: reports are short'].join('\n');
test('reports: unreceived records paired with their comment by cycle date; comment-only fallback', () => {
  const rr = [run('r1', '2026-10-09', REPORT), run('r2', '2026-10-10', REPORT)];
  const cs = [mark(1, '2026-10-10'), mark(2, '2026-10-11'), mark(3, '2026-10-12'), { id: 4, body: 'chat' }];
  const out = A.reportItems(rr, new Set(['r1']), cs, new Set([3]), 'WG');
  assert.deepEqual(out.map((x) => [x.instanceId, x.cycle, x.commentOnly ?? false, x.comment?.id]), [['r2', '2026-10-10', false, 1], ['comment:2', '2026-10-11', true, 2]]);
  assert.equal(A.reportItems([], new Set(), [], new Set(), 'WG').length, 0);
});
test('report screen: sections trimmed, escalations point at section 3, pause shown', () => {
  const it = A.reportItems([run('r1', '2026-10-10', REPORT)], new Set(), [], new Set(), 'WG')[0];
  const out = A.reportScreen(it, { pause: 'paused: 2 reports unacknowledged', waiting: 2 }).join('\n');
  assert.match(out, /WG report 2026-10-10/);
  assert.match(out, /Decisions for you: 2 waiting \(see Decisions for this session\)/);
  assert.match(out, /Decided within mandate[\s\S]*- a \(why: b\)[\s\S]*\[o\]pen shows all/);
  assert.doesNotMatch(out, /- e/);
  assert.match(out, /Done:\n    2 PRs[\s\S]*Budget:\n    2 of 10[\s\S]*What we learned:\n    reports are short[\s\S]*PAUSED/);
  assert.doesNotMatch(out, /Awaiting/);
  assert.match(A.reportScreen(A.reportItems([], new Set(), [mark(2, '2026-10-11', REPORT)], new Set(), 'WG')[0]).join('\n'), /comment only/);
});
test('merge: clean owner-merge PRs, not drafts', () => {
  const p = (n, s, label = 'gate:owner-merge', isDraft = false) => ({ number: n, mergeStateStatus: s, isDraft, labels: [{ name: label }] });
  assert.deepEqual(A.mergeItems([p(1, 'CLEAN'), p(2, 'BEHIND'), p(3, 'CLEAN', 'gate:auto-merge'), p(4, 'CLEAN', 'gate:owner-merge', true)]).map((x) => x.number), [1]);
});
test('screens and status', () => {
  assert.match(A.prScreen({ title: 't', repo: 'srs', number: 5, body: 'x\nDecision asked: ship it?\ny', statusCheckRollup: [{ conclusion: 'SUCCESS' }] }).join('\n'), /Decision asked: ship it\?[\s\S]*all green/);
  assert.equal(A.statusLine('G', 'ok', '3', '10'), 'G: running, merged 3/10 this cycle');
  assert.match(A.statusLine('G', 'paused: 2 reports unacknowledged', '0', '10'), /PAUSED/);
    assert.match(summarise([{ id: 'abcdef123', title: 'T', action: 'setaside' }], 'Session X'), /Set aside: T \[abcdef12\]/);
});

const act = (kind, id) => JSON.stringify({ kind, id });
test('role authority: owner ok; an AI holding tpr-steward ok for that role; mismatches refused', () => {
  assert.equal(authorise('owner', act('human', 'human:the-greenman')), ROLES.owner);
  assert.equal(authorise('tpr-steward', act('ai', 'agent:tpr-steward')), ROLES['tpr-steward']);
  assert.throws(() => authorise('owner', act('ai', 'agent:tpr-steward')), /agent:tpr-steward does not hold the role "owner"/);
  assert.throws(() => authorise('tpr-builder', act('ai', 'agent:tpr-steward')), /tpr-builder/);
  assert.throws(() => authorise('owner', undefined), /SRS_ACTOR/);
  assert.throws(() => authorise('chair', act('human', 'x')), /unknown role/);
});
test('role context resolves the Owner role and log by title', () => {
  const r = resolveContext(ROLES.owner, [{ instanceId: 'r1', record: { fieldValues: { title: 'Owner' } } }], [{ containerId: 'c1', title: 'SemanticOps decision log' }]);
  assert.deepEqual([r.roleId, r.logId], ['r1', 'c1']);
  assert.throws(() => resolveContext(ROLES.owner, [], []), /Owner/);
});
test('session title, held_at and summary', () => {
  const d = new Date('2026-10-10T14:30:45Z');
  assert.equal(stamp(d), '2026-10-10 14:30 UTC');
  assert.equal(heldAtIso(d), '2026-10-10T14:30:45Z');
  const t = sessionTitle(d, 'SemanticOps');
  assert.equal(t, 'Session 2026-10-10 14:30 UTC: SemanticOps');
  assert.equal(summarise([{ id: 'abcdef123', title: 'T', action: 'ratify' }], t, [{ id: 'r', name: 'Owner' }]),
    'Session 2026-10-10 14:30 UTC: SemanticOps\nAttendees: Owner\n- Ratified: T [abcdef12]');
});

test('a decision listed in a parent log is the parent context\'s to ratify', async () => {
  const { ratifyItems } = await import('../lib/practice/agenda.mjs');
  const rec = (id) => ({ instanceId: id, record: { lifecycleState: 'proposed', fieldValues: { title: id } } });
  const records = [rec('local'), rec('escalated')];
  const groupLog = { memberInstanceIds: [{ instanceId: 'local' }, { instanceId: 'escalated' }] };
  const ownerLog = { memberInstanceIds: [{ instanceId: 'escalated' }] };
  assert.deepEqual(ratifyItems(records, groupLog, [ownerLog]).map((r) => r.instanceId), ['local']);
  assert.deepEqual(ratifyItems(records, ownerLog).map((r) => r.instanceId), ['escalated']);
});

test('agenda shows progress per section and a tally of the session so far', () => {
  const items = [1, 2, 3, 4].map((i) => ({ instanceId: 'd' + i }));
  const lines = A.agendaLines({ ratify: items, reports: [], decide: [], merge: [], status: [], done: { 1: 2 }, tally: 'This session so far: 2 ratified' });
  assert.match(lines[1], /4   2 done · 2 left$/);
  assert.match(lines.at(-1), /This session so far: 2 ratified/);
  const all = A.agendaLines({ ratify: items, reports: [], decide: [], merge: [], status: [], done: { 1: 4 } });
  assert.match(all[1], /4 done · 0 left  ✓$/);
  const t = A.tallyLine([{ action: 'ratify', edits: [], comments: [] }, { action: 'setaside', edits: [], comments: [{}] }, { action: 'consider', held: true, edits: [{}], comments: [] }], { merge: 0 });
  assert.match(t, /1 ratified · 1 set aside · 1 held · 1 edited · 1 comment/);
  assert.match(A.tallyLine([{ action: 'receive', report: true }]), /1 report received/);
  assert.match(A.tallyLine([{ action: 'receive' }, { action: 'receive' }]), /2 reports received/);
  assert.equal(A.tallyLine([]), '');
  assert.match(A.choiceLine({ action: 'consider', held: true, note: 'for Mark', edits: [], comments: [] }), /This session: held \(for Mark\)/);
});

test('agenda follows a meeting: decisions since, reports, decisions for this session, merges', () => {
  const l = A.agendaLines({ ratify: [1], reports: [1, 2], exercises: [1], decide: [], merge: [], status: [], done: { 2: 1 } });
  assert.match(l[1], /1\. Decisions since the last session/);
  assert.match(l[2], /2\. Reports from working groups\s+2   1 done · 1 left$/);
  assert.match(l[3], /3\. Exercises: open discussions asking for input\s+1$/);
  assert.match(l[4], /4\. Decisions for this session/);
  assert.match(l[5], /5\. Merges/);
});

const ex = (id, state) => ({ instanceId: id, record: { lifecycleState: state, fieldValues: { title: id, thinking_reached: 't', unresolved_questions: 'q?' } } });
test('exercises: open ones listed in the role log; fed-into counts derived-from', () => {
  const rs = [ex('a'), ex('b', 'closed'), ex('c', 'abandoned'), ex('d'), ex('e', 'active')];
  assert.deepEqual(A.exerciseItems(rs, log('a', 'b', 'c', 'e')).map((r) => r.instanceId), ['a', 'e']);
  assert.equal(A.fedInto('a', [{ targetId: 'a' }, { targetId: 'a' }, { targetId: 'z' }]), 2);
  const out = A.exerciseScreen(ex('a'), [], [], 2).join('\n');
  assert.match(out, /Input asked for:\s+q\?[\s\S]*Fed into 2 proposals/);
  assert.match(A.reportScreen({ text: '', cycle: 'c', group: 'G' }, { exercises: 2 }).join('\n'), /Exercises open: 2 \(asking for input\)/);
});
test('queue: builder order, forecast fed vs dry', () => {
  const i = (n, labels, created_at) => ({ repo: 'srs', number: n, title: 't' + n, labels, created_at });
  const q = [i(1, [], '2026-01-01'), i(2, ['priority: P1'], '2026-02-01'), i(3, ['priority: P0'], '2026-03-01'), i(4, ['priority: P0'], '2026-01-05')];
  assert.deepEqual(A.orderQueue(q).map((x) => x.number), [4, 3, 2, 1]);
  assert.deepEqual(A.orderQueue(q, ['srs#1']).map((x) => x.number), [1, 4, 3, 2]);
  const lp = (st) => ({ instanceId: 'l', record: { lifecycleState: st, createdAt: 'x', fieldValues: { title: 'Local priorities: x', decision_statement: 'srs-rust#5 then the-greenman/srs#7' } } });
  assert.deepEqual(A.localPriorities([lp('ratified')]), ['srs-rust#5', 'srs#7']);
  assert.deepEqual(A.localPriorities([lp('proposed')]), []);
  assert.equal(A.forecast(25, 10), 'Queue fed for about 2 cycles.');
  assert.equal(A.forecast(3, 10), 'Queue running dry: 3 ready, budget 10. Needs feeding.');
  const n = A.nextLines({ ready: q, inFlight: 2, merged: 4, budget: 10 }).join('\n');
  assert.match(n, /Ready group issues: 4[\s\S]*budget left this cycle: 6 of 10[\s\S]*running dry: 4 ready/);
});
