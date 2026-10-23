#!/usr/bin/env node
// care: how confident the programme is in one work item, and the care mode its Confidence and care policy gives it.
//   node scripts/care.mjs <repo#n> [--repo <programme>] [--json]
// Read-only. The actor for the owner.directed signal is SRS_ACTOR (the session doing the work), as for clerk claim.
import { derive } from './roadmap.mjs';
import { repoRoot } from './lib/repo-arg.mjs';
import { srsCli } from '../lib/adapters/cli.mjs';
import { loadSettings } from '../lib/adapters/settings.mjs';
import { loadProgramme, parentChain } from '../lib/adapters/ground.mjs';
import { issueWithComments } from '../lib/adapters/github.mjs';
import { loadPolicy, loadProblemFacts } from '../lib/adapters/care-policy.mjs';
import { evaluate, itemFacts, epicOf, explain } from '../lib/practice/care-policy.mjs';

const argv = process.argv.slice(2);
try {
  const m = /^([\w.-]+)#(\d+)$/.exec(argv[0] ?? '');
  if (!m) throw new Error('usage: clerk care <repo#n> [--repo <programme>] [--json]');
  const repo = repoRoot(), cli = srsCli(repo), st = loadSettings(repo, cli), policy = loadPolicy(repo, cli, st);
  const { records, relations, affirmed, outlines } = loadProgramme(cli, repo);
  let epics; // an inactive period must not stop the explanation: epics are then read from the records, unranked
  try { epics = derive(records, relations, new Date().toISOString().slice(0, 10), affirmed, outlines).epics; }
  catch { epics = records.filter((r) => r.record.typeName === 'epic').map((r) => ({ refs: r.record.fieldValues.issue_ref, parked: true })); }
  const ref = `${m[1]}#${m[2]}`, issue = issueWithComments(`${st.githubOwner}/${m[1]}`, Number(m[2]));
  let actor; try { actor = JSON.parse(process.env.SRS_ACTOR ?? '').id; } catch { actor = undefined; }
  const epic = epicOf(epics, [ref, ...parentChain(st.githubOwner, m[1], Number(m[2])).map((p) => p.ref)]);
  const facts = itemFacts({ item: { body: issue.body, comments: issue.comments }, problems: loadProblemFacts(repo, cli), epic, actor, ownerActor: st.ownerActor });
  const result = evaluate(policy, facts);
  if (argv.includes('--json')) console.log(JSON.stringify({ ref, ...result, epic, answers: facts.answers }, null, 2));
  else console.log([`${ref}: ${issue.title}`, ...explain(policy, result)].join('\n'));
} catch (e) { console.error(`care: ${e.message}`); process.exit(1); }
