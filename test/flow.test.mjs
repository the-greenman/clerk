import test from 'node:test';
import assert from 'node:assert/strict';
import { dotsFor, flowState, routed } from '../lib/practice/flow.mjs';

const WF = { lane: 'lane:unattended', holds: ['needs-input', 'blocked', 'parked'] };
const GROUPS = [{ label: 'wg:agent-editor', domains: ['dom-writing'] }];
const EPICS = [{ refs: ['semanticops.com#29'], parked: false }];
const facts = (o = {}) => ({ answers: { problems: ['SP-12'], none: undefined, stated: true }, problems: [{ id: 'SP-12', layer: 'affirmed', domains: ['dom-writing'] }],
  epic: { ref: 'semanticops.com#29', ranked: true }, plan: { section: true, steps: false }, ...o });
const item = (o = {}) => ({ ref: 'srs-web#1', body: '', labels: ['wg:agent-editor'], blockedBy: [], ...o });
const dot = (dots, name) => dots.filter((d) => d.dot === name);

test('an item with every dot joined flows', () => {
  const d = dotsFor({ item: item(), facts: facts(), epics: EPICS, groups: GROUPS, wf: WF, care: { mode: { key: 'build' }, rule: { title: 'Rule 1' } } });
  assert.deepEqual(flowState(d), { flows: true, gaps: 0, auto: 0 });
  assert.equal(dot(d, 'care')[0].note, 'build (Rule 1)');
});

