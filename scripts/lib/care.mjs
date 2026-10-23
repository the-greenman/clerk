// The facts and verdict of the Confidence and care policy for one work item: shared by `clerk care` and `clerk claim`,
// so both read an item the same way. Script-level because it uses the roadmap derive (adapters never import scripts).
import { derive } from '../roadmap.mjs';
import { loadProgramme, parentChain } from '../../lib/adapters/ground.mjs';
import { issueWithComments } from '../../lib/adapters/github.mjs';
import { loadPolicy, loadProblemFacts } from '../../lib/adapters/care-policy.mjs';
import { loadGroups } from '../../lib/adapters/groups.mjs';
import { evaluate, itemFacts, epicOf } from '../../lib/practice/care-policy.mjs';

// -> {policy, issue, epic, facts, result} for <itemRepo>#<n>; throws when the policy cannot be acted on.
export function careFor(repo, cli, st, itemRepo, n) {
  const policy = loadPolicy(repo, cli, st);
  const { records, relations, affirmed, outlines } = loadProgramme(cli, repo);
  let epics; // an inactive period must not stop the reading: epics are then read from the records, unranked
  try { epics = derive(records, relations, new Date().toISOString().slice(0, 10), affirmed, outlines).epics; }
  catch { epics = records.filter((r) => r.record.typeName === 'epic').map((r) => ({ refs: r.record.fieldValues.issue_ref, parked: true })); }
  const ref = `${itemRepo}#${n}`, issue = issueWithComments(`${st.githubOwner}/${itemRepo}`, n);
  let actor; try { actor = JSON.parse(process.env.SRS_ACTOR ?? '').id; } catch { actor = undefined; }
  const epic = epicOf(epics, [ref, ...parentChain(st.githubOwner, itemRepo, n).map((p) => p.ref)]);
  const facts = itemFacts({ item: { body: issue.body, comments: issue.comments }, problems: loadProblemFacts(repo, cli), epic, actor, ownerActor: st.ownerActor,
    labels: issue.labels, repo: itemRepo, groups: loadGroups(repo, cli) });
  return { policy, issue, epic, facts, result: evaluate(policy, facts) };
}
