import test from 'node:test';
import assert from 'node:assert/strict';
import { tableAfter, checksState, decisionFilesFromPatch, needsOf, threadsOf, labelsOf } from '../lib/practice/desk-detail.mjs';

const BODY = `# Desk

## Needs you
| # | What | Action | Why |
|---|---|---|---|
| 1 | **2 PRs** a \\| b | Merge | They wait |

## Threads
| Thread | State | Moved | Next | Who |
|---|---|---|---|---|
| clerk#97 | building | today | review | builder |

## Running fine
`;

test('the desk tables read back as rows, escaped pipes kept, header dropped', () => {
  assert.deepEqual(tableAfter(BODY, '## Needs you'), [['1', '**2 PRs** a | b', 'Merge', 'They wait']]);
  assert.deepEqual(needsOf(BODY), [{ n: '1', what: '**2 PRs** a | b', action: 'Merge', why: 'They wait' }]);
  assert.deepEqual(threadsOf(BODY), [{ thread: 'clerk#97', state: 'building', moved: 'today', next: 'review', who: 'builder' }]);
  assert.deepEqual(tableAfter(BODY, '## Missing'), []);
});

test('checks fold into one word', () => {
  assert.equal(checksState([]), 'none');
  assert.equal(checksState([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }]), 'failing');
  assert.equal(checksState([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }]), 'pending');
  assert.equal(checksState([{ conclusion: 'SUCCESS' }, { state: 'SUCCESS' }]), 'green');
});

test('decision records added by a diff are read from the patch; other records and bad JSON are skipped', () => {
  const patch = (o) => ['@@ -0,0 +1 @@', ...JSON.stringify(o, null, 1).split('\n').map((l) => '+' + l)].join('\n');
  const files = [
    { filename: 'records/tier-2/decision-a.json', status: 'added', patch: patch({ instanceId: 'a', typeName: 'decision', lifecycleState: 'proposed', fieldValues: { title: 'T', decision_kind: 'policy' } }) },
    { filename: 'records/tier-2/problem-b.json', status: 'added', patch: patch({ instanceId: 'b', typeName: 'problem' }) },
    { filename: 'records/tier-2/decision-c.json', status: 'modified', patch: '+{ not json' },
    { filename: 'docs/x.md', status: 'added', patch: '+text' },
  ];
  assert.deepEqual(decisionFilesFromPatch(files), [{ path: 'records/tier-2/decision-a.json', status: 'added', instanceId: 'a', state: 'proposed', title: 'T', question: null, statement: null, kind: 'policy' }]);
});

test('labels read from names or label objects', () => {
  assert.deepEqual(labelsOf({ labels: ['a', { name: 'b' }] }), ['a', 'b']);
  assert.deepEqual(labelsOf({}), []);
});
