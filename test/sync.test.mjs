// The sync job (lib/adapters/sync.mjs) with an injected runner: no git, srs or gh. One sync at a time across processes, a
// stale lock taken over, files swapped in whole, dirty checkouts reported not pulled, and the desk on its own cadence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSync, writeAtomic, pidLock, FILES } from '../lib/adapters/sync.mjs';

function fixture({ dirty = [], deskMinutes = 30, alive = () => false, clock = () => new Date('2026-10-22T10:00:00Z'), stateDir = mkdtempSync(join(tmpdir(), 'clerk-sync-')),
  pid = 4242, pull = true, out = {}, heads = null } = {}) {
  const calls = [];
  let release;
  const gate = new Promise((ok) => (release = ok));
  const run = async (cmd, args, { cwd } = {}) => {
    calls.push([cmd === process.execPath ? 'clerk' : cmd, ...(cmd === process.execPath ? args.slice(1, -2) : args), cwd]);
    if (cmd === 'git' && args[0] === 'status') return dirty.includes(cwd) ? ' M x\n' : '';
    if (cmd === 'git' && args[0] === 'log') return heads ? heads(cwd) : 'abc1234 a commit\n';
    if (cmd === 'git') return '';
    await gate; // hold the commands so a second sync can arrive while the first runs
    const kind = args.includes('snapshot') ? 'snapshot' : 'desk';
    if (out[kind] instanceof Error) throw out[kind];
    return out[kind] ?? (kind === 'snapshot' ? '{"records":[]}' : '{"needs":[]}');
  };
  const sync = createSync({ live: '/p/srs-programme', clerkDir: '/p/clerk', stateDir, everyMinutes: 5, deskMinutes, pull, run, now: clock, pid, alive });
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

test('two processes sharing the state dir: the second does not sync while the first holds the lock', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'clerk-sync-')), alive = (p) => p === 1 || p === 2;
  const a = fixture({ stateDir, pid: 1, alive }), b = fixture({ stateDir, pid: 2, alive });
  const pa = a.sync.syncNow();
  const sb = await b.sync.syncNow();
  assert.equal(sb.syncing, true);
  assert.equal(b.calls.length, 0);
  a.release();
  await pa;
  assert.equal(existsSync(join(stateDir, FILES.lock)), false);
});

test('a stale lock is taken by one taker only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clerk-lock-')), path = join(dir, 'sync.lock'), alive = (p) => p === 1 || p === 2;
  writeFileSync(path, '9999'); // a holder that is gone
  const a = pidLock(path, { pid: 1, alive }), b = pidLock(path, { pid: 2, alive });
  assert.equal(a.take(), true);
  assert.equal(b.take(), false);
  assert.equal(readFileSync(path, 'utf8'), '1');
});

test('a lock older than its staleness bound is stale even if its pid is alive again (pid reuse)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clerk-lock-')), path = join(dir, 'sync.lock');
  writeFileSync(path, '7');
  const old = (Date.now() - 2 * 3600e3) / 1000;
  utimesSync(path, old, old);
  assert.equal(pidLock(path, { pid: 1, alive: () => true }).take(), true);
  assert.equal(readFileSync(path, 'utf8'), '1');
});

test('release removes only our own lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clerk-lock-')), path = join(dir, 'sync.lock');
  writeFileSync(path, '2');
  pidLock(path, { pid: 1, alive: () => true }).release();
  assert.equal(readFileSync(path, 'utf8'), '2');
});

test('output that is not JSON never replaces the last good snapshot', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'clerk-sync-'));
  const good = fixture({ stateDir });
  good.release();
  await good.sync.syncNow();
  const bad = fixture({ stateDir, out: { desk: '{"needs":[{"n":"1", "what": "cut off' } });
  bad.release();
  const st = await bad.sync.syncNow();
  assert.equal(bad.sync.data('desk'), '{"needs":[]}');
  assert.match(st.notes.join(), /desk\.json: output was not JSON; kept the last snapshot/);
});

test('a failing desk waits its full cadence before trying again', async () => {
  let t = new Date('2026-10-22T10:00:00Z');
  const f = fixture({ clock: () => t, out: { desk: new Error('gh: API rate limit exceeded') } });
  f.release();
  await f.sync.syncNow({ force: false });
  const desks = () => f.calls.filter((c) => c[0] === 'clerk' && c[1] === 'desk').length;
  assert.equal(desks(), 1);
  t = new Date('2026-10-22T10:05:00Z');
  await f.sync.syncNow({ force: false });
  assert.equal(desks(), 1); // not retried 5 minutes later
});

test('pull: false reads the checkouts as they stand and never runs git pull', async () => {
  const f = fixture({ pull: false });
  f.release();
  await f.sync.syncNow();
  assert.equal(f.calls.some((c) => c[0] === 'git' && (c[1] === 'pull' || c[1] === 'status')), false);
});

test('a sync that fast-forwards the clerk itself says so (the service then restarts on the new code)', async () => {
  let n = 0;
  const f = fixture({ heads: (cwd) => (cwd === '/p/clerk' ? (n++ === 0 ? 'aaa1111 old\n' : 'bbb2222 new\n') : 'ccc3333 p\n') });
  f.release();
  assert.equal((await f.sync.syncNow()).clerkUpdated, true);
});
