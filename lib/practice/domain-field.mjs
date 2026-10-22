// The domain field: every domain's focus, its boundary and the tensions that emerge from it, with both poles side by side
// and what rests on each. Pure. adapters/domain-field.mjs does the reading and the acts.
//
// Owner rulings 2026-10-22 (clerk#129, SP-98): a domain is just a boundary, two names for one thing, so a method domain and
// an argument boundary that trace to it are one context; a pole is judged only beside its partner, inside its domain, so a
// tension is affirmed together with both its poles, never a pole alone.
//
// A boundary derived-from a domain is merged into it. A boundary titled as a working group is that group's compass (the title
// match adapters/charter.mjs reads it by): a context of its own that serves the domains the group's role holds-domain.
// Any other boundary is a context of its own, marked untraced. Nesting: refines (domain) and narrows (boundary).
// A tension in no context has lost its context.
//
// Line: the Stance tension a tension's poles refine (Action, Change, Perspective; srs-context cc05d4c9). Two tensions on one
// line in one context are flagged, never judged: a duplicate in other words, or an inner/outer pair of the compass — the data
// does not record which, so the owner decides. Axes: the first three tensions in the domain container's outline.
import { canonOf } from './canon.mjs';

const tail = (t) => String(t).split('/').pop();

// input: records (`srs record list` entries), relations (`srs relation list`), containers ([{containerId, title, containerType,
// identityInstanceId, memberInstanceIds}], domain containers at least), affirmed / setAside (Sets of member ids), groups ([{title, domains}]).
export function domainField({ records, relations, containers = [], affirmed = new Set(), setAside = new Set(), groups = [] }) {
  const R = new Map(records.map((r) => [r.instanceId, r]));
  const typeName = (id) => R.get(id)?.record.typeName;
  // identity follows forks only (same type); a boundary derived-from a domain stays a boundary and traces to it below
  const forks = relations.filter((e) => tail(e.relationType) === 'derived-from' && typeName(e.sourceId) === typeName(e.targetId));
  const canon = canonOf(forks.map((e) => ({ ...e, relationType: 'derived-from' })));
  const family = new Map();
  for (const r of records) { const c = canon(r.instanceId); (family.get(c) ?? family.set(c, []).get(c)).push(r.instanceId); }
  const fam = (c) => family.get(c) ?? [c];
  const typeOf = (c) => R.get(fam(c)[0])?.record.typeName;
  const nsOf = (c) => R.get(fam(c)[0])?.record.typeNamespace;
  const state = (c) => (fam(c).some((x) => affirmed.has(x)) ? 'affirmed' : fam(c).some((x) => setAside.has(x)) ? 'set-aside' : 'suggested');
  // the copy that stands: the affirmed fork, else one not set aside, else any
  const standing = (c) => fam(c).find((x) => affirmed.has(x)) ?? fam(c).find((x) => !setAside.has(x)) ?? fam(c)[0];
  const f = (c) => R.get(standing(c))?.record.fieldValues ?? {};
  const title = (c) => f(c).title ?? f(c).statement ?? c.slice(0, 8);
  // edges between identities, whichever copy carries them; derived-from is identity, not an edge
  const out = new Map(), inn = new Map();
  for (const e of relations) {
    let t = tail(e.relationType);
    if (t === 'derived-from') { if (typeName(e.sourceId) === typeName(e.targetId)) continue; t = 'traces-to'; }
    const s = canon(e.sourceId), d = canon(e.targetId); if (s === d) continue;
    const add = (m, k, v) => { const x = m.get(k) ?? m.set(k, new Map()).get(k); (x.get(t) ?? x.set(t, new Set()).get(t)).add(v); };
    add(out, s, d); add(inn, d, s);
  }
  const o = (c, t) => [...(out.get(c)?.get(t) ?? [])], i = (c, t) => [...(inn.get(c)?.get(t) ?? [])];
  const ids = (pred) => [...family.keys()].filter(pred);
  const isBoundary = (c) => typeOf(c) === 'boundary' && nsOf(c) === 'com.mudemocracy.argument';
  const poles = (t) => o(t, 'contains').filter((p) => typeOf(p) === 'pole');
  const ref = (c) => ({ id: c, title: title(c), state: state(c) });

  // lines: the tensions whose poles other poles refine
  const lineOfPole = (p) => o(p, 'refines').map((q) => i(q, 'contains').find((t) => typeOf(t) === 'tension')).filter(Boolean);
  const lineIds = new Set(ids((c) => typeOf(c) === 'pole').flatMap(lineOfPole));
  const lineOf = (t) => {
    if (lineIds.has(t)) return { line: t, mixed: false };
    const ls = [...new Set(poles(t).flatMap(lineOfPole))];
    return { line: ls.length === 1 ? ls[0] : null, mixed: ls.length > 1 };
  };

  const tensionOf = (t, sources) => {
    const { line, mixed } = lineOf(t);
    return {
      ...ref(t), recordId: standing(t), description: f(t).description ?? '', sources, line: line ? ref(line) : null, mixedLine: mixed,
      principles: i(t, 'governs').filter((p) => typeOf(p) === 'principle').map((p) => ({ ...ref(p), leansToward: o(p, 'leans-toward')[0] ?? null })),
      poles: poles(t).map((p) => ({
        ...ref(p), recordId: standing(p), looks_like: f(p).looks_like ?? '', shadow: f(p).shadow ?? '',
        principles: i(p, 'leans-toward').filter((x) => typeOf(x) === 'principle').map(ref),
        problems: i(p, 'concerns').filter((x) => typeOf(x) === 'problem').map(ref),
        archetypes: i(p, 'leans-toward').filter((x) => typeOf(x) === 'archetype').map((x) => title(x)),
        refines: o(p, 'refines').map(ref),
      })),
    };
  };

  // contexts: one per domain identity; boundaries merge in by derived-from (canon) or by the group-title match
  const domains = ids((c) => typeOf(c) === 'domain');
  const boundaries = ids(isBoundary);
  // merged: a boundary derived-from a domain is that domain written down again (ruling 1)
  const mergedInto = new Map(boundaries.map((b) => [b, o(b, 'traces-to').find((d) => typeOf(d) === 'domain')]).filter(([, d]) => d));
  // serves: a group's compass boundary (titled as the group) serves the domains its role holds; it stays a context of its own
  const serves = new Map();
  for (const g of groups) for (const b of boundaries.filter((b) => title(b) === g.title && !mergedInto.has(b))) serves.set(b, { group: g.title, domains: (g.domains ?? []).map(canon) });
  const contexts = [];
  const make = (id, domain, bs, served = null) => {
    const box = domain && containers.find((k) => k.identityInstanceId && canon(k.identityInstanceId) === domain);
    const outline = (box?.memberInstanceIds ?? []).map((m) => (typeof m === 'string' ? m : m.instanceId));
    const src = new Map();
    const note = (t, s) => { if (typeOf(t) === 'tension') (src.get(t) ?? src.set(t, []).get(t)).push(s); };
    if (domain) for (const t of o(domain, 'contains')) note(t, 'contains');
    for (const m of outline) note(canon(m), 'outline');
    for (const b of bs) for (const t of o(b.id, 'holds-tension')) note(t, `holds-tension: ${title(b.id)}`);
    const tensions = [...src].map(([t, s]) => tensionOf(t, [...new Set(s)]));
    const axisIds = [...new Set(outline.map(canon).filter((c) => typeOf(c) === 'tension'))].slice(0, 3);
    const byLine = new Map();
    for (const t of tensions.filter((t) => t.line && t.state !== 'set-aside')) (byLine.get(t.line.id) ?? byLine.set(t.line.id, []).get(t.line.id)).push(t.id);
    contexts.push({
      id, title: domain ? title(domain) : title(bs[0].id), state: state(id),
      domain: domain ? { id: domain, recordId: standing(domain), purpose: f(domain).purpose ?? '', in_scope: f(domain).in_scope ?? '', out_of_scope: f(domain).out_of_scope ?? '' } : null,
      boundaries: bs.map((b) => ({ ...ref(b.id), how: b.how, purpose: f(b.id).purpose ?? '', inside: f(b.id).inside ?? '', outside: f(b.id).outside ?? '',
        authority_basis: f(b.id).authority_basis ?? '', revision_condition: f(b.id).revision_condition ?? '' })),
      serves: served ? { group: served.group, domains: served.domains.map(ref) } : null, parent: null, container: box?.containerId ?? null, outline, tensions,
      axes: axisIds.map((t) => tensions.find((x) => x.id === t) ?? tensionOf(t, ['outline'])).map((t) => ({ id: t.id, title: t.title, state: t.state })),
      sameLine: [...byLine].filter(([, ts]) => ts.length > 1).map(([line, ts]) => ({ line: ref(line), tensions: ts })),
    });
  };
  for (const d of domains) make(d, d, boundaries.filter((b) => mergedInto.get(b) === d).map((b) => ({ id: b, how: 'derived-from' })));
  for (const b of boundaries.filter((b) => !mergedInto.has(b)))
    make(b, null, [{ id: b, how: serves.has(b) ? `compass of ${serves.get(b).group}` : 'untraced' }], serves.get(b));
  // parents: a domain refines a domain; a boundary narrows a boundary (whichever context holds it)
  const ctxOf = (x) => contexts.find((c) => c.id === x || c.boundaries.some((b) => b.id === x));
  for (const c of contexts) {
    const up = [...(c.domain ? o(c.domain.id, 'refines') : []), ...c.boundaries.flatMap((b) => o(b.id, 'narrows'))].map(ctxOf).find((p) => p && p !== c);
    c.parent = up ? { id: up.id, title: up.title } : null;
  }
  const placed = new Set(contexts.flatMap((c) => c.tensions.map((t) => t.id)));
  const lost = ids((c) => typeOf(c) === 'tension' && !placed.has(c)).map((t) => tensionOf(t, []));
  return { contexts, lost, lines: [...lineIds].map(ref) };
}