test('mechanical gaps are auto, each with the rule that fixes it', () => {
  const d = dotsFor({ item: item({ labels: [], body: 'Part of semanticops.com#29\nBlocked by: srs-programme#189' }),
    facts: facts({ epic: null }), epics: EPICS, groups: GROUPS, wf: WF });
  assert.match(dot(d, 'epic')[0].fix, /sub-issue of semanticops.com#29/);
  assert.equal(dot(d, 'epic')[0].auto, true);
  assert.equal(dot(d, 'lane')[0].fix, 'label it wg:agent-editor', 'the group holding the problem domain');
  assert.match(dot(d, 'blockers')[0].gap, /srs-programme#189" is only text/);
  assert.deepEqual(flowState(d), { flows: false, gaps: 3, auto: 3 });
});

test('a domain no group holds goes to the central lane', () => {
  const d = dotsFor({ item: item({ labels: [] }), facts: facts({ problems: [{ id: 'SP-12', layer: 'suggested', domains: ['dom-other'] }] }), epics: EPICS, groups: GROUPS, wf: WF });
  assert.equal(dot(d, 'lane')[0].fix, 'label it lane:unattended');
});

test('a group outside the item\'s repository does not take it', () => {
  const d = dotsFor({ item: item({ ref: 'clerk#1', labels: [] }), facts: facts(), epics: EPICS, groups: [{ label: 'wg:agent-editor', domains: ['dom-writing'], repos: ['srs-web'] }], wf: WF });
  assert.equal(dot(d, 'lane')[0].fix, 'label it lane:unattended');
});

test('gaps a person must fill are not auto', () => {
  const d = dotsFor({ item: item({ labels: ['wg:agent-editor', 'needs-input'], blockedBy: [{ ref: 'srs-programme#189', open: true }] }),
    facts: facts({ answers: { problems: [], none: undefined, stated: false }, problems: [], epic: { ref: 'x#1', ranked: false }, plan: { section: false, steps: false } }),
    epics: EPICS, groups: GROUPS, wf: WF });
  for (const [name, re] of [['problem', /no Answers/], ['epic', /not ranked/], ['plan', /no technical plan/], ['blockers', /waits on srs-programme#189/], ['hold', /held: needs-input/]])
    assert.match(dot(d, name)[0].gap, re, name);
  assert.equal(flowState(d).auto, 0);
});

test('a "Part of" naming no roadmap epic is not guessed', () => {
  const d = dotsFor({ item: item({ body: 'Part of clerk#999' }), facts: facts({ epic: null }), epics: EPICS, groups: GROUPS, wf: WF });
  assert.equal(dot(d, 'epic')[0].auto, false);
});

test('review fixes: a wrong group label, re-parenting, unusable problems, unknown blockers', () => {
  const g = [{ label: 'wg:agent-editor', domains: ['dom-writing'], repos: ['srs-web'] }];
  let d = dotsFor({ item: item({ ref: 'clerk#5', labels: ['wg:agent-editor'] }), facts: facts(), epics: EPICS, groups: g, wf: WF });
  assert.equal(dot(d, 'lane')[0].ok, false, 'a group that does not work in the repo is no lane');
  assert.match(dot(d, 'lane')[0].gap, /does not work in clerk/);
  assert.equal(dot(d, 'lane')[0].fix, 'label it lane:unattended');

  d = dotsFor({ item: item({ body: 'Part of semanticops.com#29', parents: ['srs-web#2'] }), facts: facts({ epic: null }), epics: EPICS, groups: GROUPS, wf: WF });
  assert.equal(dot(d, 'epic')[0].auto, false, 'never re-parent');
  assert.match(dot(d, 'epic')[0].fix, /link srs-web#2 as a sub-issue of semanticops.com#29/);

  for (const [layer, re] of [[null, /not a known problem/], ['set-aside', /set aside/]]) {
    d = dotsFor({ item: item(), facts: facts({ problems: [{ id: 'SP-12', layer, domains: [] }] }), epics: EPICS, groups: GROUPS, wf: WF });
    assert.match(dot(d, 'problem')[0].gap, re);
  }
  d = dotsFor({ item: item({ blockedBy: { unknown: 'HTTP 403' } }), facts: facts(), epics: EPICS, groups: GROUPS, wf: WF });
  assert.match(dot(d, 'blockers')[0].gap, /unreadable \(HTTP 403\)/);
});

test('review fixes: no problem means no routing; parsing; no care rule', () => {
  let d = dotsFor({ item: item({ labels: [] }), facts: facts({ answers: { problems: [], none: undefined, stated: true }, problems: [] }), epics: EPICS, groups: GROUPS, wf: WF });
  assert.match(dot(d, 'problem')[0].gap, /names no SP-nn/);
  assert.equal(dot(d, 'lane')[0].auto, false);
  d = dotsFor({ item: item({ body: 'Blocked by #12; builds on #13\nBlocked by: srs-rust#3' }), facts: facts(), epics: EPICS, groups: GROUPS, wf: WF, care: { mode: null, rule: null } });
  assert.match(dot(d, 'blockers')[0].gap, /srs-web#12, srs-rust#3/);
  assert.equal(dot(d, 'care')[0].note, 'no care rule matches it');
});

test('second review: no routing on a set-aside problem; two holders are a choice; parked epics; unreadable parents; one blockers dot', () => {
  let d = dotsFor({ item: item({ labels: [] }), facts: facts({ problems: [{ id: 'SP-12', layer: 'set-aside', domains: ['dom-writing'] }] }), epics: EPICS, groups: GROUPS, wf: WF });
  assert.equal(dot(d, 'lane')[0].auto, false, 'a set-aside problem routes nothing');
  const two = [{ label: 'wg:a', domains: ['dom-writing'] }, { label: 'wg:b', domains: ['dom-writing'] }];
  d = dotsFor({ item: item({ labels: [] }), facts: facts(), epics: EPICS, groups: two, wf: WF });
  assert.equal(dot(d, 'lane')[0].auto, false);
  assert.match(dot(d, 'lane')[0].gap, /wg:a and wg:b both hold its domain/);
  d = dotsFor({ item: item({ body: 'Part of semanticops.com#40' }), facts: facts({ epic: null }), epics: [...EPICS, { refs: ['semanticops.com#40'], parked: true }], groups: GROUPS, wf: WF });
  assert.equal(dot(d, 'epic')[0].auto, false);
  assert.match(dot(d, 'epic')[0].gap, /a parked epic/);
  d = dotsFor({ item: item({ body: 'Part of semanticops.com#29', parentsUnknown: 'HTTP 403' }), facts: facts({ epic: null }), epics: EPICS, groups: GROUPS, wf: WF });
  assert.equal(dot(d, 'epic')[0].auto, false);
  assert.match(dot(d, 'epic')[0].gap, /parent chain is unreadable \(HTTP 403\)/);
  d = dotsFor({ item: item({ body: 'Blocked by #3', blockedBy: [{ ref: 'srs-web#4', open: true }] }), facts: facts(), epics: EPICS, groups: GROUPS, wf: WF });
  assert.equal(dot(d, 'blockers').length, 1, 'one blockers dot per item');
  assert.match(dot(d, 'blockers')[0].gap, /srs-web#3" is only text; waits on srs-web#4/);
  assert.equal(dot(d, 'blockers')[0].auto, false, 'an open blocker is not mechanical');
});

test('routed: one rule for flow and topup', () => {
  const g = [{ label: 'wg:a', repos: ['srs-web'] }];
  assert.equal(routed(['lane:unattended'], { lane: 'lane:unattended', groups: g, repo: 'clerk' }), true);
  assert.equal(routed(['wg:a'], { lane: 'lane:unattended', groups: g, repo: 'clerk' }), false);
  assert.equal(routed(['wg:a'], { lane: 'lane:unattended', groups: g, repo: 'srs-web' }), true);
  assert.equal(routed(['wg:x'], { lane: 'lane:unattended', groups: null }), true, 'groups unknown: any wg: label');
});
