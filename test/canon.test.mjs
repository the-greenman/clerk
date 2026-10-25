import test from 'node:test';
import assert from 'node:assert/strict';
import { canonOf } from '../lib/practice/canon.mjs';

const rec = (id, typeName) => ({ instanceId: id, record: { typeName } });
const df = (s, t) => ({ relationType: 'derived-from', sourceId: s, targetId: t });
// the vignette is a Tier-0 note: it is in no record list
const records = [rec('t', 'tension'), rec('tFork', 'tension'), rec('a', 'tension'), rec('b', 'tension'), rec('d', 'domain'), rec('bnd', 'boundary')];

test('a fork and its origin are one identity', () => {
  const canon = canonOf([df('tFork', 't')], records);
  assert.equal(canon('tFork'), canon('t'));
});

test('records derived from one vignette stay distinct (clerk#207)', () => {
  const canon = canonOf([df('a', 'vignette'), df('b', 'vignette')], records);
  assert.notEqual(canon('a'), canon('b'));
  assert.equal(canon('a'), 'a');
});

test('a boundary derived from a domain is provenance, not identity', () => {
  assert.equal(canonOf([df('bnd', 'd')], records)('bnd'), 'bnd');
});
