import test from 'node:test';
import assert from 'node:assert/strict';
import { verdict, healthComment, latestHealth, healthState } from '../lib/practice/doctor.mjs';
import { deskBody } from '../lib/practice/desk.mjs';

const checks = [{ name: 'settings', ok: true, detail: '9 repos' }, { name: 'repo srs-context', ok: false, detail: '404 (Not Found)' }];
const NOW = '2026-10-22T12:00:00Z';
const marker = (status, at, env = 'cloud') => ({ body: healthComment({ status, env, at }, status === 'ok' ? [checks[0]] : checks), html_url: `https://x/${at}` });

test('verdict fails on any failed check; the comment carries the marker first and the failing lines', () => {
  assert.equal(verdict(checks), 'fail');
  assert.equal(verdict([checks[0]]), 'ok');
  const body = healthComment({ status: 'fail', env: 'cloud', at: NOW }, checks);
  assert.match(body.split('\n')[0], /^<!-- clerk-doctor status=fail env=cloud at=2026-10-22T12:00:00Z -->$/);
  assert.deepEqual(latestHealth([{ body }]).failing, ['repo srs-context: 404 (Not Found)']);
});

test('latestHealth takes the newest marker for the env and ignores other comments', () => {
  const comments = [marker('fail', '2026-10-21T10:00:00Z'), { body: 'digest' }, marker('ok', '2026-10-22T09:00:00Z'), marker('fail', '2026-10-22T10:00:00Z', 'local')];
  assert.equal(latestHealth(comments, 'cloud').status, 'ok');
  assert.equal(latestHealth(comments).env, 'local');
  assert.equal(latestHealth([{ body: 'nothing' }], 'cloud'), null);
});

test('healthState: ok, fail, stale after 26 hours, absent', () => {
  assert.equal(healthState(latestHealth([marker('ok', '2026-10-22T09:00:00Z')]), NOW), 'ok');
  assert.equal(healthState(latestHealth([marker('fail', '2026-10-22T09:00:00Z')]), NOW), 'fail');
  assert.equal(healthState(latestHealth([marker('ok', '2026-10-21T09:00:00Z')]), NOW), 'stale');
  assert.equal(healthState(null, NOW), 'absent');
});

test('desk: a failing or silent canary needs you, an ok one runs fine, an unread one says nothing', () => {
  const body = (health) => deskBody({ now: NOW, ...(health === 'unread' ? {} : { health }) });
  assert.match(body(latestHealth([marker('fail', '2026-10-22T09:00:00Z')])), /Cloud canary failing.*repo srs-context: 404/);
  assert.match(body(null), /Cloud canary silent\*\*: no marker yet/);
  assert.match(body(latestHealth([marker('ok', '2026-10-20T09:00:00Z')])), /Cloud canary silent\*\* since 10-20/);
  const ok = body(latestHealth([marker('ok', '2026-10-22T09:00:00Z')]));
  assert.match(ok, /Nothing needs you/);
  assert.match(ok, /- Cloud canary ok 10-22/);
  assert.doesNotMatch(body('unread'), /canary/);
});
