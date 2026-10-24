// The facts and verdict of the Confidence and care policy for one work item: shared by `clerk care` and `clerk claim`,
// so both read an item the same way. Script-level because it uses the roadmap derive (adapters never import scripts).
import { derive } from '../roadmap.mjs';
import { loadProgramme, parentChainRead } from '../../lib/adapters/ground.mjs';
import { issueWithComments } from '../../lib/adapters/github.mjs';
import { loadPolicy, loadProblemFacts } from '../../lib/adapters/care-policy.mjs';
import { loadGroups } from '../../lib/adapters/groups.mjs';
import { evaluate, itemFacts, epicOf } from '../../lib/practice/care-policy.mjs';

// What every reading shares, loaded once: a sweep over many items reuses it. -> {policy, epics, problems, groups}
// policy is null when the settings name no care policy: the facts are still read, only the mode is not.
export function careContext(repo, cli, st) {
  const policy = st.carePolicyContainer ? loadPolicy(repo, cli, st) : null;
  const { records, relations, affirmed, outlines } = loadProgramme(cli, repo);
  let epics; // an inactive period must not stop the reading: epics are then read from the records, unranked
  try { epics = derive(records, relations, new Date().toISOString().slice(0, 10), affirmed, outlines).epics; }
  catch { epics = records.filter((r) => r.record.typeName === 'epic').map((r) => ({ refs: r.record.fieldValues.issue_ref, parked: true })); }
  return { policy, epics, problems: loadProblemFacts(repo, cli), groups: loadGroups(repo, cli) };
}

// -> {policy, issue, epic, parents, parentsUnknown, facts, result} for <itemRepo>#<n>; throws when the policy cannot be acted on.
// listed: the issue's list row when a sweep already fetched it. result is null when there is no care policy.
export function careFor(repo, cli, st, itemRepo, n, ctx = careContext(repo, cli, st), listed = null) {
  const ref = `${itemRepo}#${n}`, issue = issueWithComments(`${st.githubOwner}/${itemRepo}`, n, listed);
  let actor; try { actor = JSON.parse(process.env.SRS_ACTOR ?? '').id; } catch { actor = undefined; }
  const chain = parentChainRead(st.githubOwner, itemRepo, n), parents = chain.parents.map((p) => p.ref);
  const epic = epicOf(ctx.epics, [ref, ...parents]);
  const facts = itemFacts({ item: { body: issue.body, comments: issue.comments }, problems: ctx.problems, epic, actor, ownerActor: st.ownerActor,
    labels: issue.labels, repo: itemRepo, groups: ctx.groups });
  return { policy: ctx.policy, issue, epic, parents, parentsUnknown: chain.unknown, facts, result: ctx.policy ? evaluate(ctx.policy, facts) : null };
}
