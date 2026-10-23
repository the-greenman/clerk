#!/usr/bin/env node
// clerk claim <repo#n> --as <seat> [--repo <programme>] [--branch <name>] [--dry-run]: one claim path for humans and agents (clerk#21).
import { repoRoot } from './lib/repo-arg.mjs';
import { loadSettings } from '../lib/adapters/settings.mjs';
import { loadGroups, loadCentralGroup } from '../lib/adapters/groups.mjs';
import { affirmedProblemIds, readIssue, writeClaim } from '../lib/adapters/claim.mjs';
import { checkClaim, claimComment, claimAssigns } from '../lib/practice/claim.mjs';
import { loadWorkflow } from '../lib/adapters/workflow.mjs';

const argv = process.argv.slice(2), arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const fail = (m) => { console.error('claim: ' + m); process.exit(2); };
const m = /^([\w.-]+)#(\d+)$/.exec(argv[0] ?? ''), seat = arg('--as');
if (!m || !seat) fail('usage: clerk claim <repo#n> --as <seat> [--repo <programme>] [--branch <name>] [--dry-run]');
let actor; try { actor = JSON.parse(process.env.SRS_ACTOR ?? '').id; } catch { /* below */ }
if (!actor) fail('SRS_ACTOR must be a JSON actor, e.g. SRS_ACTOR=\'{"kind":"ai","id":"agent:<name>"}\' on the same command line');
const repo = repoRoot(), s = loadSettings(repo), W = loadWorkflow(repo), n = Number(m[2]);
const { issue, prs, branches } = readIssue(s.githubOwner, m[1], n);
const r = checkClaim({ issue, prs, branches, groups: loadGroups(repo), central: loadCentralGroup(repo), affirmed: affirmedProblemIds(repo), actor, seat, ownerActor: s.ownerActor, W });
const branch = arg('--branch') ?? `${n}-<slug>`, comment = r.group && claimComment(actor, seat, r.group.title, branch);
const dry = argv.includes('--dry-run');
for (const t of r.todo) console.log('todo: ' + t);
if (!r.ok) { console.error(`claim refused for ${m[1]}#${n}:\n` + r.reasons.map((x) => '  - ' + x).join('\n')); process.exit(2); }
console.log(`checks passed for ${m[1]}#${n} as ${seat} of ${r.group.title}`);
const assignee = claimAssigns(actor, s.ownerActor) ? s.githubOwner : null;
console.log(`${dry ? 'would' : 'will'}: ${assignee ? `assign ${assignee}` : `not assign (${actor} is not the owner's actor)`}; add label "${W.inProgress}"; comment: ${comment}`);
if (!dry) { writeClaim(s.githubOwner, m[1], n, assignee, comment, W.inProgress); console.log('claimed'); }