// an id, or a prefix of at least 8 characters, of the identity or of the copy that stands
const is = (id, ...xs) => xs.some((x) => x && (x === id || (id.length >= 8 && x.startsWith(id))));
const findTension = (field, id) => [...field.contexts.flatMap((c) => c.tensions), ...field.lost].find((t) => is(id, t.id, t.recordId));

// A tension is affirmed with both its poles in one act. -> {ok, reasons, forks: record ids to fork, poles first}
export function canAffirmTension(field, id) {
  const t = findTension(field, id);
  if (!t) return { ok: false, reasons: [`${id}: not a tension`], forks: [] };
  const reasons = [];
  if (t.state === 'affirmed' && t.poles.every((p) => p.state === 'affirmed')) reasons.push(`${t.title} is already affirmed with both poles`);
  if (t.state === 'set-aside') reasons.push(`${t.title} is set aside; restore it first`);
  if (t.poles.length !== 2) reasons.push(`${t.title} has ${t.poles.length} poles, expected exactly 2`);
  const pending = (x) => x.state === 'suggested';
  return { ok: !reasons.length, reasons, tension: t.title, forks: [...t.poles.filter(pending), ...(pending(t) ? [t] : [])].map((x) => x.recordId) };
}

// Three distinct tensions of the context, each affirmed with both poles, become its axes in that order.
// -> {ok, reasons, container, identity, place: [{id, member, poles}]}: member is the outline entry to move, or null to add
export function canPlaceAxes(field, contextId, tensionIds) {
  const c = field.contexts.find((x) => is(contextId, x.id, x.domain?.recordId));
  if (!c) return { ok: false, reasons: [`${contextId}: not a domain context`], place: [] };
  const reasons = [];
  if (!c.domain) reasons.push(`${c.title} is a boundary with no domain record; give it one first`);
  if (tensionIds.length !== 3) reasons.push('name exactly three tensions');
  const place = tensionIds.map((id) => {
    const t = c.tensions.find((x) => is(id, x.id, x.recordId));
    if (!t) { reasons.push(`${id} is not a tension of ${c.title}`); return null; }
    if (t.state !== 'affirmed' || t.poles.length !== 2 || t.poles.some((p) => p.state !== 'affirmed')) reasons.push(`${t.title} is not affirmed with both poles`);
    const fam = new Set([t.id, t.recordId]);
    return { id: t.id, title: t.title, member: c.outline.find((m) => fam.has(m)) ?? null, record: t.recordId, poles: t.poles.map((p) => p.recordId) };
  }).filter(Boolean);
  if (new Set(place.map((p) => p.id)).size !== place.length) reasons.push('the three tensions must be distinct');
  return { ok: !reasons.length, reasons, context: c.title, container: c.container, identity: c.domain?.recordId ?? null, place };
}
