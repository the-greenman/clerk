// The sync job (lib/adapters/sync.mjs) with an injected runner: no git, srs or gh. One sync at a time across processes, a
// stale lock taken over, files swapped in whole, dirty checkouts reported not pulled, and the desk on its own cadence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSync, writeAtomic, FILES } from '../lib/adapters/sync.mjs';

function fixture({ dirty = [], deskMinutes = 30, alive = () => false, clock = () => new Date('2026-10-22T10:00:00Z') } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), 'clerk-sync-')), calls = [];
  let release;
  const gate = new Promise((ok) => (release = ok));
  const run = async (cmd, args, { cwd } = {}) => {
    calls.push([cmd === process.execPath ? 'clerk' : cmd, ...(cmd === process.execPath ? args.slice(1, -2) : args), cwd]);
    if (cmd === 'git' && args[0] === 'status') return dirty.includes(cwd) ? ' M x\n' : '';
    if (cmd === 'git' && args[0] === 'log') return 'abc1234 a commit\n';
    if (cmd === 'git') return '';
    await gate; // hold the commands so a second sync can arrive while the first runs
    return args.includes('snapshot') ? '{"records":[]}' : '{"needs":[]}';
  };
  const sync = createSync({ live: '/p/srs-programme', clerkDir: '/p/clerk', stateDir, everyMinutes: 5, deskMinutes, run, now: clock, pid: 4242, alive });
  return { sync, calls, stateDir, release };
}

test('two syncs at once in one process collapse into one run', async () => {
  const f = fixture();
  const a = f.sync.syncNow(), b = f.sync.syncNow();
  assert.equal(a, b);
  f.release();
  await a;
  assert.equal(f.calls.filter((c) => c[0] === 'clerk' && c[1] === 'snapshot').length, 1);
});

test('a sync held by another live process is not run again here', async () => {
  const f = fixture({ alive: (pid) => pid === 9999 });
  writeFileSync(join(f.stateDir, FILES.lock), '9999');
  const s = await f.sync.syncNow();
  assert.equal(s.syncing, true);
  assert.equal(f.calls.length, 0);
});

test('a stale lock (its holder is gone) is taken over, and released after', async () => {
  const f = fixture({ alive: () => false });
  writeFileSync(join(f.stateDir, FILES.lock), '9999');
  const p = f.sync.syncNow();
  f.release();
  const s = await p;
  assert.ok(f.calls.length > 0);
  assert.equal(s.syncing, false);
  assert.equal(existsSync(join(f.stateDir, FILES.lock)), false);
});

test('a dirty checkout is reported and never pulled', async () => {
  const f = fixture({ dirty: ['/p/srs-programme'] });
  const p = f.sync.syncNow();
  f.release();
  const s = await p;
  assert.deepEqual(s.notes, ['srs-programme: local changes, not pulled']);
  assert.equal(f.calls.some((c) => c[0] === 'git' && c[1] === 'pull' && c.at(-1) === '/p/srs-programme'), false);
  assert.ok(f.calls.some((c) => c[0] === 'git' && c[1] === 'pull' && c.at(-1) === '/p/clerk'));
});

test('snapshots are written by the clerk commands, whole, with nothing left half-written', async () => {
  const f = fixture();
  const p = f.sync.syncNow();
  f.release();
  await p;
  assert.deepEqual(f.calls.filter((c) => c[0] === 'clerk').map((c) => c.slice(1, -1)), [['snapshot', '--json'], ['desk', '--json']]);
  assert.equal(f.sync.data('programme'), '{"records":[]}');
  assert.equal(f.sync.data('desk'), '{"needs":[]}');
  assert.deepEqual(readdirSync(f.stateDir).filter((n) => n.endsWith('.tmp')), []);
  const st = JSON.parse(readFileSync(join(f.stateDir, FILES.status), 'utf8'));
  assert.equal(st.head, 'abc1234 a commit');
});

test('writeAtomic swaps a file in whole: the old content until the rename, the new content after', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clerk-atomic-')), p = join(dir, 'x.json');
  writeAtomic(p, 'old');
  writeAtomic(p, 'new'.repeat(100000));
  assert.equal(readFileSync(p, 'utf8').length, 300000);
  assert.equal(existsSync(`${p}.tmp`), false);
});

test('the desk keeps its own cadence on a scheduled sync, and a forced sync refreshes it', async () => {
  let t = new Date('2026-10-22T10:00:00Z');
  const f = fixture({ deskMinutes: 30, clock: () => t });
  f.release();
  await f.sync.syncNow({ force: false }); // first: no desk yet, so it is due
  const desks = () => f.calls.filter((c) => c[0] === 'clerk' && c[1] === 'desk').length;
  assert.equal(desks(), 1);
  t = new Date('2026-10-22T10:05:00Z');
  await f.sync.syncNow({ force: false }); // 5 min later: programme only
  assert.equal(desks(), 1);
  assert.equal(f.calls.filter((c) => c[0] === 'clerk' && c[1] === 'snapshot').length, 2);
  await f.sync.syncNow(); // forced
  assert.equal(desks(), 2);
  t = new Date('2026-10-22T10:40:00Z');
  await f.sync.syncNow({ force: false }); // 35 min after the last desk: due again
  assert.equal(desks(), 3);
});
