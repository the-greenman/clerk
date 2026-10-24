import test from 'node:test';
import assert from 'node:assert/strict';
import { prTree, prDecisions } from '../lib/practice/pr-tree.mjs';

const GATES = { auto: 'gate:auto-merge', owner: 'gate:owner-merge' };
const pr = (number, o = {}) => ({ repo: 'clerk', number, title: `pr ${number}`, body: '', labels: ['gate:auto-merge'], mergeState: 'CLEAN', checks: 'green',
  draft: false, approved: false, chain: [], files: [], comments: [], decisionFiles: [], base: 'main', headRef: `b${number}`, ...o });

test('a stack of three merges bottom up; each later PR waits on the one below', () => {
  const t = prTree([pr(3, { base: 'b2' }), pr(1), pr(2, { base: 'b1' })], GATES);
  assert.deepEqual(t.chains.map((c) => c.order), [['clerk#1', 'clerk#2', 'clerk#3']]);
  assert.deepEqual(t.prs['clerk#1'].next, { do: 'merge' });
  assert.deepEqual(t.prs['clerk#3'].next, { do: 'after', ref: 'clerk#2', why: 'stacked' });
});

test('Depends on a PR, or on an issue another PR closes, is a hard edge; other repos are not joined', () => {
  const t = prTree([pr(5, { body: 'Depends on #6' }), pr(6), pr(7, { body: 'Blocked by: #70' }), pr(8, { chain: ['clerk#70'] }), pr(9, { repo: 'srs', body: 'Depends on clerk#6' })], GATES);
  assert.deepEqual(t.chains.map((c) => c.order), [['clerk#6', 'clerk#5'], ['clerk#8', 'clerk#7']]);
  assert.equal(t.chains[1].edges[0].why, 'names clerk#70, which clerk#8 closes');
  assert.deepEqual(t.singles, ['srs#9']);
});

test('overlap: the readier PR goes first and the other rebases after it', () => {
  const t = prTree([pr(10, { mergeState: 'BEHIND', files: [{ name: 'a.mjs' }] }), pr(11, { files: [{ name: 'a.mjs' }, { name: 'b.mjs' }] })], GATES);
  assert.deepEqual(t.chains[0].order, ['clerk#11', 'clerk#10']);
  assert.deepEqual(t.prs['clerk#10'].next, { do: 'rebase', ref: 'clerk#11', why: 'both change a.mjs' });
});

test('a cycle is reported, never ordered', () => {
  const t = prTree([pr(20, { base: 'b21' }), pr(21, { base: 'b20' })], GATES);
  assert.deepEqual(t.cycles, [['clerk#20', 'clerk#21']]);
  assert.deepEqual(t.chains[0].order, []);
  assert.equal(t.prs['clerk#20'].next.why, 'in a cycle');
});

test('decisions are flagged, and an unanswered ask holds the merge', () => {
  const block = '```srs-decisions\n{"asks":[{"key":"Q1","question":"Which?"}],"made":[{"id":"abcd1234"}]}\n```';
  const t = prTree([pr(30, { body: block }), pr(31, { labels: [] })], GATES);
  assert.deepEqual(t.prs['clerk#30'].decisions, { asks: 1, open: 1, made: 1, recorded: 0 });
  assert.deepEqual(t.prs['clerk#30'].next, { do: 'wait', why: '1 decision asked' });
  assert.deepEqual(t.prs['clerk#31'].next, { do: 'wait', why: 'no gate' });
  assert.equal(prDecisions(pr(32, { body: block, comments: [{ body: '<!-- srs:answer ask=Q1 choice="A" -->' }] })).open, 0);
});
