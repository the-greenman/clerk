// The programme as one snapshot: records with their field values, relations, and containers with their ordered outlines.
// Reads only through the srs CLI (tool-first rule); no judgement here. Lifted from srs-lab control-room/extract/programme.mjs.
// ponytail: one `container get` per container; srs-rust#1415 (a whole-graph read) replaces the loop with one call.
import { srs as srsDefault } from './cli.mjs';

// long text is trimmed: the snapshot is for reading, not editing
const trim = (v) => (typeof v === 'string' ? v.slice(0, 2000) : v);

export function programmeSnapshot(cli, repo, { srs = srsDefault, now = () => new Date().toISOString() } = {}) {
  const call = (...args) => srs(cli, repo, args);
  const records = call('record', 'list').records.map(({ instanceId, displayLabel, record: r }) => ({
    id: instanceId, label: displayLabel ?? null, ns: r.typeNamespace, type: r.typeName, state: r.lifecycleState ?? null,
    createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? r.createdAt ?? null, by: r.createdBy ?? null, tags: r.tags ?? [],
    f: Object.fromEntries(Object.entries(r.fieldValues ?? {}).map(([k, v]) => [k, trim(v)])),
  }));
  const containers = call('container', 'list').containers.map(({ containerId, title }) => {
    const c = call('container', 'get', containerId).container;
    return {
      id: containerId, title, anchor: c.anchorInstanceId ?? null, identity: c.identityInstanceId ?? null,
      outline: (c.memberInstanceIds ?? []).map((m) => (typeof m === 'string' ? { id: m, depth: 0 } : { id: m.instanceId, depth: m.depth ?? 0 })),
    };
  });
  const relations = call('relation', 'list').relations.map((l) => ({ id: l.relationId, type: l.relationType, s: l.sourceId, t: l.targetId }));
  const { repository } = call('repo', 'map').repoMap;
  return { extractedAt: now(), repo, repository, records, relations, containers };
}
