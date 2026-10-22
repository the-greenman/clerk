#!/usr/bin/env node
// clerk labels: keep every governed repo's GitHub labels in line with the programme's label bindings (clerk#121, f58db200).
//   (default)              report: missing labels, stale descriptions, retired labels still present (with open items), unknown labels
//   --apply                create missing labels, rewrite stale descriptions (never touches an item)
//   --migrate              move open items from a retired label to its successor (or strip it, none); needs --repo-name <r>
//   --delete-retired       delete the retired labels no open item carries; needs --repo-name <r>
//   The last two change what items mean or lose labels, so the owner confirms each repo.
//   node scripts/labels.mjs --repo <programme> [--repo-name <r>] [--apply | --migrate | --delete-retired] [--json]
// exit 0 in line (or acted cleanly), 1 drift found or a read/act failed, 2 usage
import { parseArgs } from 'node:util';
import { gh } from '../lib/adapters/cli.mjs';
import { list } from '../lib/adapters/github.mjs';
import { loadSettings } from '../lib/adapters/settings.mjs';
import { loadGroups } from '../lib/adapters/groups.mjs';
import { loadWorkflow } from '../lib/adapters/workflow.mjs';
import { planLabels } from '../lib/practice/labels.mjs';

let a;
try { a = parseArgs({ options: { repo: { type: 'string', default: process.cwd() }, 'repo-name': { type: 'string' }, apply: { type: 'boolean' }, 'delete-retired': { type: 'boolean' }, migrate: { type: 'boolean' }, json: { type: 'boolean' } } }).values; }
catch (e) { console.error(`clerk labels: ${e.message}`); process.exit(2); }
if ((a['delete-retired'] || a.migrate) && !a['repo-name']) { console.error('clerk labels: --migrate and --delete-retired act on one repo at a time: add --repo-name <r>'); process.exit(2); }

let st, W, groupLabels;
try { st = loadSettings(a.repo); W = loadWorkflow(a.repo); groupLabels = loadGroups(a.repo).map((g) => g.label); }
catch (e) { console.error(`clerk labels: ${e.message}`); process.exit(1); }
const O = st.githubOwner, repos = a['repo-name'] ? [a['repo-name']] : st.repos;
const api = (...args) => gh(['api', ...args]);
let failed = 0;
const act = (what, f) => { try { f(); console.log(`DID   ${what}`); } catch (e) { failed++; console.log(`FAIL  ${what} (${String(e.stderr || e.message).trim().split('\n')[0]})`); } };

const report = {};
for (const r of repos) {
  let plan;
  try {
    const have = list(`repos/${O}/${r}/labels?per_page=100`).map((l) => ({ name: l.name, description: l.description ?? '' }));
    const present = W.retired.filter((x) => have.some((l) => l.name === x.name));
    const inUse = Object.fromEntries(present.map((x) => [x.name, list(`repos/${O}/${r}/issues?labels=${encodeURIComponent(x.name)}&state=open&per_page=100`).length]));
    plan = planLabels(W, have, inUse, groupLabels);
  } catch (e) { failed++; console.log(`FAIL  read ${r} (${String(e.stderr || e.message).trim().split('\n')[0]})`); continue; }
  report[r] = plan;
  if (!a.json) {
    const line = (k, xs, f) => xs.length && console.log(`${r}: ${k} ${xs.map(f).join(', ')}`);
    line('missing', plan.missing, (l) => l.name);
    line('stale description', plan.stale, (l) => l.name);
    line('retired', plan.retired, (l) => `${l.name} (${l.open} open${l.successor ? ` -> ${l.successor}` : ', no successor'})`);
    line('unknown', plan.unknown, (n) => n);
  }
  const slug = `${O}/${r}`;
  if (a.apply) {
    for (const l of plan.missing) act(`${r}: create ${l.name}`, () => api('-X', 'POST', `repos/${slug}/labels`, '-f', `name=${l.name}`, '-f', 'color=ededed', '-f', `description=${l.description}`));
    for (const l of plan.stale) act(`${r}: describe ${l.name}`, () => api('-X', 'PATCH', `repos/${slug}/labels/${encodeURIComponent(l.name)}`, '-f', `description=${l.description}`));
  }
  if (a.migrate) {
    for (const x of plan.retired.filter((x) => x.open)) for (const i of list(`repos/${slug}/issues?labels=${encodeURIComponent(x.name)}&state=open&per_page=100`))
      act(`${r}#${i.number}: ${x.name} -> ${x.successor ?? '(removed)'}`, () => {
        if (x.successor) api('-X', 'POST', `repos/${slug}/issues/${i.number}/labels`, '-f', `labels[]=${x.successor}`);
        api('-X', 'DELETE', `repos/${slug}/issues/${i.number}/labels/${encodeURIComponent(x.name)}`);
      });
  }
  if (a['delete-retired']) for (const x of plan.retired)
    if (x.open) console.log(`KEEP  ${r}: ${x.name} (${x.open} open still carry it; run --migrate first)`);
    else act(`${r}: delete ${x.name}`, () => api('-X', 'DELETE', `repos/${slug}/labels/${encodeURIComponent(x.name)}`));
}
if (a.json) console.log(JSON.stringify(report, null, 2));
const drift = Object.values(report).some((p) => p.missing.length || p.stale.length || p.retired.length), acting = a.apply || a.migrate || a['delete-retired'];
if (!a.json && !acting) console.log(drift ? 'drift found (--apply creates and describes; then per repo --migrate, then --delete-retired, with --repo-name <r>)' : 'labels in line');
process.exit(failed || (drift && !acting) ? 1 : 0);
