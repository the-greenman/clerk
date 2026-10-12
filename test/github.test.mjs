import test from 'node:test';
import assert from 'node:assert/strict';
import { closingRefs } from '../lib/adapters/github.mjs';

test('closingRefs reads GitHub closing keywords in every reference form', () => {
  assert.deepEqual(closingRefs('Closes #34. Part of #19.'), [{ owner: undefined, repo: undefined, number: 34 }]);
  assert.deepEqual(closingRefs('fixes srs-rust#12\nResolved: the-greenman/clerk#7'),
    [{ owner: undefined, repo: 'srs-rust', number: 12 }, { owner: 'the-greenman', repo: 'clerk', number: 7 }]);
  assert.deepEqual(closingRefs('Close https://github.com/the-greenman/srs/issues/9'), [{ owner: 'the-greenman', repo: 'srs', number: 9 }]);
});

test('closingRefs ignores mentions without a closing keyword', () => {
  assert.deepEqual(closingRefs('Part of the-greenman/clerk#7 (Phase 4 of clerk#1). Refs #3'), []);
  assert.deepEqual(closingRefs(null), []);
});
