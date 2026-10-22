// clerk serve on an ephemeral port, with the clerk command and the sync job injected: no srs, git or gh. Every response is
// validated against api/openapi.json, so the server cannot drift from its contract without a test failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SPEC, createService, LOOPBACK, allowedHosts } from '../scripts/serve.mjs';
import { specValidator } from './lib/spec-validate.mjs';

const validate = specValidator(SPEC);
const SETTINGS = { title: 'P', githubOwner: 'o', governedRepos: ['a'], reportIssue: 'a#1', digestIssue: 'a#2', boardProject: 6, boardStoryRepo: 'a', ownerActor: 'human:o', repos: ['a'] };
const STATUS = { at: '2026-10-22T10:00:00.000Z', ms: 12, head: 'abc msg', deskAt: null, notes: [], everyMinutes: 5, deskMinutes: 30, clerkUpdated: false, syncing: false };

async function serve({ clerk, snapshots = {}, acts = [] } = {}) {
  const calls = [];
  const sync = { status: () => STATUS, syncNow: async () => STATUS, data: (n) => snapshots[n] ?? null };
  const fakeClerk = async (args) => { calls.push(args); return clerk ? clerk(args) : { exit: 0, stdout: '', stderr: '' }; };
  const hosts = new Set(); // filled once the port is known
  const server = createServer(createService({ clerk: fakeClerk, sync, live: '/p', hosts, actLog: (e) => acts.push(e), startedAt: '2026-10-22T09:00:00.000Z' }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  for (const h of allowedHosts(server.address().port)) hosts.add(h);
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, path, headers = {}) => { const r = await fetch(base + path, { method, headers }); return { status: r.status, body: await r.json() }; };
  // fetch cannot set Host; a raw request can, as a rebinding page's browser effectively does
  const withHost = (host, method = 'GET', path = '/api/health') => new Promise((ok, no) => {
    const r = request({ host: '127.0.0.1', port: server.address().port, method, path, headers: { host, 'x-control-room': '1' } }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(b) }));
    });
    r.on('error', no); r.end();
  });
  return { req, withHost, calls, acts, close: () => new Promise((ok) => server.close(ok)) };
}
// assert the status and that the body conforms to the spec for that operation
const conforms = (op, r, status) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.deepEqual(validate(op, r.status, r.body), []); };

test('health and sync status conform to the spec', async () => {
  const s = await serve();
  try {
    const h = await s.req('GET', '/api/health');
    conforms('health', h, 200);
    assert.equal(h.body.payload.version, SPEC.info.version);
    conforms('syncStatus', await s.req('GET', '/api/sync'), 200);
  } finally { await s.close(); }
});

test('a JSON read runs the clerk command of the same name, and its output conforms', async () => {
  const s = await serve({ clerk: () => ({ exit: 0, stdout: JSON.stringify(SETTINGS), stderr: '' }) });
  try {
    conforms('settings', await s.req('GET', '/api/clerk/settings'), 200);
    assert.deepEqual(s.calls, [['settings', '--json']]);
  } finally { await s.close(); }
});

test('a failing command is a 500 with command-failed, never a crash', async () => {
  const s = await serve({ clerk: () => ({ exit: 1, stdout: '', stderr: 'boom\n' }) });
  try {
    const r = await s.req('GET', '/api/clerk/roadmap');
    conforms('roadmap', r, 500);
    assert.equal(r.body.errors[0].code, 'command-failed');
    const b = await serve({ clerk: () => ({ exit: 0, stdout: 'not json', stderr: '' }) });
    try { assert.equal((await b.req('GET', '/api/clerk/groups')).body.errors[0].code, 'bad-output'); } finally { await b.close(); }
  } finally { await s.close(); }
});

test('a text read reports its exit code as data: clerk check exiting 1 is findings, not a failure', async () => {
  const s = await serve({ clerk: () => ({ exit: 1, stdout: '✗ a tension has 1 pole\n', stderr: '' }) });
  try {
    const r = await s.req('GET', '/api/clerk/check');
    conforms('check', r, 200);
    assert.equal(r.body.payload.exit, 1);
  } finally { await s.close(); }
});

test('parameters are checked from the spec before any command runs', async () => {
  const s = await serve();
  try {
    conforms('explain', await s.req('GET', '/api/clerk/explain'), 400);
    conforms('explain', await s.req('GET', '/api/clerk/explain?ref=no%20space'), 400);
    conforms('settings', await s.req('GET', '/api/clerk/settings?x=1'), 400);
    assert.equal(s.calls.length, 0);
    await s.req('GET', '/api/clerk/explain?ref=clerk%2397');
    assert.deepEqual(s.calls, [['roadmap', '--explain', 'clerk#97']]);
  } finally { await s.close(); }
});

