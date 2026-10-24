#!/usr/bin/env node
// care: how confident the programme is in one work item, and the care mode its Confidence and care policy gives it.
//   clerk care <repo#n> [--repo <programme>] [--json]
// Read-only. The actor for the owner.directed signal is SRS_ACTOR (the session doing the work), as for clerk claim.
import { repoRoot } from './lib/repo-arg.mjs';
import { careFor } from './lib/care.mjs';
import { srsCli } from '../lib/adapters/cli.mjs';
import { loadSettings } from '../lib/adapters/settings.mjs';
import { explain } from '../lib/practice/care-policy.mjs';

const argv = process.argv.slice(2);
try {
  const m = /^([\w.-]+)#(\d+)$/.exec(argv[0] ?? '');
  if (!m) throw new Error('usage: clerk care <repo#n> [--repo <programme>] [--json]');
  const repo = repoRoot(), cli = srsCli(repo), st = loadSettings(repo, cli);
  if (!st.carePolicyContainer) throw new Error('the programme settings name no care_policy_container (Confidence and care policy)');
  const { policy, issue, epic, facts, result } = careFor(repo, cli, st, m[1], Number(m[2]));
  const ref = `${m[1]}#${m[2]}`;
  if (argv.includes('--json')) console.log(JSON.stringify({ ref, ...result, epic, answers: facts.answers }, null, 2));
  else console.log([`${ref}: ${issue.title}`, ...explain(policy, result)].join('\n'));
} catch (e) { console.error(`care: ${e.message}`); process.exit(1); }
