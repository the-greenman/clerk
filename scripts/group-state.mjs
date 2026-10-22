#!/usr/bin/env node
// group-state: a working group's pause, cycle and budget, for routines and /ship (clerk#89).
//   node scripts/group-state.mjs <wg:label> --repo <programme> [--json]
//   -> {label, pause, cycleStart, merged, open, budget, room}: room = budget - merged - open (build only when room > 0 and pause is ok)
//   exit 0 read, 1 a read failed (pause or count unknown), 2 usage
import { parseArgs } from 'node:util';
import { loadSettings } from '../lib/adapters/settings.mjs';
import { loadGroups } from '../lib/adapters/groups.mjs';
import { groupStates } from '../lib/adapters/upkeep.mjs';
import { loadWorkflow } from '../lib/adapters/workflow.mjs';

let a;
try { a = parseArgs({ allowPositionals: true, options: { repo: { type: 'string', default: process.cwd() }, json: { type: 'boolean' } } }); }
catch (e) { console.error(`clerk group-state: ${e.message}`); process.exit(2); }
const label = a.positionals[0];
if (!label) { console.error('usage: clerk group-state <wg:label> --repo <programme> [--json]'); process.exit(2); }
const groups = loadGroups(a.values.repo), g = groups.find((x) => x.label === label);
if (!g) { console.error(`clerk group-state: no chartered group labelled "${label}" (known: ${groups.map((x) => x.label).join(', ')})`); process.exit(2); }
const s = groupStates(loadSettings(a.values.repo), [g], loadWorkflow(a.values.repo).gates)[label];
const room = [s.budget, s.merged, s.open].every(Number.isInteger) ? s.budget - s.merged - s.open : 0;
const out = { label, pause: s.pause, cycleStart: s.cycleStart, merged: s.merged, open: s.open, budget: s.budget, room };
console.log(a.values.json ? JSON.stringify(out, null, 2) : `${label}: ${out.pause}; cycle from ${out.cycleStart}; ${out.merged} merged + ${out.open} open of ${out.budget}; room ${room}`);
if (s.why) console.error(`clerk group-state: counts unknown: ${s.why} (attach every settings repo to the session, or set GH_TOKEN)`);
process.exit(s.merged === 'unknown' || s.open === 'unknown' || /unreadable/.test(s.pause) ? 1 : 0);
