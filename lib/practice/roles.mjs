// Role authority. A role is named with --as; an actor (SRS_ACTOR) may act for it only if it holds it.
// The owner is built in; every working group's roles and quorum are read from the repository's records (groups.mjs).
export const OWNER_LOG = 'SemanticOps decision log';

export const ROLES = { owner: { actor: null, roleTitle: 'Owner', logTitle: OWNER_LOG, context: 'SemanticOps' } };

// The group roles from the groups read out of the repository's records (adapters/groups.mjs): a member's role name is its actor id without "agent:".
// A group role attends as its own agent record, so quorum counts distinct members.
export const rolesFor = (groups = []) => ({ ...ROLES, ...Object.fromEntries(groups.flatMap((g) => g.members.map((m) =>
  [m.actor.replace(/^agent:/, ''), { actor: m.actor, roleId: g.roleId, agentId: m.agentId, logId: g.logId, context: g.title }]))) });

// -> the role's config, or throws naming the role and the actor. Human or AI: only the held role counts.
// ownerActor: the programme settings' owner_actor; the owner role has no actor of its own.
export function authorise(role, actorEnv, ownerActor, roles = ROLES) {
  const cfg = roles[role];
  if (!cfg) throw new Error(`unknown role "${role}" (known: ${Object.keys(roles).join(', ')})`);
  let actor; try { actor = JSON.parse(actorEnv); } catch { /* handled below */ }
  if (!actor?.id) throw new Error(`SRS_ACTOR must be a JSON actor {"kind","id"}; cannot act as ${role}`);
  const holder = cfg.actor ?? ownerActor;
  if (actor.id !== holder) throw new Error(`actor ${actor.id} does not hold the role "${role}" (held by ${holder})`);
  return cfg;
}

// Fill in ids that live in the repository: the Owner role record and the owner's log container.
export function resolveContext(cfg, roleRecords, containers) {
  const roleId = cfg.roleId ?? roleRecords.find((r) => r.record.fieldValues?.title === cfg.roleTitle)?.instanceId;
  const logId = cfg.logId ?? containers.find((c) => c.title === cfg.logTitle)?.containerId;
  if (!roleId) throw new Error(`no governance role record titled "${cfg.roleTitle}"`);
  if (!logId) throw new Error(`no container titled "${cfg.logTitle}"`);
  return { ...cfg, roleId, logId };
}

// Quorum, per context. A session may ratify or set aside only when its attendees meet the quorum of the context that owns the decision.
//   SemanticOps: the Owner role attends.
//   A working group: its charter's quorum ({min, seats, requiredSeat}, from the group role record): at least `min` distinct members holding a counting seat attend, one of them the required seat.
// attendees: [{id}]; role: a resolved context (roleId = the Owner role record for the owner context); groups: from loadGroups. -> { met, needs }
const WORDS = ['no', 'one', 'two', 'three', 'four'];
export function quorum(role, attendees, groups = []) {
  const ids = new Set(attendees.map((a) => a.id));
  const g = groups.find((x) => x.title === role.context);
  if (g) {
    const { min = 0, seats = [], requiredSeat } = g.quorum;
    const counting = g.members.filter((m) => seats.includes(m.role) && ids.has(m.agentId));
    const needs = [counting.length < min && `${WORDS[min] ?? min} distinct group members`,
      requiredSeat && !counting.some((m) => m.role === requiredSeat) && `the ${requiredSeat} agent`].filter(Boolean);
    return { met: !needs.length, needs: needs.join(' and ') };
  }
  return ids.has(role.roleId) ? { met: true, needs: '' } : { met: false, needs: 'the Owner role' };
}
export const quorumText = (q) => (q.met ? 'quorum: met' : `quorum: not met (needs ${q.needs})`);
