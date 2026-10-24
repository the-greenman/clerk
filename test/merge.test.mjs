import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRefusal } from '../lib/practice/merge.mjs';

const SHA = 'a'.repeat(40);
const pr = (o = {}) => ({ state: 'open', merged_at: null, draft: false, head: { sha: SHA }, mergeable_state: 'clean', ...o });

test('mergeRefusal: only an open, clean, non-draft PR at the reviewed head merges', () => {
  assert.equal(mergeRefusal(pr(), SHA), null);
  assert.match(mergeRefusal(pr({ merged_at: '2026-10-24T00:00:00Z', state: 'closed' }), SHA), /already merged/);
  assert.match(mergeRefusal(pr({ state: 'closed' }), SHA), /closed/);
  assert.match(mergeRefusal(pr({ draft: true }), SHA), /draft/);
  assert.match(mergeRefusal(pr({ head: { sha: 'b'.repeat(40) } }), SHA), /head is now bbbbbbb/);
  for (const s of ['blocked', 'behind', 'dirty', 'unstable', 'unknown']) assert.match(mergeRefusal(pr({ mergeable_state: s }), SHA), new RegExp(s));
});
