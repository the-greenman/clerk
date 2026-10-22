#!/usr/bin/env node
// upkeep: keep the estate's open PRs moving (srs-programme#39, clerk#89). The rules are practice/upkeep.mjs; this reads and acts.
//   gate:auto-merge CLEAN -> merge; BEHIND -> update branch. gate:owner-merge -> never merged here; BEHIND -> update branch.
//   A group PR (its wg: label) merges only on a valid quorum for its head commit, within budget, while the group is not paused.
//   --digest posts one comment on the settings digest issue: conflicts, ungated PRs, group waits. Dry run unless --apply.
//   node scripts/upkeep.mjs --repo <programme> [--apply] [--digest]      exit 0 ran clean, 1 a read or act failed, 2 usage
import { parseArgs } from 'node:util';
import { loadSettings, issueRef } from '../lib/adapters/settings.mjs';
import { loadGroups } from '../lib/adapters/groups.mjs';
import { loadWorkflow } from '../lib/adapters/workflow.mjs';
import { groupStates, repoPRs } from '../lib/adapters/upkeep.mjs';
import { mergePR, updateBranch, comment } from '../lib/adapters/github.mjs';
import { upkeepPlan, digestBody } from '../lib/practice/upkeep.mjs';

let opts;
try { opts = parseArgs({ options: { repo: { type: 'string', default: process.cwd() }, apply: { type: 'boolean' }, digest: { type: 'boolean' } } }).values; }
catch (e) { console.error(`clerk upkeep: ${e.message}`); process.exit(2); }

let fails = 0;
const fail = (what, e) => { console.log(`FAIL  ${what}${e ? ` (${String(e.stderr || e.message).trim().split('\n')[0]})` : ''}`); fails++; };
let st, groups, gates;
try { st = loadSettings(opts.repo); groups = loadGroups(opts.repo); gates = loadWorkflow(opts.repo).gates; }
catch (e) { fail('programme settings, working groups or merge-gate labels unreadable', e); process.exit(1); } // no gate labels: no merge

const G = groupStates(st, groups, gates);
for (const [l, g] of Object.entries(G)) {
  if (g.merged === 'unknown') fail(`budget count for ${l}`);
  if (/unreadable/.test(g.pause)) fail(`pause check for ${l}`);
}
const repos = st.repos.flatMap((r) => { try { return [repoPRs(st.githubOwner, r, Object.keys(G), gates)]; } catch (e) { fail(`list ${r}`, e); return []; } });
const plan = upkeepPlan(repos, G, gates);

for (const a of plan.actions) {
  const what = `${a.do} ${a.repo}#${a.number}${a.why ? ` (${a.why})` : ''}`;
  if (!opts.apply) { console.log(`WOULD ${what}`); continue; }
  try { (a.do === 'merge' ? mergePR : updateBranch)(`${st.githubOwner}/${a.repo}`, a.number, a.sha); console.log(`DID   ${what}`); }
  catch (e) { fail(what, e); }
}
if (opts.digest) {
  const body = digestBody(plan, G, new Date().toISOString().slice(0, 10), gates), D = issueRef(st.digestIssue, st.githubOwner);
  if (!opts.apply) console.log(`WOULD digest:\n${body}`);
  else try { comment(`${st.githubOwner}/${D.repo}`, D.number, body); console.log('DID   digest'); } catch (e) { fail('digest', e); }
}
console.log(`${fails} failure(s)`);
process.exit(fails ? 1 : 0);
