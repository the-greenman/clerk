import test from 'node:test';
import assert from 'node:assert/strict';
import { domainField, canAffirmTension, canPlaceAxes } from '../lib/practice/domain-field.mjs';

const M = 'com.semanticops.method', A = 'com.mudemocracy.argument';
const rec = (id, typeName, title, ns = M, extra = {}) => ({ instanceId: id, record: { typeName, typeNamespace: ns, fieldValues: { title, ...extra } } });
const rel = (relationType, sourceId, targetId) => ({ relationType, sourceId, targetId });

// Stance holds one line (Change: Disrupt/Stabilise). Semantic records is a domain whose boundary "SRS standard" is derived-from it
// and holds two tensions on the Change line (evolution, succession). "WG X" is a group's compass serving Semantic records.
// "Orphan" sits in nothing.
const records = [
  rec('stance', 'domain', 'Stance'), rec('change', 'tension', 'Change'), rec('disrupt', 'pole', 'Disrupt'), rec('stabilise', 'pole', 'Stabilise'),
  rec('sr', 'domain', 'Semantic records', M, { purpose: 'meaning that lasts' }), rec('sr-fork', 'domain', 'Semantic records'),
  rec('std', 'boundary', 'SRS standard', A, { inside: 'the spec' }),
  rec('evo', 'tension', 'Identity'), rec('evolution', 'pole', 'Evolution', M, { shadow: 'churn' }), rec('continuity', 'pole', 'Continuity'),
  rec('succ', 'tension', 'Succession'), rec('renewal', 'pole', 'Renewal'), rec('reliability', 'pole', 'Reliability'),
  rec('wg', 'boundary', 'WG X', A), rec('orphan', 'tension', 'Orphan'), rec('p1', 'pole', 'One'), rec('p2', 'pole', 'Two'),
  rec('pr', 'principle', 'Evolution over continuity'), rec('prob', 'problem', 'Replaced decisions leave no history'),
];
const relations = [
  rel('contains', 'stance', 'change'), rel('contains', 'change', 'disrupt'), rel('contains', 'change', 'stabilise'),
  rel('derived-from', 'sr-fork', 'sr'), rel('derived-from', 'std', 'sr'),
  rel(`${A}/holds-tension`, 'std', 'evo'), rel(`${A}/holds-tension`, 'std', 'succ'),
  rel('contains', 'evo', 'evolution'), rel('contains', 'evo', 'continuity'), rel('contains', 'succ', 'renewal'), rel('contains', 'succ', 'reliability'),
  rel('refines', 'evolution', 'disrupt'), rel('refines', 'renewal', 'disrupt'), rel('refines', 'continuity', 'stabilise'), rel('refines', 'reliability', 'stabilise'),
  rel(`${A}/narrows`, 'wg', 'std'), rel(`${A}/holds-tension`, 'wg', 'succ'),
  rel('contains', 'orphan', 'p1'), rel('contains', 'orphan', 'p2'),
  rel(`${M}/governs`, 'pr', 'evo'), rel(`${M}/leans-toward`, 'pr', 'evolution'), rel(`${M}/concerns`, 'prob', 'continuity'),
];
const groups = [{ title: 'WG X', domains: ['sr-fork'] }];
const field = (over = {}) => domainField({ records, relations, groups, affirmed: new Set(['sr-fork']), ...over });
const ctx = (f, t) => f.contexts.find((c) => c.title === t);

test('a boundary derived-from a domain is that domain: one context, its tensions and fields side by side', () => {
  const sr = ctx(field(), 'Semantic records');
  assert.deepEqual(sr.boundaries.map((b) => [b.title, b.how, b.inside]), [['SRS standard', 'derived-from', 'the spec']]);
  assert.equal(sr.domain.recordId, 'sr-fork'); // the affirmed copy stands
  assert.equal(sr.domain.purpose, '');           // its own fields, not the suggestion's
  assert.deepEqual(sr.tensions.map((t) => t.title).sort(), ['Identity', 'Succession']);
  assert.ok(!field().contexts.some((c) => c.title === 'SRS standard'));
});

test('a group compass is a context of its own, within what it narrows, serving its group\'s domain', () => {
  const wg = ctx(field(), 'WG X');
  assert.equal(wg.domain, null);
  assert.equal(wg.parent.title, 'Semantic records');
  assert.deepEqual(wg.serves.domains.map((d) => d.title), ['Semantic records']);
});

test('each pole carries its partner\'s context: shadow, principles, problems; each tension its line', () => {
  const evo = ctx(field(), 'Semantic records').tensions.find((t) => t.title === 'Identity');
  assert.equal(evo.line.title, 'Change');
  const [e, c] = ['Evolution', 'Continuity'].map((n) => evo.poles.find((p) => p.title === n));
  assert.equal(e.shadow, 'churn');
  assert.deepEqual(e.principles.map((p) => p.title), ['Evolution over continuity']);
  assert.deepEqual(c.problems.map((p) => p.title), ['Replaced decisions leave no history']);
  assert.equal(evo.principles[0].leansToward, 'evolution');
});

test('two tensions on one line are flagged for the owner, not judged', () => {
  assert.deepEqual(ctx(field(), 'Semantic records').sameLine.map((s) => [s.line.title, s.tensions.length]), [['Change', 2]]);
});

test('a tension in no domain or boundary has lost its context', () => {
  assert.deepEqual(field().lost.map((t) => t.title), ['Orphan']);
});

test('a tension is affirmed with both its poles, poles first; never twice', () => {
  const r = canAffirmTension(field(), 'evo');
  assert.ok(r.ok);
  assert.deepEqual(r.forks, ['evolution', 'continuity', 'evo']);
  const all = new Set(['sr-fork', 'evo', 'evolution', 'continuity']);
  assert.match(canAffirmTension(field({ affirmed: all }), 'evo').reasons[0], /already affirmed/);
  assert.match(canAffirmTension(field(), 'evolution').reasons[0], /not a tension/);
});

test('axes need a domain record and three distinct tensions affirmed with both poles', () => {
  const done = new Set(['sr-fork', 'evo', 'evolution', 'continuity', 'succ', 'renewal', 'reliability']);
  assert.match(canPlaceAxes(field({ affirmed: done }), 'sr', ['evo', 'succ', 'evo']).reasons.join(), /distinct/);
  assert.match(canPlaceAxes(field(), 'sr', ['evo', 'succ', 'change']).reasons.join(), /not affirmed with both poles/);
  assert.match(canPlaceAxes(field(), 'wg', ['succ', 'succ', 'succ']).reasons.join(), /no domain record/);
  const ok = canPlaceAxes(field({ affirmed: done }), 'stance', ['change', 'change', 'change']);
  assert.ok(!ok.ok); // distinct, and Change is not affirmed here
});
