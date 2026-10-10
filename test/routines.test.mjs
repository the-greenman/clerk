import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRoutines } from '../lib/practice/routines.mjs';

const thinPrompt = (b) => `Read ${b} in the-greenman/clerk (default branch).`;
const T = (id, name, enabled, prompt = '') => ({ id, name, enabled, cron_expression: '0 0 * * *', prompt });
const briefs = new Set(['routines/a.md', 'routines/b.md']);

test('clean set has no drift', () => {
  const d = checkRoutines({ triggers: [T('t1', 'A', true, thinPrompt('routines/a.md'))], jobs: [{ id: 'j1', title: 'A', routine_id: 't1', brief: 'routines/a.md' }], briefs });
  assert.deepEqual(d, []);
});

test('each drift kind', () => {
  const triggers = [
    T('t-orphan', 'Orphan', true, thinPrompt('routines/a.md')),
    T('t-off', 'Off', false),
    T('t-fat', 'Fat', true, 'Read routines/a.md in srs-programme.'),
    T('t-gone', 'Gone', true, 'See routines/zzz.md in the-greenman/clerk'),
    T('t-ci', 'Check-in: x', false),
    T('t-ci-on', 'Check-in: y', true),
  ];
  const jobs = [
    { id: 'j-off', title: 'Off job', routine_id: 't-off', brief: 'routines/a.md' },
    { id: 'j-fat', title: 'Fat job', routine_id: 't-fat', brief: 'routines/a.md' },
    { id: 'j-gone', title: 'Gone job', routine_id: 't-gone', brief: 'routines/zzz.md' },
    { id: 'j-none', title: 'No trigger', routine_id: 't-missing', brief: 'routines/b.md' },
  ];
  const kinds = checkRoutines({ triggers, jobs, briefs }).map((d) => `${d.kind}:${d.subject}`).sort();
  assert.deepEqual(kinds, [
    'brief-missing:j-gone', 'brief-missing:t-gone', 'prompt-not-thin:t-fat',
    'record-trigger-disabled:j-off', 'record-without-trigger:j-none', 'stale-check-in:t-ci', 'trigger-without-record:t-orphan',
  ].sort());
});
