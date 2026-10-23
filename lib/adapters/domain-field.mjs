// Reads the domain field (lib/practice/domain-field.mjs) through the srs CLI, and performs its two owner acts as the acting
// SRS_ACTOR: affirm a tension with both its poles, place three tensions as a domain's axes. Writes nothing when dry.
import { srs } from './cli.mjs';
import { loadGroups } from './groups.mjs';
import { domainField, canAffirmTension, canPlaceAxes } from '../practice/domain-field.mjs';

const rows = (p) => p.records ?? p.instances ?? [];

export function loadField(repo, cli) {
  const S = (a) => srs(cli, repo, a);
  const list = S(['container', 'list']).containers;
  const get = (c) => S(['container', 'get', c.containerId]).container;
  const layer = (t) => { const c = list.find((x) => x.title === t); return new Set(c ? get(c).memberInstanceIds.map((m) => m.instanceId) : []); };
  const containers = list.filter((c) => c.containerType === 'domain' || c.title.startsWith('Domain: ')).map(get);
  return domainField({ records: rows(S(['record', 'list'])), relations: S(['relation', 'list']).relations, containers,
    affirmed: layer('Affirmed'), setAside: layer('Set aside'), groups: loadGroups(repo, cli) });
}

const containerId = (S, title) => S(['container', 'list']).containers.find((c) => c.title === title)?.containerId;

// -> {plan, done}. Poles fork first, so the tension's carried contains re-points to their forks (srs-rust#1377).
export function affirmTension(repo, cli, id, { reason, dryRun = false } = {}) {
  const check = canAffirmTension(loadField(repo, cli), id);
  if (!check.ok) throw new Error(check.reasons.join('; '));
  const S = (a, i) => srs(cli, repo, a, i), into = containerId(S, 'Affirmed');
  const plan = check.forks.map((r) => ['record', 'fork', r, '--into', into, '--carry-relations', 'outgoing']);
  if (dryRun) return { plan, done: [] };
  const done = plan.map((a) => { const p = S(a); return p.forks?.[0]?.forkId ?? p.forks?.[0]?.instanceId ?? p.fork?.instanceId ?? a[2]; });
  if (reason) {
    const c = S(['record', 'create', '--type', 'com.semanticops.comments/comment'], { fieldValues: { comment_text: `Affirmed with both poles: ${reason}` } });
    const cid = (c.record ?? c).instanceId;
    S(['relation', 'create'], { relationType: 'com.semanticops.comments/comments-on', sourceInstanceId: cid, targetInstanceId: done.at(-1) });
    done.push(cid);
  }
  return { plan, done };
}

// -> {plan, done}. The domain container is created when missing (identity = the domain record, D2a). Each axis is placed right
// after the identity entry, third first, so they end up first, second, third; a tension not yet in the outline comes with its poles.
export function placeAxes(repo, cli, contextId, tensionIds, { dryRun = false } = {}) {
  const check = canPlaceAxes(loadField(repo, cli), contextId, tensionIds);
  if (!check.ok) throw new Error(check.reasons.join('; '));
  const S = (a, i) => srs(cli, repo, a, i);
  const plan = [];
  const box = check.container ?? '@new';
  if (!check.container) plan.push(['container', 'create', { title: `Domain: ${check.context}`, containerType: 'domain', identityInstanceId: check.identity,
    anchorInstanceId: check.identity, memberInstanceIds: [{ instanceId: check.identity }] }]);
  for (const a of [...check.place].reverse()) {
    if (a.member) plan.push(['container', 'members', 'move', box, a.member, '--after', check.identity]);
    else {
      plan.push(['container', 'members', 'add', box, a.record, '--after', check.identity]);
      for (const p of [...a.poles].reverse()) plan.push(['container', 'members', 'add', box, p, '--into', a.record]);
    }
  }
  if (dryRun) return { plan, done: [] };
  let made = check.container;
  for (const step of plan) {
    if (step[1] === 'create') { const p = S(['container', 'create'], step[2]); made = (p.container ?? p).containerId; continue; }
    S(step.map((x) => (x === '@new' ? made : x)));
  }
  return { plan, done: [made] };
}
