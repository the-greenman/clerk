import test from 'node:test';
import assert from 'node:assert/strict';
import { checkClaim, claimAssigns, claimActorOf, claimComment, refersTo } from '../lib/practice/claim.mjs';
import { answersOf } from '../lib/practice/grounding.mjs';
import { fxGroup, tprGroup } from './groups.fixture.mjs';
import { readFileSync } from 'node:fs';
import { workflowFrom } from '../lib/practice/workflow.mjs';

const W = workflowFrom(JSON.parse(readFileSync(new URL('./workflow.fixture.json', import.meta.url), 'utf8')));

const issue = { repo: 'fixture', number: 10, state: 'open', labels: [{ name: 'wg:fixture' }], assignees: [], body: 'Answers: SP-901' };
const base = { issue, groups: [tprGroup, fxGroup], affirmed: new Set(['SP-901']), actor: 'agent:fx-builder', seat: 'builder', ownerActor: 'human:ada', W, state: { pause: 'ok', budget: 10, merged: 3, open: 2 } };
const why = (o) => checkClaim({ ...base, ...o }).reasons.join('|');

test('a member in the right seat on a grounded, free issue may claim', () => {
  const r = checkClaim(base);
  assert.deepEqual([r.ok, r.reasons, r.group.label], [true, [], 'wg:fixture']);
});
test('the owner may claim builder and reviewer seats, not steward', () => {
  assert.equal(checkClaim({ ...base, actor: 'human:ada' }).ok, true);
  assert.equal(checkClaim({ ...base, actor: 'human:ada', seat: 'reviewer' }).ok, true);
  assert.match(why({ actor: 'human:ada', seat: 'steward' }), /does not hold the steward seat/);
});
test('wrong seat or a stranger is refused', () => {
  assert.match(why({ seat: 'reviewer' }), /does not hold the reviewer seat/);
  assert.match(why({ actor: 'agent:tpr-builder' }), /does not hold the builder seat in WG Fixture/);
});
test('refusal reasons', () => {
  assert.match(why({ issue: { ...issue, state: 'closed' } }), /not open/);
  assert.match(why({ prs: [{ repo: 'fixture', number: 50, title: 'Closes #10' }] }), /open PR.*fixture#50/);
  assert.match(why({ branches: ['10-x'] }), /remote branch/);
  assert.match(why({ issue: { ...issue, assignees: [{ login: 'x' }] } }), /already assigned/);
  assert.match(why({ issue: { ...issue, labels: [{ name: 'wg:fixture' }, { name: 'status: in progress' }] } }), /already claimed/);
  assert.match(why({ issue: { ...issue, labels: [] } }), /no working group label/);
  assert.match(why({ issue: { ...issue, body: 'no link' } }), /no "Answers/);
  assert.match(why({ issue: { ...issue, body: 'No affirmed problem yet: widgets' } }), /answers no affirmed problem/);
  assert.match(why({ affirmed: new Set() }), /SP-901 is not affirmed/);
});
test('answersOf reads both forms', () => {
  assert.deepEqual(answersOf('x\nAnswers: SP-1, SP-22').problems, ['SP-1', 'SP-22']);
  assert.equal(answersOf('No affirmed problem yet: foo').none, 'foo');
  assert.equal(answersOf('nothing').stated, false);
});

test('an open claim comment refuses a claim even with no label or assignee; an unlabel closes it', () => {
  const claimed = [{ event: 'commented', body: 'Claimed by agent:x as builder of WG Fixture (clerk claim). Branch: 10-a.' }];
  assert.match(why({ issue: { ...issue, timeline: claimed } }), /open claim comment by agent:x/);
  assert.equal(checkClaim({ ...base, issue: { ...issue, timeline: [...claimed, { event: 'unlabeled', label: { name: 'status: in progress' } }] } }).ok, true);
  assert.match(why({ issue: { ...issue, timeline: [{ event: 'commented', body: 'Claimed by orchestrator session (Sonnet worker).' }] } }), /by orchestrator\)/);
});
test('only the owner\'s own actor assigns; the claim comment names its actor', () => {
  assert.equal(claimAssigns('human:ada', 'human:ada'), true);
  assert.equal(claimAssigns('agent:fx-builder', 'human:ada'), false);
  assert.equal(claimAssigns('human:ada', undefined), false);
  assert.equal(claimActorOf(claimComment('agent:fx-builder', 'builder', 'WG Fixture', '10-a')), 'agent:fx-builder');
  assert.equal(claimActorOf('no claim here'), null);
});

test('claim: an item in review or held is not claimed', () => {
  const withLabels = (...names) => ({ issue: { ...issue, labels: [...issue.labels, ...names.map((name) => ({ name }))] } });
  assert.match(why(withLabels('status: in review')), /already in review/);
  assert.match(why(withLabels('needs-input')), /held \(needs-input\)/);
  assert.match(why(withLabels('parked', 'blocked')), /held \(blocked, parked\)|held \(parked, blocked\)/);
});

test('graded (a care policy in force): uncertainty about the theory is a caution, never a refusal (clerk#156)', () => {
  const g = (o) => checkClaim({ ...base, graded: true, ...o });
  const none = g({ issue: { ...issue, body: 'Fix the thing.' } });
  assert.deepEqual([none.ok, none.reasons, none.cautions], [true, [], ['its body has no "Answers: SP-nn" line']]);
  assert.equal(g({ affirmed: new Set() }).ok, true, 'an unaffirmed problem only cautions');
  assert.match(g({ affirmed: new Set() }).cautions[0], /SP-901 is not affirmed/);
  assert.equal(g({ issue: { ...issue, body: 'No affirmed problem yet: x' } }).ok, true);
  assert.equal(checkClaim({ ...base, affirmed: new Set() }).ok, false, 'without a policy the old rule refuses');
});

test('graded: collisions, holds and seats still refuse', () => {
  const g = (o) => checkClaim({ ...base, graded: true, issue: { ...issue, body: 'no answers' }, ...o });
  assert.equal(g({ prs: [{ repo: 'fixture', number: 50, title: 'Closes #10' }] }).ok, false);
  assert.equal(g({ issue: { ...issue, body: 'x', assignees: [{ login: 'someone' }] } }).ok, false);
  assert.equal(g({ seat: 'reviewer' }).ok, false);
});

test('a PR refers to an issue by "#n" or "<repo>#n", never by another repo\'s number (clerk#204 review)', () => {
  const pr = (body) => ({ repo: 'clerk', title: 't', body, head: { ref: 'x' } });
  assert.equal(refersTo('clerk', 25, pr('see srs-lab#25 and srs-lab/x#25')), false);
  for (const b of ['Closes #25', 'Fixes clerk#25.', 'resolves the-greenman/clerk#25', 'Closes: #25']) assert.equal(refersTo('clerk', 25, pr(b)), true, b);
  assert.equal(refersTo('clerk', 25, pr('#250')), false);
  assert.equal(refersTo('clerk', 25, pr('Closes #250')), false);
});

test('a PR that only mentions an issue does not take it on (clerk#275)', () => {
  const pr = (body, title = 't') => ({ repo: 'clerk', title, body, head: { ref: 'x' } });
  for (const b of ['the owner\'s answer is to add types by install (clerk#25)', 'Refs #25', 'see (#25)', 'Follow-up: #25 later']) assert.equal(refersTo('clerk', 25, pr(b)), false, b);
  assert.equal(refersTo('clerk', 25, pr('x', 'Docs for #25: thing')), false);
  assert.equal(refersTo('clerk', 25, { repo: 'clerk', title: 't', body: 'x', head: { ref: '25-thing' } }), true);
});

test('a bug needs no problem: no Answers line is no caution, a non-bug still gets one (clerk#223)', () => {
  const bug = { ...issue, body: 'Found while: x', labels: [{ name: 'wg:fixture' }, { name: W.bug }] };
  const r = checkClaim({ ...base, issue: bug, graded: true });
  assert.deepEqual([r.ok, r.cautions], [true, []]);
  assert.equal(checkClaim({ ...base, issue: bug }).ok, true, 'ungraded: not refused either');
  assert.match(checkClaim({ ...base, issue: { ...bug, labels: [{ name: 'wg:fixture' }] }, graded: true }).cautions.join('|'), /no "Answers/);
  assert.match(why({ issue: { ...issue, body: 'x' } }), /no "Answers/);
  assert.deepEqual(answersOf('x', true).stated, true);
  assert.deepEqual(answersOf('x').stated, false);
});
test('a group lane is refused at room 0 and when paused (clerk#147)', () => {
  assert.match(why({ state: { pause: 'ok', budget: 10, merged: 6, open: 4 } }), /no room \(6 merged \+ 4 open of 10\).*ask the owner/);
  assert.match(why({ state: { pause: 'ok', budget: 10, merged: 'unknown', open: 1 } }), /no room/);
  assert.match(why({ state: { pause: 'paused: 2 reports unacknowledged', budget: 10, merged: 0, open: 0 } }), /is paused: 2 reports/);
  assert.match(why({ state: undefined }), /was not read/);
});
test('the owner overrides the room, recorded in the claim comment; nobody overrides a pause (clerk#147)', () => {
  const full = { pause: 'ok', budget: 10, merged: 6, open: 4 }, over = { reason: 'delivery PRs are owner-merged' };
  const r = checkClaim({ ...base, actor: 'human:ada', state: full, overBudget: over });
  assert.deepEqual([r.ok, r.overridden], [true, { room: 0, reason: over.reason }]);
  assert.match(claimComment('human:ada', 'builder', 'WG Fixture', 'b', r.overridden), /Over budget \(room 0\), owner override: delivery PRs/);
  assert.match(why({ state: full, overBudget: over }), /no room.*the owner's/);
  assert.match(why({ actor: 'human:ada', state: full, overBudget: {} }), /no room/);
  assert.match(why({ actor: 'human:ada', state: { ...full, pause: 'paused: x' }, overBudget: over }), /is paused/);
});
test('a bug draws on its own budget: full room does not stop it, a pause does (clerk#147)', () => {
  const bug = { ...issue, labels: [{ name: 'wg:fixture' }, { name: W.bug }] }, full = { pause: 'ok', budget: 10, merged: 6, open: 4 };
  assert.equal(checkClaim({ ...base, issue: bug, state: full }).ok, true);
  assert.match(why({ issue: bug, state: { ...full, pause: 'paused: x' } }), /is paused/);
});
