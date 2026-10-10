// Role authority. A role is named with --as; an actor (SRS_ACTOR) may act for it only if it holds it.
// The mapping is a prototype: it belongs in the repository's own records once a role-holds-actor relation exists.
export const OWNER_LOG = 'SemanticOps decision log';
export const GROUP_LOG = 'f6db54e2-f554-4bd2-b985-e000a54542f4';
export const GROUP_NAME = 'WG Third-party ready';
const GROUP_ROLE = '834b61fd-6385-4e7e-8c5f-8fe65718f65c';
// The group's member records (stewardship agents). A group role attends as its own agent record, so quorum counts distinct members.
export const GROUP_MEMBERS = { steward: '7f34b620-88e7-4981-a937-6a44f47f9096', builder: 'dd4177ef-29d3-4913-8f36-7cfbf6bafbf8', reviewer: '6e255308-8b50-4932-9ad1-ebfb42c7a474' };
const group = (name, agentId) => ({ actor: `agent:${name}`, roleId: GROUP_ROLE, agentId, logId: GROUP_LOG, context: GROUP_NAME });

export const ROLES = {
  owner: { actor: null, roleTitle: 'Owner', logTitle: OWNER_LOG, context: 'SemanticOps' },
  'tpr-steward': group('tpr-steward', GROUP_MEMBERS.steward),
  'tpr-builder': group('tpr-builder', GROUP_MEMBERS.builder),
  'tpr-reviewer': group('tpr-reviewer', GROUP_MEMBERS.reviewer),
};

// -> the role's config, or throws naming the role and the actor. Human or AI: only the held role counts.
// ownerActor: the programme settings' owner_actor; the owner role has no actor of its own.
export function authorise(role, actorEnv, ownerActor) {
  const cfg = ROLES[role];
  if (!cfg) throw new Error(`unknown role "${role}" (known: ${Object.keys(ROLES).join(', ')})`);
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

// Quorum, per context (prototype; belongs in the context's Membership and quorum standing order once that is data).
// A session may ratify or set aside only when its attendees meet the quorum of the context that owns the decision.
//   SemanticOps: the Owner role attends.
//   WG Third-party ready: at least two distinct member records attend, one of them the reviewer agent.
// attendees: [{id}]; role: a resolved context (roleId = the Owner role record for the owner context). -> { met, needs }
export function quorum(role, attendees) {
  const ids = new Set(attendees.map((a) => a.id));
  if (role.context === 'WG Third-party ready') {
    const members = Object.values(GROUP_MEMBERS).filter((m) => ids.has(m));
    const needs = [members.length < 2 && 'two distinct group members', !ids.has(GROUP_MEMBERS.reviewer) && 'the reviewer agent'].filter(Boolean);
    return { met: !needs.length, needs: needs.join(' and ') };
  }
  return ids.has(role.roleId) ? { met: true, needs: '' } : { met: false, needs: 'the Owner role' };
}
export const quorumText = (q) => (q.met ? 'quorum: met' : `quorum: not met (needs ${q.needs})`);
