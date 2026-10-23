// The Confidence and care policy's reads: the policy records in the container the settings name, and the facts its
// signals read about problems, through the pinned srs CLI. The rules are practice/care-policy.mjs.
import { srsCli, srs } from './cli.mjs';
import { loadSettings } from './settings.mjs';
import { policyFrom, checkPolicy, problemFacts, REL } from '../practice/care-policy.mjs';

const rows = (out) => out.records ?? out.instances ?? [];
const members = (cli, repo, id) => new Set(srs(cli, repo, ['container', 'get', id]).container.memberInstanceIds.map((m) => m.instanceId));

// -> the policy; throws with every reason when the settings name no policy or the clerk cannot act on it.
export function loadPolicy(repo, cli = srsCli(repo), settings = loadSettings(repo, cli)) {
  const id = settings.carePolicyContainer;
  if (!id) throw new Error('the programme settings name no care_policy_container (Confidence and care policy)');
  const policy = policyFrom({
    records: rows(srs(cli, repo, ['record', 'list', '--container', id])),
    relations: srs(cli, repo, ['relation', 'list']).relations.filter((r) => r.relationType === REL.grades || r.relationType === REL.selects),
    vocabularies: srs(cli, repo, ['vocabulary', 'list']).vocabularies,
  });
  const errs = checkPolicy(policy);
  if (errs.length) throw new Error(`the Confidence and care policy cannot be acted on:\n  ${errs.join('\n  ')}`);
  return { ...policy, containerId: id };
}

// -> problemFacts(): each problem_id's layer (Affirmed, Suggestions, Set aside by container title) and basis.
export function loadProblemFacts(repo, cli = srsCli(repo)) {
  const cs = srs(cli, repo, ['container', 'list']).containers;
  const layer = (title) => { const c = cs.find((x) => x.title === title); return c ? members(cli, repo, c.containerId) : new Set(); };
  return problemFacts(rows(srs(cli, repo, ['record', 'list', '--type', 'com.semanticops.method/problem'])),
    { affirmed: layer('Affirmed'), suggested: layer('Suggestions'), setAside: layer('Set aside') });
}
