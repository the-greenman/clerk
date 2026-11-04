// The save pass against real git and a local bare remote, with a fake forge and srs, and no programme anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveEntry, savePass, changedPaths } from '../lib/adapters/registry-save.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const LONG_AGO = new Date('2020-01-01T00:00:00Z');

function configure(dir) { for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false']]) git(dir, 'config', k, v); }

// A bare remote with one commit on main, and a clone sitting on the given branch.
function fixture({ branch = 'served' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'clerk-save-'));
  const bare = join(root, 'o.git'), seed = join(root, 'seed'), clone = join(root, 'clone');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(root, 'clone', '-q', bare, seed);
  configure(seed);
  git(seed, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(seed, 'a.json'), '1\n');
  git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'first'); git(seed, 'push', '-q', '-u', 'origin', 'main');
  git(root, 'clone', '-q', bare, clone);
  configure(clone);
  if (branch !== 'main') git(clone, 'checkout', '-q', '-b', branch, 'origin/main');
  return { bare, seed, clone, entry: { kind: 'repository', id: 'r1', locator: { mode: 'local', path: clone } } };
}

// A write that landed a while ago, past the quiet window.
function write(clone, file = 'new.json', body = '2\n') { writeFileSync(join(clone, file), body); utimesSync(join(clone, file), LONG_AGO, LONG_AGO); }

