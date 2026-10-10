import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../lib/agenda.mjs';
import { quorum, quorumText, ROLES, GROUP_MEMBERS } from '../lib/roles.mjs';
import { take, assertQuorum, summarise, endSession } from '../lib/session.mjs';

const owner = { ...ROLES.owner, roleId: 'owner-role', logId: 'L' };
const grp = ROLES['tpr-steward'];
const at = (...ids) => ids.map((id) => ({ id, name: id }));

test('quorum, SemanticOps: the Owner role must attend', () => {
  assert.equal(quorum(owner, at('owner-role')).met, true);
  const q = quorum(owner, at('someone'));
  assert.deepEqual([q.met, q.needs], [false, 'the Owner role']);
  assert.equal(quorumText(q), 'quorum: not met (needs the Owner role)');
});
test('quorum, group: two distinct members, one the reviewer', () => {
  const { steward, builder, reviewer } = GROUP_MEMBERS;
  assert.equal(quorum(grp, at(steward)).needs, 'two distinct group members and the reviewer agent');
  assert.equal(quorum(grp, at(steward, builder)).needs, 'the reviewer agent');
  assert.equal(quorum(grp, at(reviewer)).needs, 'two distinct group members');
  assert.equal(quorum(grp, at(steward, steward, 'x')).met, false, 'duplicates and non-members do not count');
  assert.equal(quorum(grp, at(steward, reviewer)).met, true);
});

const it = { instanceId: 'abcdef123456', title: 'T' };
test('[e] and [h] produce considers; [r] produces ratifies', () => {
  const ch = [];
  take(ch, it, { edit: { field: 'why', text: 'x' } });
  take(ch, it, { edit: { field: 'why', text: 'y' } }); // several edits in one session are fine
  assert.deepEqual([ch.length, ch[0].action, ch[0].edits.length], [1, 'consider', 2]);
  take(ch, it, { hold: true, note: 'needs reviewer' });
  assert.match(summarise(ch, 'S'), /- Edited: T \[abcdef12\] \(why\)\n- Held: T \[abcdef12\]: needs reviewer/);
  take(ch, it, { action: 'ratify' });
  assert.deepEqual([ch[0].action, ch[0].held], ['ratify', false]);
  assert.throws(() => take([], it, { edit: { field: 'nope', text: 'x' } }), /unknown field/);
});
test('ratify and set aside are refused below quorum; consider-only sessions are valid', () => {
  const no = { met: false, needs: 'the Owner role' };
  assert.throws(() => assertQuorum([{ ...it, id: 'a', action: 'ratify' }], no), /quorum not met \(needs the Owner role\)/);
  assert.throws(() => assertQuorum([{ ...it, id: 'a', action: 'setaside' }], no), /quorum not met/);
  assertQuorum([{ ...it, id: 'a', action: 'consider', edits: [] }], no);
  const out = [];
  endSession({ role: owner, choices: [{ id: 'abcdef123', title: 'T', action: 'consider', edits: [] }], attendees: at('x'), quorum: no, dryRun: true, log: (m) => out.push(m) });
  assert.match(out[0], /Considered: T/);
  assert.throws(() => endSession({ role: owner, choices: [{ id: 'abcdef123', title: 'T', action: 'ratify' }], attendees: [], quorum: no, dryRun: true, log() {} }), /quorum/);
});
test('history counts earlier sessions that considered a decision', () => {
  const sessions = [{ instanceId: 's1', record: { fieldValues: { held_at: '2026-10-01T09:00:00Z' } } }, { instanceId: 's2', record: { fieldValues: { held_at: '2026-10-05T09:00:00Z' } } }];
  const rels = [{ sourceId: 's2', targetId: 'd' }, { sourceId: 's1', targetId: 'd' }, { sourceId: 's1', targetId: 'other' }];
  const dates = A.consideredIn('d', rels, sessions);
  assert.deepEqual(dates, ['2026-10-01', '2026-10-05']);
  assert.match(A.historyLine(dates), /Considered in 2 earlier sessions \(2026-10-01, 2026-10-05\)/);
  assert.match(A.historyLine([]), /Not yet considered/);
  const r = { instanceId: 'd', record: { fieldValues: { title: 'D' }, createdAt: '2026-10-01' } };
  assert.match(A.decisionScreen(r, dates).join('\n'), /History:\s+Considered in 2/);
});

import * as D from '../lib/discussion.mjs';
const cm = (id, at, text = id, by = { kind: 'human', id: 'h', name: 'Owner' }) => ({ instanceId: id, record: { createdAt: at, createdBy: by, fieldValues: { comment_text: text } } });
const on = (s, t) => ({ sourceId: s, targetId: t });
test('comment threading: top-level by time, replies nested under their parent', () => {
  const cs = [cm('c2', '2026-10-03'), cm('c1', '2026-10-01', 'first\nmore'), cm('r1', '2026-10-04', 'reply', { kind: 'ai', id: 'agent:x', name: 'Analyst' }), cm('r2', '2026-10-05'), cm('other', '2026-10-02')];
  const rels = [on('c1', 'd'), on('c2', 'd'), on('r1', 'c1'), on('r2', 'r1'), on('other', 'zzz')];
  const th = D.thread('d', rels, cs);
  assert.deepEqual(th.map((t) => [t.comment.instanceId, t.depth]), [['c1', 0], ['r1', 1], ['r2', 2], ['c2', 0]]);
  const lines = D.discussionLines(th);
  assert.equal(lines[0], '  Discussion: 4 comments (latest 3; [v] for all)');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^ {4} {2}Analyst 2026-10-04: reply$/); // reply indented once
  assert.equal(D.discussionLines(th, true).length, 5);
});
test('a comment produces considers in the session plan and a sourceRef', () => {
  const ch = [];
  take(ch, it, { comment: { text: 'see the meeting\nsecond line', cite: 'transcript', note: 'at 12:40' } });
  assert.equal(ch[0].action, 'consider');
  assert.match(summarise(ch, 'S'), /- Commented: T \[abcdef12\] \(1, with citation\)/);
  const out = [];
  endSession({ role: owner, choices: ch, attendees: at('x'), quorum: { met: false, needs: 'x' }, transcript: '/tmp/m.md', dryRun: true, log: (m) => out.push(m) });
  assert.match(out[0], /Transcript: m\.md[\s\S]*sourceRef \{"sourceType":"repository-document","sourceId":"<transcript>","sourceRole":"quoted-from","note":"at 12:40"\}; session considers it/);
  assert.throws(() => endSession({ role: owner, choices: ch, attendees: [], quorum: { met: true }, dryRun: true, log() {} }), /no transcript/);
});
test('citations build correct sourceRefs', () => {
  const id = '6470ec00-7380-4333-8a28-c1ed1f8bbb5a';
  assert.deepEqual(D.buildSourceRef(id), { sourceType: 'repository-document', sourceId: id, sourceRole: 'evidence' });
  assert.deepEqual(D.buildSourceRef('https://x.org/a', 'quoted-from'), { sourceType: 'external-document', sourceId: 'https://x.org/a', sourceRole: 'quoted-from' });
  assert.equal(D.buildSourceRef('transcript', undefined, { transcriptId: id }).sourceRole, 'quoted-from');
  assert.equal(D.buildSourceRef(undefined), null);
  assert.throws(() => D.buildSourceRef('transcript'), /no transcript/);
  assert.throws(() => D.buildSourceRef('nonsense'), /cite must be/);
});