test('ground takes exactly one of ref or since', async () => {
  const s = await serve({ clerk: () => ({ exit: 0, stdout: JSON.stringify({ i1: { total: 0, grounded: 0, share: 0, full: 0, fullShare: 0, byLevel: { none: 0, issue: 0, problem: 0, 'problem+persona+domain': 0, epic: 0, group: 0 } }, prs: [] }), stderr: '' }) });
  try {
    conforms('ground', await s.req('GET', '/api/clerk/ground'), 400);
    conforms('ground', await s.req('GET', '/api/clerk/ground?ref=clerk%231&since=2026-10-01'), 400);
    conforms('ground', await s.req('GET', '/api/clerk/ground?since=2026-10-01'), 200);
    assert.deepEqual(s.calls, [['ground', '--since', '2026-10-01', '--json']]);
  } finally { await s.close(); }
});

test('an act needs the x-control-room header, and is logged with the remote address', async () => {
  const s = await serve();
  try {
    const refused = await s.req('POST', '/api/sync');
    conforms('syncNow', refused, 403);
    assert.equal(refused.body.errors[0].code, 'act-needs-header');
    assert.equal(s.acts.length, 0);
    conforms('syncNow', await s.req('POST', '/api/sync', { 'x-control-room': '1' }), 200);
    assert.equal(s.acts.length, 1);
    assert.equal(s.acts[0].op, 'syncNow');
    assert.match(s.acts[0].remote, /127\.0\.0\.1/);
  } finally { await s.close(); }
});

test('unknown paths are 404 and wrong methods 405, in the envelope', async () => {
  const s = await serve();
  try {
    const nf = await s.req('GET', '/api/nope');
    assert.equal(nf.status, 404);
    assert.deepEqual(validate('health', 404, nf.body), []);
    const na = await s.req('DELETE', '/api/sync');
    assert.equal(na.status, 405);
    assert.equal(na.body.errors[0].code, 'method-not-allowed');
  } finally { await s.close(); }
});

test('a snapshot is 404 not-synced until the first sync, then served as written', async () => {
  const empty = await serve();
  try { const r = await empty.req('GET', '/api/data/programme'); conforms('programmeSnapshot', r, 404); assert.equal(r.body.errors[0].code, 'not-synced'); }
  finally { await empty.close(); }
  const programme = { extractedAt: 't', repo: '/p', repository: { repositoryId: 'r', title: 'P', description: null, conformance: null },
    records: [{ id: 'a', label: 'x', ns: 'm', type: 'problem', state: null, createdAt: 't', updatedAt: 't', by: { kind: 'ai', id: 'agent:x' }, tags: [], f: { title: 'x', n: 2, tags: ['a'] } }],
    relations: [], containers: [{ id: 'c', title: 'C', anchor: null, identity: null, outline: [{ id: 'a', depth: 0 }] }] };
  const s = await serve({ snapshots: { programme: JSON.stringify(programme) } });
  try { const r = await s.req('GET', '/api/data/programme'); conforms('programmeSnapshot', r, 200); assert.deepEqual(r.body.payload, programme); }
  finally { await s.close(); }
});

test('a request whose Host is not this service is refused before anything runs (DNS rebinding)', async () => {
  const s = await serve();
  try {
    const evil = await s.withHost('evil.example:5181', 'POST', '/api/sync');
    assert.equal(evil.status, 403);
    assert.equal(evil.body.errors[0].code, 'bad-host');
    assert.equal(s.acts.length, 0);
    assert.equal((await s.withHost('rebind.attacker.test')).status, 403);
    assert.equal((await s.withHost('localhost:1')).status, 403); // right name, wrong port
    assert.equal((await s.req('GET', '/api/health')).status, 200);
  } finally { await s.close(); }
});

test('a name the owner publishes the service under is accepted when configured', () => {
  const h = allowedHosts(5181, ['control.semanticops.com']);
  assert.ok(h.has('control.semanticops.com') && h.has('127.0.0.1:5181') && h.has('[::1]:5181') && h.has('localhost:5181'));
  assert.equal(h.has('control.semanticops.com:9999'), false);
});

test('responses are closed: a field the spec does not name fails validation', () => {
  assert.deepEqual(validate('settings', 200, { ok: true, payload: SETTINGS }), []);
  assert.notDeepEqual(validate('settings', 200, { ok: true, payload: { ...SETTINGS, surprise: 1 } }), []);
  const { ownerActor, ...missing } = SETTINGS;
  assert.notDeepEqual(validate('settings', 200, { ok: true, payload: missing }), []);
});

test('clerk serve binds to a literal loopback address only, and refuses any other before starting', () => {
  assert.deepEqual([...LOOPBACK].sort(), ['127.0.0.1', '::1']);
  for (const host of ['0.0.0.0', '192.168.10.106', '172.28.64.159', '::', 'localhost']) {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/serve.mjs', import.meta.url))], { env: { ...process.env, CLERK_BIND: host, CLERK_SYNC_MINUTES: '0' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 2, `${host}: ${r.stderr}`);
    assert.match(r.stderr, /loopback only/);
  }
});