// Real git; srs and the forge answered here. prs is what the forge has open.
function runner({ validate = { ok: true, payload: { summary: { errors: 0 } } }, prs = [] } = {}) {
  const calls = [];
  const run = (cmd, args, { cwd } = {}) => {
    if (cmd === 'git') return Promise.resolve(execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    calls.push(['srs', ...args]);
    return Promise.resolve(JSON.stringify(validate));
  };
  const forge = {
    findOpen: (a) => { calls.push(['findOpen', a]); return prs[0] ?? null; },
    create: (a) => { calls.push(['create', a]); const pr = { url: 'https://x/pull/1', number: 1 }; prs.push(pr); return pr; },
    merge: (a) => { calls.push(['merge', a]); },
  };
  return { run, forge, calls };
}
const opts = (r, extra = {}) => ({ label: 'a-label', host: 'box', run: r.run, forge: r.forge, ...extra });
const named = (r, name) => r.calls.filter((c) => c[0] === name);

test('changedPaths reads porcelain -z, spaces included', () => {
  assert.deepEqual(changedPaths('?? a b.json\0 M c.json\0'), ['a b.json', 'c.json']);
  assert.deepEqual(changedPaths(''), []);
});

test('a clean pass commits, pushes the machine branch and opens a self-merging PR', async () => {
  const f = fixture(), r = runner();
  write(f.clone);
  const res = await saveEntry(f.entry, opts(r));
  assert.equal(res.held, null);
  assert.equal(res.pr, 'https://x/pull/1');
  assert.equal(res.pending, 1);
  assert.equal(res.uncommitted, 0);
  assert.match(git(f.bare, 'show', 'writes/box:new.json'), /2/);
  assert.equal(git(f.bare, 'rev-parse', 'main'), git(f.seed, 'rev-parse', 'HEAD'), 'main itself is never pushed');
  const [[, create]] = named(r, 'create');
  assert.deepEqual([create.label, create.base, create.head, create.remote], ['a-label', 'main', 'writes/box', f.bare]);
  assert.equal(named(r, 'merge')[0][1].pr.number, 1);
});

test('a second pass reuses the open PR', async () => {
  const f = fixture(), r = runner();
  write(f.clone);
  await saveEntry(f.entry, opts(r));
  write(f.clone, 'more.json');
  const res = await saveEntry(f.entry, opts(r));
  assert.equal(res.pr, 'https://x/pull/1');
  assert.equal(named(r, 'create').length, 1);
  assert.equal(named(r, 'merge').length, 2, 'each pass asks again');
  assert.equal(res.pending, 2);
});

test('red validation holds, and the write stays in place uncommitted', async () => {
  const f = fixture(), r = runner({ validate: { ok: true, payload: { summary: { errors: 3 } } } });
  write(f.clone);
  const res = await saveEntry(f.entry, opts(r));
  assert.match(res.held, /validation/);
  assert.equal(res.uncommitted, 1);
  assert.equal(res.pending, 0);
  assert.ok(existsSync(join(f.clone, 'new.json')));
  assert.equal(named(r, 'create').length + named(r, 'findOpen').length, 0);
});

test('a validator that cannot read the corpus holds too', async () => {
  const f = fixture(), r = runner({ validate: { ok: false, diagnostics: ['too new'] } });
  write(f.clone);
  assert.match((await saveEntry(f.entry, opts(r))).held, /too new/);
});

test('a rebase conflict aborts, holds, and keeps the write committed locally', async () => {
  const f = fixture(), r = runner();
  writeFileSync(join(f.seed, 'new.json'), 'theirs\n');
  git(f.seed, 'add', '-A'); git(f.seed, 'commit', '-q', '-m', 'theirs'); git(f.seed, 'push', '-q', 'origin', 'main');
  write(f.clone, 'new.json', 'mine\n');
  const res = await saveEntry(f.entry, opts(r));
  assert.match(res.held, /rebase/);
  assert.equal(readFileSync(join(f.clone, 'new.json'), 'utf8'), 'mine\n');
  assert.equal(git(f.clone, 'rev-parse', '--abbrev-ref', 'HEAD'), 'served', 'not left mid-rebase');
  assert.equal(res.pending, 1);
  assert.equal(res.behind, 1);
  assert.equal(named(r, 'create').length + named(r, 'findOpen').length, 0);
});

test('a file changed within the quiet window is left alone', async () => {
  const f = fixture(), r = runner();
  writeFileSync(join(f.clone, 'new.json'), '2\n');
  const res = await saveEntry(f.entry, opts(r));
  assert.match(res.held, /arriving/);
  assert.equal(res.uncommitted, 1);
  assert.equal(res.pending, 0);
});

test('a clone on any other branch is refused and untouched', async () => {
  const f = fixture({ branch: 'someones-work' }), r = runner();
  write(f.clone);
  const res = await saveEntry(f.entry, opts(r));
  assert.match(res.held, /someones-work/);
  assert.equal(res.uncommitted, 1);
  assert.equal(git(f.clone, 'log', '--oneline').split('\n').length, 1);
});

test('once merged, the next pass lands served back on main with nothing pending', async () => {
  const f = fixture(), r = runner();
  write(f.clone);
  await saveEntry(f.entry, opts(r));
  git(f.seed, 'fetch', '-q', 'origin');
  git(f.seed, 'merge', '-q', '--no-ff', '-m', 'merge pr', 'origin/writes/box');
  git(f.seed, 'push', '-q', 'origin', 'main');
  r.calls.length = 0;
  const res = await saveEntry(f.entry, opts(r));
  assert.equal(res.pending, 0);
  assert.equal(res.behind, 0);
  assert.equal(res.pr, null);
  assert.equal(named(r, 'create').length + named(r, 'findOpen').length, 0);
  assert.equal(git(f.clone, 'rev-parse', 'HEAD'), git(f.seed, 'rev-parse', 'HEAD'));
});

test('a read-only entry only fast-forwards', async () => {
  const f = fixture({ branch: 'main' }), r = runner();
  writeFileSync(join(f.seed, 'b.json'), '3\n');
  git(f.seed, 'add', '-A'); git(f.seed, 'commit', '-q', '-m', 'second'); git(f.seed, 'push', '-q', 'origin', 'main');
  const res = await saveEntry({ ...f.entry, readOnly: true }, opts(r));
  assert.equal(res.held, null);
  assert.equal(res.behind, 0);
  assert.equal(git(f.clone, 'rev-parse', 'HEAD'), git(f.seed, 'rev-parse', 'HEAD'));
  assert.deepEqual(r.calls, []);
});

test('a running pass holds a second one, and a stale lock is taken over', async () => {
  const f = fixture(), r = runner();
  const lock = join(f.clone, '.git', 'registry-save.lock');
  mkdirSync(lock);
  assert.match((await saveEntry(f.entry, opts(r))).held, /another save pass/);
  utimesSync(lock, LONG_AGO, LONG_AGO);
  assert.equal((await saveEntry(f.entry, opts(r))).held, null);
  assert.ok(!existsSync(lock));
});

test('savePass reads the registry and reports a non-local locator as held', async () => {
  const f = fixture(), r = runner();
  const registry = join(mkdtempSync(join(tmpdir(), 'clerk-reg-')), 'registry.json');
  writeFileSync(registry, JSON.stringify({ registryRevision: 1, entries: [f.entry, { kind: 'repository', id: 'r2', locator: { mode: 'remote', url: 'x' } }] }));
  const rows = await savePass({ registry, ...opts(r) });
  assert.deepEqual(rows.map((x) => x.id), ['r1', 'r2']);
  assert.equal(rows[0].held, null);
  assert.match(rows[1].held, /local/);
});
