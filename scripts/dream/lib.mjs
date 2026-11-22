// Shared by the programme-dream scripts: flags, and the srs CLI as an async JSON call. Built-ins only.
import { spawn } from 'node:child_process';

export function flags(argv = process.argv.slice(2)) {
  const f = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) f[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  f.srs ||= process.env.SRS_CLI_PATH;
  f.repo ||= '.';
  if (!f.srs) throw new Error('give --srs <path> or set SRS_CLI_PATH');
  return f;
}

// Run `srs <args> --repo <repo>`; resolve to the payload, reject on ok:false. `body` goes to stdin as JSON.
export function call(f, args, body, actor) {
  return new Promise((ok, fail) => {
    const p = spawn(f.srs, [...args, '--repo', f.repo], { env: actor ? { ...process.env, SRS_ACTOR: actor } : process.env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => {
      try { const o = JSON.parse(out); o.ok ? ok(o.payload) : fail(new Error(`${args.join(' ')}: ${JSON.stringify(o.errors)}`)); } catch (e) { fail(new Error(`${args.join(' ')}: ${e.message}`)); }
    });
    p.stdin.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

export async function find(f, ...args) {
  const hits = [];
  for (let off = 0; ; off += 200) {
    const r = (await call(f, ['find', ...args, '--limit', '200', '--offset', String(off), '--projection', 'label'])).result;
    hits.push(...r.hits);
    if (off + 200 >= r.total) return hits;
  }
}

// map fn over xs, at most n at a time
export async function pool(xs, fn, n = 8) {
  const out = new Array(xs.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < xs.length) { const i = next++; out[i] = await fn(xs[i]); } }));
  return out;
}

export const isMain = (url) => process.argv[1] && new URL(url).pathname === new URL(`file://${process.argv[1]}`).pathname;
