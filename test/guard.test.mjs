import test from 'node:test';
import assert from 'node:assert/strict';
import { authorityActs, unproven } from '../lib/practice/guard.mjs';

const OWNER = 'human:the-greenman';
const settings = { ownerActor: OWNER };
const human = { kind: 'human', id: OWNER };
const agent = { kind: 'ai', id: 'agent:builder' };
const member = { kind: 'ai', id: 'agent:wg-reviewer' };
const groups = [{ title: 'WG Editor', logId: 'log-wg', members: [{ actor: 'agent:wg-reviewer' }] }];

const rec = (id, o = {}) => ({ id, ns: 'com.mudemocracy.governance', type: 'decision', state: 'proposed', by: agent, label: id, ...o });
const session = (id) => ({ id, ns: 'com.semanticops.programme', type: 'session', state: null, by: human, label: id });
const rel = (id, type, s, t, by) => ({ id, type, s, t, by });
const box = (id, title, ids) => ({ id, title, outline: ids.map((i) => ({ id: i })) });
const snap = (records = [], relations = [], containers = []) => ({ records, relations, containers });
const run = (b, a) => authorityActs(b, a, settings, groups);
const owner = [box('log-owner', 'SemanticOps decision log', ['d1'])];

test('a decision ratified with a new session and the owner\'s ratifies relation passes', () => {
  const acts = run(snap([rec('d1')], [], owner),
    snap([rec('d1', { state: 'ratified' }), session('s1')], [rel('r1', 'com.semanticops.programme/ratifies', 's1', 'd1', human)], owner));
  assert.equal(acts.length, 1);
  assert.equal(acts[0].act, 'ratify');
  assert.deepEqual(unproven(acts), []);
});

test('a decision ratified with no session record fails and names the decision', () => {
  const acts = run(snap([rec('d1')], [], owner), snap([rec('d1', { state: 'ratified' })], [], owner));
  assert.equal(unproven(acts).length, 1);
  assert.match(acts[0].ref, /d1/);
  assert.match(acts[0].why, /no ratifies relation/);
});

test('a ratifies relation from an old session, or made by an agent, is not proof', () => {
  const old = rel('r0', 'com.semanticops.programme/ratifies', 's0', 'd1', human);
  const stale = run(snap([rec('d1'), session('s0')], [], owner), snap([rec('d1', { state: 'ratified' }), session('s0')], [old], owner));
  assert.match(stale[0].why, /no session record created in this change/);
  const made = rel('r1', 'com.semanticops.programme/ratifies', 's1', 'd1', agent);
  const byAgent = run(snap([rec('d1')], [], owner), snap([rec('d1', { state: 'ratified' }), session('s1')], [made], owner));
  assert.match(byAgent[0].why, /agent:builder/);
});

test('a decision already ratified before the change is not an act', () => {
  const r = rec('d1', { state: 'ratified' });
  assert.deepEqual(run(snap([r], [], owner), snap([{ ...r, label: 'renamed' }], [], owner)), []);
});

test('abandoned needs sets-aside, not ratifies', () => {
  const ratifies = rel('r1', 'com.semanticops.programme/ratifies', 's1', 'd1', human);
  const wrong = run(snap([rec('d1')], [], owner), snap([rec('d1', { state: 'abandoned' }), session('s1')], [ratifies], owner));
  assert.equal(unproven(wrong).length, 1);
  const right = rel('r2', 'com.semanticops.programme/sets-aside', 's1', 'd1', human);
  assert.deepEqual(unproven(run(snap([rec('d1')], [], owner), snap([rec('d1', { state: 'abandoned' }), session('s1')], [right], owner))), []);
});

