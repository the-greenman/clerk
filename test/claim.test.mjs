import test from 'node:test';
import assert from 'node:assert/strict';
import { checkClaim } from '../lib/practice/claim.mjs';
import { answersOf } from '../lib/practice/grounding.mjs';
import { fxGroup, tprGroup } from './groups.fixture.mjs';

const issue = { repo: 'fixture', number: 10, state: 'open', labels: [{ name: 'wg:fixture' }], assignees: [], body: 'Answers: SP-901' };
const base = { issue, groups: [tprGroup, fxGroup], affirmed: new Set(['SP-901']), actor: 'agent:fx-builder', seat: 'builder', ownerActor: 'human:ada' };
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
