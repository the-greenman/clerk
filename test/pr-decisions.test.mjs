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
  const d = parseDecisions(block({ by: 'a', asks: [{ key: 'A1', question: 'q', tension: '3-9', options: ['Do x: x happens', 'Do nothing: y stays'], recommend: 'Do x', blocks: 'merge' }] }));
  assert.equal(checkDecisions(d)[0].level, 'ok');
  assert.ok(checkDecisions(d, { merging: true }).some((f) => f.level === 'error'));
  const answered = answersFrom(['<!-- srs:answer ask=A1 choice="x" -->\n**Decision A1:** x']);
  assert.equal(checkDecisions(d, { merging: true, answered })[0].level, 'ok');
});

const ask = (a) => checkDecisions(parseDecisions(block({ by: 'a', asks: [{ key: 'A1', question: 'q', ...a }] })));

test('an option is a course of action, never a disposition', () => {
  const f = ask({ options: ['Ratify', 'Set aside', 'Hold'], recommend: 'Ratify', tension: 't' });
  assert.equal(f.filter((x) => x.level === 'error' && /disposition/.test(x.text)).length, 3);
  assert.ok(ask({ options: ['Accept option A: do x', 'Shelve', 'Deny'], recommend: 'Accept option A' }).some((x) => /"Accept option A" is a disposition/.test(x.text)));
  assert.ok(!ask({ options: ['No change: y stays', 'Do x: x'], recommend: 'Do x', tension: 't' }).some((x) => x.level === 'error'), '"No change" is a status quo, not a "no"');
});

test('an ask offers two or more options, a status quo, and says where each leads', () => {
  assert.ok(ask({ options: ['Do x: x'], recommend: 'Do x', tension: 't' }).some((x) => x.level === 'error' && /at least two/.test(x.text)));
  assert.ok(ask({ options: [], tension: 't' }).some((x) => /offers 0/.test(x.text)));
  const w = ask({ options: ['Do x', { action: 'Do y', leads_to: 'y' }], recommend: 'Do z' }).map((x) => x.text);
  assert.ok(w.some((t) => /no status-quo/.test(t)));
  assert.ok(w.some((t) => /"Do x" does not say what it leads to/.test(t)));
  assert.ok(w.some((t) => /no tension and no why_unplaced/.test(t)));
  assert.ok(w.some((t) => /none of its options/.test(t)));
  const ok = ask({ why_unplaced: 'no compass for this domain yet', options: [{ action: 'Do x', leads_to: 'x', pole: 'p' }, { action: 'Do nothing', leads_to: 'y stays' }], recommend: 'Do x' });
  assert.equal(ok[0].level, 'ok');
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
