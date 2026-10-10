import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../lib/agenda.mjs';
import { summarise, sessionTitle, heldAtIso, stamp } from '../lib/session.mjs';
import { authorise, resolveContext, ROLES } from '../lib/roles.mjs';

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
test('acknowledge: owner reports without the owner +1', () => {
  const c = (id, body = '<!-- wg-report cycle=2026-10-10 -->\nx', aa = 'OWNER') => ({ id, body, author_association: aa });
  const out = A.unackedReports([c(1), c(2), c(3, 'chat'), c(4, undefined, 'NONE')],
    { 1: [{ content: '+1', user: { login: 'me' } }], 2: [{ content: '+1', user: { login: 'other' } }] }, 'me');
  assert.deepEqual(out.map((x) => x.id), [2]);
});
test('merge: clean owner-merge PRs, not drafts', () => {
  const p = (n, s, label = 'gate:owner-merge', isDraft = false) => ({ number: n, mergeStateStatus: s, isDraft, labels: [{ name: label }] });
  assert.deepEqual(A.mergeItems([p(1, 'CLEAN'), p(2, 'BEHIND'), p(3, 'CLEAN', 'gate:auto-merge'), p(4, 'CLEAN', 'gate:owner-merge', true)]).map((x) => x.number), [1]);
});
test('screens and status', () => {
  assert.match(A.prScreen({ title: 't', repo: 'srs', number: 5, body: 'x\nDecision asked: ship it?\ny', statusCheckRollup: [{ conclusion: 'SUCCESS' }] }).join('\n'), /Decision asked: ship it\?[\s\S]*all green/);
  assert.equal(A.statusLine('G', 'ok', '3', '10'), 'G: running, merged 3/10 this cycle');
  assert.match(A.statusLine('G', 'paused: 2 reports unacknowledged', '0', '10'), /PAUSED/);
  assert.equal(A.reportScreen({ created_at: '2026-10-10T0', html_url: 'u', body: Array(30).fill('l').join('\n') }).length, 13);
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
  const { ratifyItems } = await import('../lib/agenda.mjs');
  const rec = (id) => ({ instanceId: id, record: { lifecycleState: 'proposed', fieldValues: { title: id } } });
  const records = [rec('local'), rec('escalated')];
  const groupLog = { memberInstanceIds: [{ instanceId: 'local' }, { instanceId: 'escalated' }] };
  const ownerLog = { memberInstanceIds: [{ instanceId: 'escalated' }] };
  assert.deepEqual(ratifyItems(records, groupLog, [ownerLog]).map((r) => r.instanceId), ['local']);
  assert.deepEqual(ratifyItems(records, ownerLog).map((r) => r.instanceId), ['escalated']);
});
