import test from 'node:test';
import assert from 'node:assert/strict';
import { domainField, canAffirmTension, canSetAxis, canUnsetAxis } from '../lib/practice/domain-field.mjs';

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
  assert.equal(r.repoint, null);
  // the tension affirmed in an earlier act: only the poles fork, and its contains move to them
  const later = canAffirmTension(field({ affirmed: new Set(['sr-fork', 'evo']) }), 'evo');
  assert.deepEqual([later.forks, later.repoint], [['evolution', 'continuity'], 'evo']);
  const all = new Set(['sr-fork', 'evo', 'evolution', 'continuity']);
  assert.match(canAffirmTension(field({ affirmed: all }), 'evo').reasons[0], /already affirmed/);
  assert.match(canAffirmTension(field(), 'evolution').reasons[0], /not a tension/);
});

// axes (decision cdd272a3): Semantic records holds Identity as line 2 with Evolution yang; "Narrow" refines it and flips the pole
const axisData = () => {
  const rs = [...records, rec('ax', 'axis-in-domain', 'Identity in Semantic records', M, { line: 2 }), rec('narrow', 'domain', 'Narrow'),
    rec('ax2', 'axis-in-domain', 'Identity in Narrow', M, { line: 1 }), rec('kid', 'domain', 'Kid')];
  const ls = [...relations, rel('refines', 'ax', 'evo'), rel(`${M}/in-domain`, 'ax', 'sr-fork'), rel(`${M}/yang-pole`, 'ax', 'evolution'),
    rel('refines', 'narrow', 'sr'), rel(`${M}/holds-tension`, 'narrow', 'evo'), rel('contains', 'narrow', 'evo'),
    rel('refines', 'ax2', 'evo'), rel(`${M}/in-domain`, 'ax2', 'narrow'), rel(`${M}/yang-pole`, 'ax2', 'continuity'), rel('refines', 'kid', 'narrow')];
  return { rs, ls };
};
const done = new Set(['sr-fork', 'narrow', 'kid', 'ax', 'ax2', 'evo', 'evolution', 'continuity', 'succ', 'renewal', 'reliability']);
const axField = (affirmed = done) => { const { rs, ls } = axisData(); return domainField({ records: rs, relations: ls, groups, affirmed }); };

test('an axis record names the line and the yang pole; the other pole is yin there', () => {
  const sr = ctx(axField(), 'Semantic records');
  assert.deepEqual(sr.axes.map((a) => [a.line, a.tension.title, a.yang.title, a.yin.title]), [[2, 'Identity', 'Evolution', 'Continuity']]);
  assert.deepEqual(sr.tensions.find((t) => t.title === 'Identity').axis.yang.title, 'Evolution');
  assert.equal(sr.tensions.find((t) => t.title === 'Succession').axis, null); // not an axis: no polarity here
});

test('a narrower domain flips the pole with its own axis; one with none inherits its parent\'s', () => {
  const f = axField();
  assert.equal(ctx(f, 'Narrow').axes[0].yang.title, 'Continuity');
  assert.equal(ctx(f, 'Semantic records').axes[0].yang.title, 'Evolution');
  const kid = ctx(f, 'Kid');
  assert.deepEqual([kid.axes[0].yang.title, kid.axes[0].inherited.title], ['Continuity', 'Narrow']);
});

test('a suggested axis is offered, not counted', () => {
  const sr = ctx(axField(new Set([...done].filter((x) => x !== 'ax'))), 'Semantic records');
  assert.deepEqual([sr.axes.length, sr.suggestedAxes[0].tension.title], [0, 'Identity']);
});

test('set-axis needs a tension affirmed with both poles, one of its poles as yang, a free line and a domain record', () => {
  const f = axField();
  assert.ok(canSetAxis(f, 'sr', 'succ', 1, 'renewal').ok);
  assert.match(canSetAxis(f, 'sr', 'succ', 2, 'renewal').reasons.join(), /line 2 of Semantic records is Identity/);
  assert.match(canSetAxis(f, 'sr', 'succ', 1, 'evolution').reasons.join(), /must be one of/);
  assert.match(canSetAxis(f, 'sr', 'evo', 1, 'evolution').reasons.join(), /already an axis/);
  assert.match(canSetAxis(f, 'sr', 'succ', 4, 'renewal').reasons.join(), /1, 2 or 3/);
  assert.match(canSetAxis(axField(new Set(['sr-fork'])), 'sr', 'succ', 1, 'renewal').reasons.join(), /not affirmed with both poles/);
  assert.match(canSetAxis(f, 'wg', 'succ', 1, 'renewal').reasons.join(), /no domain record/);
  assert.equal(canSetAxis(axField(new Set([...done].filter((x) => x !== 'ax'))), 'sr', 'evo', 2, 'continuity').suggestion.recordId, 'ax');
});

test('unset-axis takes only an affirmed axis of a context\'s own', () => {
  assert.equal(canUnsetAxis(axField(), 'ax').recordId, 'ax');
  assert.ok(!canUnsetAxis(axField(new Set(['sr-fork'])), 'ax').ok);
});

test('set-axis says, by identity, whether the owner kept the suggestion\'s line and yang', () => {
  const f = axField(new Set([...done].filter((x) => x !== 'ax')));
  assert.deepEqual([canSetAxis(f, 'sr', 'evo', 2, 'evolution').suggestion.sameYang, canSetAxis(f, 'sr', 'evo', 2, 'continuity').suggestion.sameYang], [true, false]);
  assert.equal(canSetAxis(f, 'sr', 'evo', 3, 'evolution').suggestion.sameLine, false);
});