test('a group log\'s decision is ratified by a group member, not by an unrelated agent', () => {
  const log = [box('log-wg', 'WG Editor', ['d1'])];
  const ok = rel('r1', 'com.semanticops.programme/ratifies', 's1', 'd1', member);
  assert.deepEqual(unproven(run(snap([rec('d1')], [], log), snap([rec('d1', { state: 'ratified' }), session('s1')], [ok], log))), []);
  const bad = rel('r2', 'com.semanticops.programme/ratifies', 's1', 'd1', agent);
  const acts = run(snap([rec('d1')], [], log), snap([rec('d1', { state: 'ratified' }), session('s1')], [bad], log));
  assert.match(acts[0].why, /WG Editor group's members/);
});

test('a record forked into Affirmed by the owner passes; by an agent fails', () => {
  const sug = rec('p1', { type: 'problem' });
  const before = snap([sug], [], [box('c-aff', 'Affirmed', [])]);
  const fork = rec('p2', { type: 'problem', by: human });
  assert.deepEqual(unproven(run(before, snap([sug, fork], [], [box('c-aff', 'Affirmed', ['p2'])]))), []);
  const agentFork = rec('p3', { type: 'problem', by: agent });
  const acts = run(before, snap([sug, agentFork], [], [box('c-aff', 'Affirmed', ['p3'])]));
  assert.equal(unproven(acts)[0].act, 'affirm');
  assert.match(acts[0].why, /not the owner/);
});

test('an owner actor that is not a human does not affirm', () => {
  const fork = rec('p2', { by: { kind: 'ai', id: OWNER } });
  assert.equal(unproven(run(snap([], [], [box('c-aff', 'Affirmed', [])]), snap([fork], [], [box('c-aff', 'Affirmed', ['p2'])]))).length, 1);
});

test('a member already in Affirmed is not re-judged', () => {
  const r = rec('p1', { by: agent });
  const c = [box('c-aff', 'Affirmed', ['p1'])];
  assert.deepEqual(run(snap([r], [], c), snap([r], [], c)), []);
});

test('moving a suggestion to Set aside needs the owner as creator or a session sets-aside', () => {
  const sug = rec('p1', { type: 'problem' });
  const before = snap([sug], [], [box('c-sa', 'Set aside', [])]);
  const moved = [box('c-sa', 'Set aside', ['p1'])];
  assert.equal(unproven(run(before, snap([sug], [], moved))).length, 1);
  const proof = rel('r1', 'com.semanticops.programme/sets-aside', 's1', 'p1', human);
  assert.deepEqual(unproven(run(before, snap([sug, session('s1')], [proof], moved))), []);
  const own = rec('p9', { by: human });
  assert.deepEqual(unproven(run(snap([own], [], [box('c-sa', 'Set aside', [])]), snap([own], [], [box('c-sa', 'Set aside', ['p9'])]))), []);
});

test('an authorised-by relation created by an agent fails; by the owner passes', () => {
  const bad = run(snap(), snap([], [rel('a1', 'com.mudemocracy.stewardship/authorised-by', 'ag', 'role', agent)]));
  assert.equal(unproven(bad)[0].act, 'authorise');
  assert.deepEqual(unproven(run(snap(), snap([], [rel('a2', 'com.mudemocracy.stewardship/authorised-by', 'ag', 'role', human)]))), []);
  assert.equal(unproven(run(snap(), snap([], [rel('a3', 'com.mudemocracy.stewardship/authorised-by', 'ag', 'role', null)]))).length, 1);
});

test('receives needs a new session and an actor of its log', () => {
  const r = rel('x1', 'com.semanticops.programme/receives', 's1', 'rep', human);
  const home = [box('log-owner', 'SemanticOps decision log', ['s1'])];
  assert.deepEqual(unproven(run(snap([], [], home), snap([session('s1')], [r], home))), []);
  assert.match(run(snap([session('s1')], [], home), snap([session('s1')], [r], home))[0].why, /no session record created/);
  assert.equal(unproven(run(snap([], [], home), snap([session('s1')], [{ ...r, by: agent }], home))).length, 1);
});

test('a change with no authority act has nothing to prove', () => {
  const plain = rel('p1', 'refines', 'a', 'b', agent);
  assert.deepEqual(run(snap(), snap([rec('d9')], [plain])), []);
});

test('a change cannot move a decision into a group log to be ratified by that group\'s member', () => {
  const ratifies = rel('r1', 'com.semanticops.programme/ratifies', 's1', 'd1', member);
  const moved = [box('log-wg', 'WG Editor', ['d1'])];
  const acts = run(snap([rec('d1')], [], owner), snap([rec('d1', { state: 'ratified' }), session('s1')], [ratifies], moved));
  assert.equal(unproven(acts).length, 1);
});

test('renaming Affirmed does not hide a new member', () => {
  const fork = rec('p3', { by: agent });
  const acts = run(snap([], [], [box('c-aff', 'Affirmed', [])]), snap([fork], [], [box('c-aff', 'Renamed', ['p3'])]));
  assert.equal(unproven(acts).length, 1);
});
