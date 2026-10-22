import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workflowFrom } from '../lib/practice/workflow.mjs';

const fixture = JSON.parse(readFileSync(new URL('./workflow.fixture.json', import.meta.url), 'utf8'));

test('workflowFrom: labels and board columns come from the active bindings', () => {
  const W = workflowFrom(fixture);
  assert.equal(W.inProgress, 'status: in progress');
  assert.equal(W.columns.in_review, 'In review');
  assert.deepEqual(W.holds, ['needs-input', 'blocked', 'parked']);
  assert.equal(W.isHeld(['ready', 'parked']), true);
  assert.equal(W.isHeld(['ready', 'status: in progress']), false);
  assert.ok(!W.labels.some((l) => l.name === 'in-progress'), 'retired bindings are not live labels');
});

test('workflowFrom: a definition the clerk acts on with no active binding stops the run', () => {
  const bindings = fixture.bindings.filter((b) => b.github_label !== 'needs-input');
  assert.throws(() => workflowFrom({ ...fixture, bindings }), /needs-input/);
  assert.throws(() => workflowFrom({ ...fixture, lifecycles: [] }), /work_item/);
  assert.throws(() => workflowFrom({ ...fixture, bindings: fixture.bindings.filter((b) => b.github_label !== 'status: in review') }), /in_review/);
});
