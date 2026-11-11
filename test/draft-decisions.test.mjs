// clerk#239: decisions lost in draft. A decision starts in lifecycle draft, every agenda reads the lifecycle only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { strandedDrafts, staleDrafts, statusDrift, checkDecisions } from '../lib/practice/agenda.mjs';
import { deskBody } from '../lib/practice/desk.mjs';

const NOW = '2026-11-10T12:00:00Z';
const dec = (id, lifecycleState, status, createdAt = '2026-11-01T00:00:00Z') =>
  ({ instanceId: `${id}-0000`, record: { typeName: 'decision', lifecycleState, createdAt, fieldValues: { title: `T ${id}`, ...(status ? { status } : {}) } } });
const log = (...ids) => ({ memberInstanceIds: ids.map((i) => ({ instanceId: `${i}-0000` })) });
const ids = (rs) => rs.map((r) => r.instanceId.slice(0, -5));

const records = [
  dec('a', 'draft', 'proposed'), // written as proposed, never proposed
  dec('b', 'draft', 'active'),
  dec('c', 'draft', undefined), // a plain draft, in a log for days
  dec('d', 'draft', undefined, '2026-11-10T06:00:00Z'), // a draft in a log, under a day old
  dec('e', 'proposed', 'proposed'),
  dec('f', 'ratified', 'proposed'), // stale field on a ratified decision
  dec('g', 'ratified', 'active'),
  { instanceId: 'h-0000', record: { typeName: 'remedy', lifecycleState: 'draft', fieldValues: { status: 'proposed' } } }, // not a decision
];

test('a draft whose status says proposed or active is stranded', () => assert.deepEqual(ids(strandedDrafts(records)), ['a', 'b']));

test('a draft in a log for over a day is stale; a younger one, or one in no log, is not', () =>
  assert.deepEqual(ids(staleDrafts(records, [log('c', 'd')], NOW)), ['c']));

test('status drift: ratified reads active, the rest read their own state; stranded drafts are not counted twice', () =>
  assert.deepEqual(ids(statusDrift(records)), ['f']));

test('clerk check: stranded drafts are errors, stale drafts and drift are warnings', () => {
  const { errors, warnings } = checkDecisions(records, [log('a', 'c')], NOW);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /\(a-0000\) says status proposed but is still a draft/);
  assert.equal(warnings.length, 2); // c stale (a is already an error), and one aggregated drift line
  assert.match(warnings[0], /\(c-0000\) has been a draft in a decision log/);
  assert.match(warnings[1], /^1 decision whose status field disagrees/);
  assert.deepEqual(checkDecisions(records.filter((r) => ['e', 'g'].includes(r.instanceId[0])), [], NOW), { errors: [], warnings: [] });
});

test('desk: decisions stuck in draft need you, once each', () => {
  const body = deskBody({ now: NOW, decisions: records, ownerLog: log('a', 'c'), gates: { auto: 'gate:auto-merge', owner: 'gate:owner-merge' } });
  assert.match(body, /\*\*3 decisions stuck in draft:\*\* T a \[a-0000\], T b \[b-0000\], T c \[c-0000\]/);
  assert.match(body, /byTransition":"propose"/);
});
