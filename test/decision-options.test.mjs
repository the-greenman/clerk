import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProseOptions, optionWarnings, optionLines } from '../lib/practice/decision-options.mjs';
import { framingWarnings } from '../lib/practice/session.mjs';
import { decisionScreen } from '../lib/practice/agenda.mjs';

const LETTERED = '(a) Do nothing: the routine stays paused.\n(b) Each builder takes bugs: they compete with ranked work.\n(c) A separate bug fixer: one consumer (chosen).';

test('prose options parse into one model (clerk#128)', () => {
  const o = parseProseOptions(LETTERED);
  assert.deepEqual(o.map((x) => x.action), ['Do nothing', 'Each builder takes bugs', 'A separate bug fixer']);
  assert.deepEqual(o.map((x) => x.recommended), [false, false, true]);
  assert.equal(o[0].statusQuo, true);
  assert.equal(o[1].leadsTo, 'they compete with ranked work.');
  assert.equal(parseProseOptions('(a) Keep X. (b) Move X.').length, 2);
  assert.deepEqual(parseProseOptions(''), []);
});

test('a decision must be a choice: warnings (clerk#128)', () => {
  assert.equal(optionWarnings(parseProseOptions('Keep essays in muSrs.'))[0].text.startsWith('not a choice'), true);
  assert.deepEqual(optionWarnings(parseProseOptions(LETTERED)), []);
  assert.equal(optionWarnings(parseProseOptions('(a) Build it: soon.\n(b) Skip it: never.')).some((w) => w.text.startsWith('no status-quo')), true);
  assert.equal(framingWarnings({ statement: 'We do X.', revisit_when: 'r', decision_kind: 'design', options: 'Only one.' }).some((w) => w.text.startsWith('not a choice')), true);
  assert.equal(framingWarnings({ statement: 'We do X.', revisit_when: 'r', decision_kind: 'design' }).length, 0);
  assert.equal(optionLines(parseProseOptions(LETTERED)).filter((l) => l.includes('* ')).length, 1);
});

test('the agenda screen lists options one per line with the recommended marker', () => {
  const r = { instanceId: 'aaaaaaaa1', createdAt: '2026-11-01', record: { fieldValues: { title: 'T', alternatives_considered: LETTERED } } };
  const out = decisionScreen(r).join('\n');
  assert.match(out, /\* A separate bug fixer -> one consumer/);
  assert.match(out, /- Do nothing -> the routine stays paused/);
});
