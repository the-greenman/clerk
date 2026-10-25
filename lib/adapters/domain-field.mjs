// Reads the domain field (lib/practice/domain-field.mjs) through the srs CLI, and performs its two owner acts as the acting
// SRS_ACTOR: affirm a tension with both its poles; set or unset a domain's axis (decision cdd272a3). Writes nothing when dry.
import { srs } from './cli.mjs';
import { loadGroups } from './groups.mjs';
import { domainField, canAffirmTension, canSetAxis, canUnsetAxis } from '../practice/domain-field.mjs';

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
  if (check.repoint) {
    const rels = S(['relation', 'list']).relations;
    plan.forEach((a, i) => {
      for (const r of rels.filter((x) => x.relationType === 'contains' && x.sourceId === check.tensionId && x.targetId === a[2])) {
        S(['relation', 'delete', r.relationId]);
        S(['relation', 'create'], { relationType: 'contains', sourceInstanceId: check.tensionId, targetInstanceId: done[i] });
      }
    });
  }
  if (reason) {
    const c = S(['record', 'create', '--type', 'com.semanticops.comments/comment'], { fieldValues: { comment_text: `Affirmed with both poles: ${reason}` } });
    const cid = (c.record ?? c).instanceId;
    S(['relation', 'create'], { relationType: 'com.semanticops.comments/comments-on', sourceInstanceId: cid, targetInstanceId: done.at(-1) });
    done.push(cid);
  }
  return { plan, done };
}

const M = 'com.semanticops.method';
const relate = (type, s, t) => ['relation', 'create', { relationType: type, sourceInstanceId: s, targetInstanceId: t }];

// -> {plan, done}. Forks an agent's suggestion for this domain and tension into Affirmed (re-pointing its yang-pole and line
// when the owner chose differently), or creates the axis in Affirmed with its refines, in-domain and yang-pole.
export function setAxis(repo, cli, contextId, tensionId, { line, yang, reason, dryRun = false } = {}) {
  const check = canSetAxis(loadField(repo, cli), contextId, tensionId, line, yang);
  if (!check.ok) throw new Error(check.reasons.join('; '));
  const S = (a, i) => srs(cli, repo, a, i), into = containerId(S, 'Affirmed'), plan = [];
  if (check.suggestion) {
    const sug = check.suggestion.recordId;
    plan.push(['record', 'fork', sug, '--into', into, '--carry-relations', 'outgoing']);
    if (!check.suggestion.sameLine) plan.push(['record', 'update', '@axis', { fieldValues: { ...S(['record', 'get', sug]).record.fieldValues, line: check.line } }]);
    // the fork carried the suggestion's yang-pole (re-pointed to the pole's fork when there is one): replace it
    if (!check.suggestion.sameYang) plan.push(['drop-yang'], relate(`${M}/yang-pole`, '@axis', check.yang));
  } else {
    plan.push(['record', 'create', '--container', into, '--type', `${M}/axis-in-domain`, { fieldValues: { title: check.title, line: check.line } }],
      relate('refines', '@axis', check.tension), relate(`${M}/in-domain`, '@axis', check.domain), relate(`${M}/yang-pole`, '@axis', check.yang));
  }
  if (reason) plan.push(['record', 'create', '--type', 'com.semanticops.comments/comment', { fieldValues: { comment_text: `Axis ${check.line} of ${check.domainTitle}: ${reason}` } }],
    ['relation', 'create', { relationType: 'com.semanticops.comments/comments-on', sourceInstanceId: '@made', targetInstanceId: '@axis' }]);
  if (dryRun) return { plan, done: [] };
  let axis = null, made = null;
  const sub = (x) => JSON.parse(JSON.stringify(x).replaceAll('"@axis"', JSON.stringify(axis)).replaceAll('"@made"', JSON.stringify(made)));
  for (const step of plan) {
    if (step[0] === 'drop-yang') {
      for (const r of S(['relation', 'list']).relations.filter((x) => x.sourceId === axis && x.relationType === `${M}/yang-pole`)) S(['relation', 'delete', r.relationId]);
      continue;
    }
    const args = step.filter((x) => typeof x === 'string').map((x) => (x === '@axis' ? axis : x)), input = step.find((x) => typeof x === 'object');
    const p = S(args, input && sub(input));
    const id = p.forks?.[0]?.forkId ?? p.forks?.[0]?.instanceId ?? p.fork?.instanceId ?? p.record?.instanceId ?? p.instanceId;
    if (args[0] === 'record' && (args[1] === 'fork' || args[1] === 'create')) { made = id; axis ??= id; }
  }
  return { plan, done: [axis] };
}

// -> {plan, done}. The owner's axis leaves Affirmed for Set aside (a human layer, so the record itself moves).
export function unsetAxis(repo, cli, axisId, { reason, dryRun = false } = {}) {
  const check = canUnsetAxis(loadField(repo, cli), axisId);
  if (!check.ok) throw new Error(check.reasons.join('; '));
  const S = (a, i) => srs(cli, repo, a, i), r = check.recordId;
  const plan = [['container', 'members', 'remove', containerId(S, 'Affirmed'), r], ['container', 'members', 'add', containerId(S, 'Set aside'), r]];
  if (reason) plan.push(['record', 'create', '--type', 'com.semanticops.comments/comment', { fieldValues: { comment_text: `Axis unset: ${reason}` } }],
    ['relation', 'create', { relationType: 'com.semanticops.comments/comments-on', sourceInstanceId: '@made', targetInstanceId: r }]);
  if (dryRun) return { plan, done: [] };
  let made = null;
  for (const step of plan) {
    const input = step.find((x) => typeof x === 'object');
    const p = S(step.filter((x) => typeof x === 'string'), input && JSON.parse(JSON.stringify(input).replaceAll('"@made"', JSON.stringify(made))));
    made = p.record?.instanceId ?? p.instanceId ?? made;
  }
  return { plan, done: [r] };
}
