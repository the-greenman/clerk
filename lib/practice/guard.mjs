// The authority guard (SP-71): an act that is the owner's, or a group's, must carry its proof in the same change.
// A programme PR merges itself on green, so the proof cannot be a review. It is the act's own records: a session record and its
// relation, or a fork stamped with its creator (RFC-046 createdBy, which a request never supplies).
// Pure: it compares two snapshots (adapters/snapshot.mjs shape, with `by` on the relations that are new) and returns a verdict per act.
import { OWNER_LOG } from './roles.mjs';

const P = 'com.semanticops.programme/';
const AFFIRMED = 'Affirmed';
const SET_ASIDE = 'Set aside';
// Relation types whose creation is itself an authority act, and which of them a decision's state change answers to.
const SESSION_RELATIONS = { ratified: `${P}ratifies`, abandoned: `${P}sets-aside` };
const RECEIVES = `${P}receives`;
const AUTHORISED_BY = 'com.mudemocracy.stewardship/authorised-by';

const isDecision = (r) => r.type === 'decision' && /(^|\.)governance$/.test(r.ns ?? '');
const isSession = (r) => r.type === 'session' && r.ns === 'com.semanticops.programme';
const short = (id) => String(id).slice(0, 8);
const label = (r) => `${r.label ?? r.id} [${short(r.id)}]`;

// The actors who may act at the log that holds `recordId`: the owner for the SemanticOps log (and anything in no group's log),
// a group's session members for a group log. ownerActor is the settings' owner_actor.
function actorsAt(recordId, snap, settings, groups) {
  const homes = snap.containers.filter((c) => c.outline.some((m) => m.id === recordId));
  const group = groups.find((g) => homes.some((c) => c.id === g.logId));
  if (group && !homes.some((c) => c.title === OWNER_LOG)) return { who: `the ${group.title} group's members`, ids: group.members.map((m) => m.actor) };
  return { who: `the owner (${settings.ownerActor})`, ids: [settings.ownerActor] };
}

// before, after: { records:[{id,ns,type,state,by,label}], relations:[{id,type,s,t,by}], containers:[{id,title,outline:[{id}]}] }.
// -> [{ act, ref, proof, ok, why }]. `why` says what is missing when not ok, or what proved it when ok.
export function authorityActs(before, after, settings, groups = []) {
  const had = { rec: new Map(before.records.map((r) => [r.id, r])), rel: new Set(before.relations.map((r) => r.id)) };
  const byId = new Map(after.records.map((r) => [r.id, r]));
  const newRels = after.relations.filter((l) => !had.rel.has(l.id));
  const newSessions = new Set(after.records.filter((r) => isSession(r) && !had.rec.has(r.id)).map((r) => r.id));
  const owner = (by, human = false) => by?.id === settings.ownerActor && (!human || by.kind === 'human');
  const out = [];
  const act = (kind, ref, proof, ok, why) => out.push({ act: kind, ref, proof, ok, why });

  // A session record created here, with a new relation of this type to the target, made by an actor who may act at its log.
  const sessionProof = (target, relType) => {
    const rels = newRels.filter((l) => l.type === relType && l.t === target.id);
    if (!rels.length) return { ok: false, why: `no ${relType.replace(P, '')} relation to it is created in this change` };
    const from = rels.filter((l) => newSessions.has(l.s));
    if (!from.length) return { ok: false, why: `${relType.replace(P, '')} comes from no session record created in this change` };
    const { who, ids } = actorsAt(target.id, had.rec.has(target.id) ? before : after, settings, groups); // a change cannot move a record into a log it can act in
    const good = from.find((l) => ids.includes(l.by?.id));
    return good ? { ok: true, why: `session ${short(good.s)} ${relType.replace(P, '')} it, by ${good.by.id}` }
      : { ok: false, why: `the relation is made by ${from.map((l) => l.by?.id ?? 'no recorded actor').join(', ')}, not ${who}` };
  };

  for (const r of after.records) {
    const was = had.rec.get(r.id);
    if (isDecision(r) && SESSION_RELATIONS[r.state] && was?.state !== r.state) {
      const p = sessionProof(r, SESSION_RELATIONS[r.state]);
      act(r.state === 'ratified' ? 'ratify' : 'set aside', label(r), 'session record with a relation', p.ok, p.ok ? p.why : `becomes ${r.state}: ${p.why}`);
    }
  }
  // Affirmed and Set aside are found by their title in the base, so renaming one cannot hide it; a container new in the change by its own.
  const baseTitle = new Map(before.containers.map((c) => [c.id, c.title]));
  const home = (title) => after.containers.filter((c) => (baseTitle.get(c.id) ?? c.title) === title);
  const before_ = (c) => new Set((before.containers.find((x) => x.id === c.id)?.outline ?? []).map((m) => m.id));
  for (const c of home(AFFIRMED)) {
    const was = before_(c);
    for (const m of c.outline.filter((m) => !was.has(m.id))) {
      const r = byId.get(m.id); if (!r) continue;
      const ok = owner(r.by, true);
      act('affirm', label(r), 'a human fork by the owner', ok, ok ? `forked by ${r.by.id}` : `enters Affirmed but is created by ${r.by ? `${r.by.kind} ${r.by.id}` : 'no recorded actor'}, not the owner (${settings.ownerActor}, human)`);
    }
  }
  for (const c of home(SET_ASIDE)) {
    const was = before_(c);
    for (const m of c.outline.filter((m) => !was.has(m.id))) {
      const r = byId.get(m.id); if (!r) continue;
      const p = owner(r.by, true) ? { ok: true, why: `created by ${r.by.id}` } : sessionProof(r, SESSION_RELATIONS.abandoned);
      act('set aside', label(r), 'created by the owner, or a session sets-aside relation', p.ok, p.ok ? p.why : `moves to Set aside: it is created by ${r.by ? r.by.id : 'no recorded actor'}, and ${p.why}`);
    }
  }
  for (const l of newRels) {
    if (l.type === AUTHORISED_BY) {
      const ok = owner(l.by);
      act('authorise', `${short(l.s)} authorised-by ${short(l.t)}`, 'relation created by the owner', ok, ok ? `by ${l.by.id}` : `created by ${l.by ? l.by.id : 'no recorded actor'}, not the owner (${settings.ownerActor})`);
    } else if (l.type === RECEIVES) {
      const { who, ids } = actorsAt(l.s, after, settings, groups);
      const ok = newSessions.has(l.s) && ids.includes(l.by?.id);
      act('receive', `${short(l.s)} receives ${short(l.t)}`, 'session record created here, relation by an actor of its log', ok,
        ok ? `by ${l.by.id}` : !newSessions.has(l.s) ? 'receives comes from no session record created in this change' : `made by ${l.by?.id ?? 'no recorded actor'}, not ${who}`);
    }
  }
  return out;
}

export const unproven = (acts) => acts.filter((a) => !a.ok);

// A change that crosses a dataModelRevision cannot be read at its base by the pinned CLI (owner, clerk#191 A2): the guard skips it with a warning.
export const crossesRevision = (baseManifest, headManifest) => (baseManifest?.dataModelRevision ?? 0) !== (headManifest?.dataModelRevision ?? 0);
