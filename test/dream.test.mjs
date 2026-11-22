import test from 'node:test';
import assert from 'node:assert/strict';
import { repairId, clean } from '../scripts/dream/apply.mjs';

const A = 'aaaaaaaa-1111-4111-8111-111111111111', B = 'bbbbbbbb-2222-4222-8222-222222222222', B2 = 'bbbbbbbb-3333-4333-8333-333333333333', V = 'cccccccc-4444-4444-8444-444444444444';
const known = new Map([[A, 'problem'], [B, 'problem'], [B2, 'problem'], [V, 'vignette']]);

test('repairId: exact and unique 8-character prefix of the same kind are kept; ambiguous, wrong kind or unknown are dropped', () => {
  assert.equal(repairId(A, known, 'problem'), A);
  assert.equal(repairId('aaaaaaaa-garbled', known, 'problem'), A);
  assert.equal(repairId('bbbbbbbb-garbled', known, 'problem'), null);
  assert.equal(repairId('aaaaaaaa-garbled', known, 'domain'), null);
  assert.equal(repairId('zzzzzzzz-x', known, 'problem'), null);
});

test('clean drops links whose ids cannot be repaired', () => {
  const cat = { domains: [], personas: [], problems: [{ id: A }] };
  const r = clean({ links: [{ vignette_id: 'cccccccc-bad', target_id: 'aaaaaaaa-bad', target_kind: 'problem' }, { vignette_id: V, target_id: 'nope', target_kind: 'problem' }], refinements: [], new_problems: [] }, cat, [V]);
  assert.deepEqual(r.links.map((l) => [l.vignette_id, l.target_id]), [[V, A]]);
});
