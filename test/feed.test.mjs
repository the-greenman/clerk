import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStrongTopup, STRONG_SLOTS_DEFAULT } from '../lib/practice/feed.mjs';

const cs = (...ks) => ks.map((key) => ({ key }));
const keys = (xs) => xs.map((x) => x.key);

test('no strong candidates: the epic-major order, as planTopup', () => {
  assert.deepEqual(keys(planStrongTopup(cs('a', 'b', 'c', 'd'), new Set(), 3)), ['a', 'b', 'c']);
});
test('strong candidates beyond the slots: only the first K jump the queue', () => {
  assert.deepEqual(keys(planStrongTopup(cs('a', 'b', 'c', 'd', 'e'), new Set(['c', 'd', 'e']), 4, 2)), ['c', 'd', 'a', 'b']);
});
test('deficit smaller than the slots: the deficit wins', () => {
  assert.deepEqual(keys(planStrongTopup(cs('a', 'b', 'c', 'd'), new Set(['c', 'd']), 1, 2)), ['c']);
});
test('a strong item first in epic order is nominated once', () => {
  assert.deepEqual(keys(planStrongTopup(cs('a', 'b', 'c'), new Set(['a']), 2, 2)), ['a', 'b']);
});
test('zero deficit nominates nothing; fewer candidates than the deficit clamps', () => {
  assert.deepEqual(planStrongTopup(cs('a'), new Set(['a']), 0), []);
  assert.deepEqual(keys(planStrongTopup(cs('a', 'b'), new Set(['b']), 5)), ['b', 'a']);
});
test('the default is two strong slots', () => { assert.equal(STRONG_SLOTS_DEFAULT, 2); });
