// Performs a charter plan (lib/practice/charter.mjs) through the srs CLI, as the acting SRS_ACTOR. Reads the existing groups, the owner log,
// the Suggestions container and the compass of the group it copies from; writes nothing when dry.
import { srs } from './cli.mjs';
import { loadGroups } from './groups.mjs';
import { planCharter } from '../practice/charter.mjs';

const rows = (p) => p.records ?? p.instances ?? [];

export function context(repo, cli, fromId) {
  const S = (a) => srs(cli, repo, a);
  const groups = loadGroups(repo, cli), containers = S(['container', 'list']).containers;
  const byTitle = (t) => containers.find((c) => c.title === t)?.containerId;
  const ownerLogId = byTitle('SemanticOps decision log') ?? (() => { throw new Error('no "SemanticOps decision log" container'); })();
  const from = fromId ? groups.find((g) => g.roleId.startsWith(fromId)) ?? (() => { throw new Error(`--from ${fromId}: no such group role`); })() : groups[0];
  let compass;
  if (from) { // the compass of the group copied from: what its boundary narrows and the tensions it holds
    const boundaries = rows(S(['record', 'list', '--type', 'com.mudemocracy.argument/boundary']));
    const b = boundaries.find((r) => r.record.fieldValues.title === from.title);
    const rel = (t) => (S(['relation', 'list', '--type', 'com.mudemocracy.argument/' + t]).relations ?? []).filter((r) => r.sourceId === b?.instanceId).map((r) => r.targetId);
    if (b) compass = { narrows: rel('narrows')[0], tensions: rel('holds-tension') };
  }
  const agents = rows(S(['record', 'list', '--type', 'com.mudemocracy.stewardship/agent']));
  return { groups, ownerLogId, compass, suggestionsId: byTitle('Suggestions'), existingActors: agents.map((a) => a.record.fieldValues.actor_id).filter(Boolean),
    containerTitles: containers.map((c) => c.title) };
}

export function charter(repo, cli, options, { dryRun = false, from } = {}) {
  const ctx = context(repo, cli, from);
  if (ctx.containerTitles.includes(options.title)) throw new Error(`clerk charter: a container titled "${options.title}" already exists`);
  const plan = planCharter(options, ctx);
  if (dryRun) return { plan, done: [] };
  const S = (a, i) => srs(cli, repo, a, i), ids = {}, done = [];
  const id = (r) => (r?.startsWith('@') ? ids[r.slice(1)] ?? ({ suggestions: ctx.suggestionsId }[r.slice(1)]) : r);
  for (const w of plan.writes) {
    if (w.op === 'create') {
      const args = ['record', 'create', ...(w.container ? ['--container', id(w.container)] : []), '--type', w.type];
      const p = S(args, { fieldValues: w.fieldValues }), r = p.record ?? p.instance ?? p;
      ids[w.ref] = r.instanceId ?? r.id;
      done.push(`${w.type} ${ids[w.ref]} ${w.fieldValues.title ?? ''}`);
    } else if (w.op === 'container') {
      const p = S(['container', 'create'], { title: w.title, namespace: 'com.semanticops.programme', name: w.name, description: w.description,
        identityInstanceId: id(w.identity), anchorInstanceId: id(w.identity), memberInstanceIds: [{ instanceId: id(w.identity) }] });
      ids[w.ref] = (p.container ?? p).containerId;
      done.push(`container ${ids[w.ref]} ${w.title}`);
    } else if (w.op === 'transition') { S(['record', 'transition', '--id', id('@' + w.ref)], { to: w.to }); done.push(`transition ${ids[w.ref]} -> ${w.to}`); }
    else if (w.op === 'member') { S(['container', 'members', 'add', w.container, id('@' + w.ref)]); done.push(`member ${ids[w.ref]} also in ${w.container}`); }
    else if (w.op === 'relate') { S(['relation', 'create'], { relationType: w.type, sourceInstanceId: id(w.source), targetInstanceId: id(w.target) }); done.push(`${w.type} ${id(w.source)} -> ${id(w.target)}`); }
  }
  return { plan, done, ids };
}
