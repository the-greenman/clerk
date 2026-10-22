// Tier 2: a real clerk serve, real git and the pinned srs CLI against a real programme checkout. Every GET operation's live
// response is validated against api/openapi.json (conformance on live output, not fixtures). Needs SRS_CLI_PATH and, for the
// GitHub-reading operations (desk, ground, queue, the desk snapshot), GH_TOKEN or a logged-in gh.
//   node test/integration/serve.int.mjs <programme checkout>   (npm run test:integration -- <programme>)
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEC, createService, execClerk, allowedHosts } from '../../scripts/serve.mjs';
import { createSync } from '../../lib/adapters/sync.mjs';
import { routes } from '../../lib/practice/api.mjs';
import { specValidator } from '../lib/spec-validate.mjs';

const live = resolve(process.argv[2] ?? '');
if (!process.argv[2]) { console.error('usage: serve.int.mjs <programme checkout>'); process.exit(2); }
const clerkDir = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
// pull: false: the test reads the checkouts as they stand, never fast-forwarding anyone's working copy
const sync = createSync({ live, clerkDir, stateDir: mkdtempSync(join(tmpdir(), 'clerk-int-')), everyMinutes: 0, pull: false });
const hosts = new Set();
const server = createServer(createService({ clerk: execClerk(live), sync, live, hosts }));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
for (const h of allowedHosts(server.address().port)) hosts.add(h);
const base = `http://127.0.0.1:${server.address().port}`;
const validate = specValidator(SPEC);
const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
const QUERY = { explain: '?ref=semanticops.com%2338', ground: `?since=${since}` };

let failed = 0;
const check = async (method, r, headers = {}) => {
  const res = await fetch(base + r.path + (QUERY[r.operationId] ?? ''), { method, headers });
  const body = await res.json(), errs = validate(r.operationId, res.status, body);
  const label = `${method} ${r.path}${QUERY[r.operationId] ?? ''}`.padEnd(48);
  if (res.status !== 200 || errs.length) { failed++; console.log(`✗ ${label} ${res.status} ${body.ok ? '' : JSON.stringify(body.errors)}\n    ${errs.join('\n    ')}`); }
  else console.log(`✓ ${label} 200`);
};
// one real sync first, so the snapshots exist
await check('POST', routes(SPEC).find((r) => r.operationId === 'syncNow'), { 'x-control-room': '1' });
const status = sync.status();
if (status.notes.some((n) => /\.json:/.test(n))) { failed++; console.log(`✗ the sync could not write a snapshot: ${status.notes.join('; ')}`); }
for (const r of routes(SPEC).filter((r) => r.method === 'GET')) await check('GET', r);
server.close();
console.log(failed ? `\n${failed} operation(s) failed` : '\nevery operation conforms to api/openapi.json');
process.exit(failed ? 1 : 0);
