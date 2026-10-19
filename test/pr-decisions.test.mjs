import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecisions, checkDecisions, answersFrom, signComment } from '../lib/practice/pr-decisions.mjs';

const block = (o) => `Answers: SP-12\n\n\`\`\`srs-decisions\n${JSON.stringify(o)}\n\`\`\`\n`;

test('the block and the Answers: line both count', () => {
  const d = parseDecisions(block({ by: 'agent:x', answers: ['SP-91'], made: [{ id: '3c8b94d1' }, { title: 'name it' }] }));
  assert.deepEqual(d.answers, ['SP-91', 'SP-12']);
  assert.deepEqual(d.made.map((m) => m.class), ['ruling', 'choice'], 'an id makes a ruling, none a choice');
});

test('decision prose with no block is an error', () => {
  const body = 'We decided to keep the old flag.';
  assert.equal(checkDecisions(parseDecisions(body), { body })[0].level, 'error');
  assert.equal(checkDecisions(parseDecisions('Fixes a typo.'), { body: 'Fixes a typo.' })[0].level, 'info');
});

test('decision records in the diff need a block', () => {
  assert.match(checkDecisions(parseDecisions(''), { recordsInDiff: 1 })[0].text, /records 1 decision/);
});

test('a ruling needs a record; a broken block is reported', () => {
  assert.match(checkDecisions(parseDecisions(block({ by: 'a', made: [{ class: 'ruling', title: 'r' }] })))[0].text, /no decision record id/);
  assert.match(checkDecisions(parseDecisions('```srs-decisions\n{bad\n```'))[0].text, /does not parse/);
});

test('a merge-blocking ask must be answered before merge', () => {
  const d = parseDecisions(block({ by: 'a', asks: [{ key: 'A1', question: 'q', options: ['x', 'y'], recommend: 'x', blocks: 'merge' }] }));
  assert.equal(checkDecisions(d)[0].level, 'ok');
  assert.ok(checkDecisions(d, { merging: true }).some((f) => f.level === 'error'));
  const answered = answersFrom(['<!-- srs:answer ask=A1 choice="x" -->\n**Decision A1:** x']);
  assert.equal(checkDecisions(d, { merging: true, answered })[0].level, 'ok');
});

test('a choice on the group\'s axes names its lean', () => {
  const d = parseDecisions(block({ by: 'a', made: [{ class: 'choice', title: 't' }] }));
  assert.equal(checkDecisions(d, { groupHasLean: true })[0].level, 'warn');
});

test('signing keeps the first line free and is idempotent', () => {
  const q = '<!-- wg-quorum --> builder=a reviewer=b gates=green@x mandate=m verdict=approve';
  const s = signComment(q, 'agent:tpr-reviewer');
  assert.ok(s.startsWith('<!-- wg-quorum -->'));
  assert.match(s, /<!-- actor: agent:tpr-reviewer -->$/);
  assert.equal(signComment(s, 'agent:tpr-reviewer'), s);
  assert.equal(signComment('hi', null), 'hi');
});
