import test from 'node:test';
import assert from 'node:assert/strict';
import { groundPR, problemsFrom, i1 } from '../lib/practice/grounding-check.mjs';
import { answersOf } from '../lib/practice/grounding.mjs';

const M = 'com.semanticops.method';
const rec = (instanceId, typeName, fieldValues) => ({ instanceId, record: { typeName, fieldValues } });
const rel = (type, sourceId, targetId) => ({ relationType: type === 'contains' ? type : `${M}/${type}`, sourceId, targetId });
const records = [
  rec('d', 'domain', {}), rec('c', 'cluster', {}), rec('pe', 'persona', {}),
  rec('p1', 'problem', { problem_id: 'SP-1' }), rec('p2', 'problem', { problem_id: 'SP-2' }), rec('p3', 'problem', { problem_id: 'SP-3' }),
];
const relations = [rel('contains', 'd', 'c'), rel('contains', 'c', 'p1'), rel('held-by', 'p1', 'pe'), rel('contains', 'c', 'p3'), rel('held-by', 'p3', 'pe')];
const problems = problemsFrom(records, relations, new Set(['p1', 'p2', 'd', 'pe'])); // SP-3 only suggested
const roadmap = { epics: [{ refs: ['r#100'] }] };
const groups = [{ label: 'wg:x' }];
const issue = (o = {}) => ({ ref: 'r#5', body: 'Answers: SP-1', comments: [], labels: [], parents: [], ...o });
const g = (o) => groundPR({ pr: { labels: [] }, problems, roadmap, groups, ...o });

test('facts: persona and domain strength per SP', () => {
  assert.deepEqual(problems['SP-1'], { affirmed: true, persona: 'affirmed', domain: 'affirmed' });
  assert.deepEqual(problems['SP-2'], { affirmed: true, persona: null, domain: null });
  assert.equal(problems['SP-3'].affirmed, false);
});
test('Answers parsing (shared answersOf)', () => {
  assert.deepEqual(answersOf('x\n> Answers: sp-9'.replace('sp', 'SP')).problems, ['SP-9']);
  assert.equal(answersOf('Answers SP-4').problems[0], 'SP-4');
  assert.equal(answersOf('nothing').stated, false);
});
test('none: no linked issue', () => assert.deepEqual([g({ issue: null }).level, g({ issue: null }).grounded], ['none', false]));
test('issue: no Answers line, or none-yet, or unaffirmed SP', () => {
  for (const body of ['hi', 'No affirmed problem yet: x', 'Answers: SP-3', 'Answers: SP-99']) assert.equal(g({ issue: issue({ body }) }).level, 'issue', body);
  assert.equal(g({ issue: issue({ body: 'Answers: SP-3' }) }).reasons.some((r) => /only suggested/.test(r)), true);
});
test('problem: affirmed SP with no persona/domain', () => {
  const r = g({ issue: issue({ body: 'Answers: SP-2' }) });
  assert.deepEqual([r.level, r.grounded], ['problem', true]);
});
test('problem+persona+domain', () => assert.equal(g({ issue: issue() }).level, 'problem+persona+domain'));
test('epic: issue under a roadmap epic', () => {
  const r = g({ issue: issue({ parents: [{ ref: 'r#50', labels: [] }, { ref: 'r#100', labels: [] }] }) });
  assert.deepEqual([r.level, r.chain.epic], ['epic', true]);
});
test('group: label on the PR', () => {
  const r = groundPR({ pr: { labels: ['wg:x'] }, issue: issue({ parents: [{ ref: 'r#100', labels: [] }] }), problems, roadmap, groups });
  assert.equal(r.level, 'group');
});
test('a broken chain stops the level but flags above still show', () => {
  const r = g({ issue: issue({ body: 'Answers: SP-2', parents: [{ ref: 'r#100', labels: [] }] }) });
  assert.deepEqual([r.level, r.chain.epic], ['problem', true]);
});
test('I1 counts', () => {
  const s = i1([{ level: 'none' }, { level: 'issue' }, { level: 'problem' }, { level: 'epic' }]);
  assert.deepEqual([s.total, s.grounded, s.full, s.share, s.fullShare], [4, 2, 1, 0.5, 0.25]);
  assert.equal(i1([]).share, null);
});
