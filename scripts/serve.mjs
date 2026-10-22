#!/usr/bin/env node
// clerk serve [--repo <programme>]: the clerk's local service (docs/service.md). One handler per operation of
// api/openapi.json, no semantics here: each read runs the clerk command of the same name, and the sync job keeps the programme
// and desk snapshots current. Binds to loopback only (decision e745e9b2); acts need the x-control-room header.
//   CLERK_PORT (5181)  CLERK_BIND (127.0.0.1; loopback only)  CLERK_SYNC_MINUTES (5; 0 = off)  CLERK_DESK_MINUTES (30)
//   CLERK_STATE_DIR (~/.local/state/clerk)
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, checkSpec, checkQuery, ok, fail, error } from '../lib/practice/api.mjs';
import { createSync } from '../lib/adapters/sync.mjs';

const CLERK_DIR = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
export const SPEC = JSON.parse(readFileSync(new URL('../api/openapi.json', import.meta.url), 'utf8'));
export const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

// a clerk command as a child process: its exit code is data, never an exception
export const execClerk = (live) => (args) => new Promise((done) =>
  execFile(process.execPath, [join(CLERK_DIR, 'bin', 'clerk.mjs'), ...args, '--repo', live], { cwd: CLERK_DIR, maxBuffer: 1 << 28, timeout: 300000 },
    (e, stdout, stderr) => done({ exit: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) })));

// operationId -> handler(query, ctx) -> envelope; ctx = { clerk, sync, live, startedAt }
const json = (args) => async (q, { clerk }) => {
  const r = await clerk(args);
  if (r.exit !== 0) return fail(error('command-failed', `clerk ${args.join(' ')} exited ${r.exit}: ${r.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 500)}`));
  try { return ok(JSON.parse(r.stdout)); } catch { return fail(error('bad-output', `clerk ${args.join(' ')} did not print JSON`)); }
};
const text = (argsOf) => async (q, { clerk }) => { const r = await clerk(argsOf(q)); return ok({ exit: r.exit, text: r.stdout, stderr: r.stderr }); };
const snapshot = (name) => async (q, { sync }) => {
  const d = sync.data(name);
  if (d === null) return fail(error('not-synced', `no ${name} snapshot yet: wait for the first sync, or POST /api/sync`));
  try { return ok(JSON.parse(d)); } catch { return fail(error('bad-snapshot', `the ${name} snapshot is not JSON`)); }
};
export const HANDLERS = {
  health: async (q, { sync, live, startedAt }) => ok({ version: SPEC.info.version, startedAt, repo: live, sync: sync.status() }),
  syncStatus: async (q, { sync }) => ok(sync.status()),
  syncNow: async (q, { sync }) => ok(await sync.syncNow()),
  settings: json(['settings', '--json']),
  groups: json(['groups', '--json']),
  roadmap: json(['roadmap', '--json']),
  desk: json(['desk', '--json']),
  explain: text((q) => ['roadmap', '--explain', q.ref]),
  check: text(() => ['check']),
  queue: text(() => ['queue']),
  ground: async (q, ctx) => ((q.ref === undefined) === (q.since === undefined)
    ? fail(error('bad-parameter', 'give exactly one of "ref" or "since"'))
    : json(q.ref ? ['ground', '--pr', q.ref, '--json'] : ['ground', '--since', q.since, '--json'])(q, ctx)),
  programmeSnapshot: snapshot('programme'),
  deskSnapshot: snapshot('desk'),
};

const STATUS = { 'unknown-parameter': 400, 'missing-parameter': 400, 'bad-parameter': 400, 'not-found': 404, 'not-synced': 404, 'method-not-allowed': 405, 'act-needs-header': 403 };

// the request listener: route by the spec, check the query, guard acts, answer with the envelope
export function createService({ spec = SPEC, handlers = HANDLERS, clerk, sync, live, actLog = null, startedAt = new Date().toISOString() }) {
  const errors = checkSpec(spec, Object.keys(handlers));
  if (errors.length) throw new Error(`api/openapi.json cannot be served:\n  ${errors.join('\n  ')}`);
  const table = routes(spec);
  return async (req, res) => {
    const send = (env) => {
      const code = env.ok ? 200 : (STATUS[env.errors[0].code] ?? 500);
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(env));
    };
    try {
      const url = new URL(req.url, 'http://clerk.local');
      const here = table.filter((r) => r.path === url.pathname);
      if (!here.length) return send(fail(error('not-found', `no operation at ${url.pathname}`)));
      const route = here.find((r) => r.method === req.method);
      if (!route) return send(fail(error('method-not-allowed', `${req.method} ${url.pathname}: use ${here.map((r) => r.method).join(' or ')}`)));
      if (route.act && req.headers['x-control-room'] !== '1') return send(fail(error('act-needs-header', `${route.operationId} is an act: send the x-control-room: 1 header`)));
      const query = Object.fromEntries(url.searchParams);
      const bad = checkQuery(route, query);
      if (bad) return send(fail(bad));
      if (route.act && actLog) actLog({ at: new Date().toISOString(), op: route.operationId, remote: req.socket?.remoteAddress ?? null });
      send(await handlers[route.operationId](query, { clerk, sync, live, startedAt }));
    } catch (e) { send(fail(error('internal', String(e.message).slice(0, 500)))); }
  };
}

async function main() {
  const argv = process.argv.slice(2), i = argv.indexOf('--repo');
  const live = resolve(i >= 0 ? argv[i + 1] : '.');
  const host = process.env.CLERK_BIND || '127.0.0.1', port = Number(process.env.CLERK_PORT || 5181);
  if (!LOOPBACK.has(host)) { console.error(`clerk serve: CLERK_BIND=${host} refused: loopback only (127.0.0.1, ::1, localhost), decision e745e9b2`); process.exit(2); }
  const stateDir = resolve(process.env.CLERK_STATE_DIR || join(homedir(), '.local', 'state', 'clerk'));
  const everyMinutes = Number(process.env.CLERK_SYNC_MINUTES ?? 5);
  const sync = createSync({ live, clerkDir: CLERK_DIR, stateDir, everyMinutes, deskMinutes: Number(process.env.CLERK_DESK_MINUTES ?? 30) });
  const actLog = (entry) => appendFileSync(join(stateDir, 'acts.jsonl'), JSON.stringify(entry) + '\n');
  let listener;
  try { listener = createService({ clerk: execClerk(live), sync, live, actLog }); }
  catch (e) { console.error(`clerk serve: ${e.message}`); process.exit(2); }
  const server = createServer(listener);
  server.listen(port, host, () => console.log(`clerk serve ${SPEC.info.version}: http://${host.includes(':') ? `[${host}]` : host}:${port}/api/health (programme ${live}; state ${stateDir}; sync every ${everyMinutes || 'never'} min)`));
  if (everyMinutes > 0) { sync.syncNow({ force: false }); setInterval(() => sync.syncNow({ force: false }), everyMinutes * 60e3).unref(); }
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => server.close(() => process.exit(0)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
