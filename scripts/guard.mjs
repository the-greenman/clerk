#!/usr/bin/env node
// guard: refuse an authority act (ratify, set aside, affirm, authorise, receive) in a programme change that lacks its proof.
//   node scripts/guard.mjs --base <ref> [--repo <programme>] [--json]        exit 1 on any unproven act, 2 on bad usage or an unreadable base
import { srsCli } from '../lib/adapters/cli.mjs';
import { guard } from '../lib/adapters/guard.mjs';
import { unproven } from '../lib/practice/guard.mjs';
import { repoRoot } from './lib/repo-arg.mjs';

const i = process.argv.indexOf('--base'), base = i >= 0 ? process.argv[i + 1] : undefined;
if (!base) { console.error('usage: clerk guard --base <ref> [--repo <programme>] [--json]'); process.exit(2); }
const repo = repoRoot();
let acts;
try { acts = guard({ cli: srsCli(repo), repo, base }); } catch (e) { console.error(`clerk guard: ${e.message}`); process.exit(2); }
const bad = unproven(acts);
if (process.argv.includes('--json')) console.log(JSON.stringify(acts, null, 2));
else {
  for (const a of acts) console.log(`${a.ok ? 'ok  ' : 'FAIL'} ${a.act} ${a.ref}: ${a.why}`);
  console.log(`${acts.length} authority act${acts.length === 1 ? '' : 's'}, ${bad.length} unproven`);
}
process.exit(bad.length ? 1 : 0);
