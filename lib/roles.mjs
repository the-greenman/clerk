// Role authority. A role is named with --as; an actor (SRS_ACTOR) may act for it only if it holds it.
// The mapping is a prototype: it belongs in the repository's own records once a role-holds-actor relation exists.
export const OWNER_LOG = 'SemanticOps decision log';
export const GROUP_LOG = 'f6db54e2-f554-4bd2-b985-e000a54542f4';
const GROUP_ROLE = '834b61fd-6385-4e7e-8c5f-8fe65718f65c';
const group = (name) => ({ actor: `agent:${name}`, roleId: GROUP_ROLE, logId: GROUP_LOG, context: 'WG Third-party ready' });

export const ROLES = {
  owner: { actor: 'human:the-greenman', roleTitle: 'Owner', logTitle: OWNER_LOG, context: 'SemanticOps' },
  'tpr-steward': group('tpr-steward'),
  'tpr-builder': group('tpr-builder'),
  'tpr-reviewer': group('tpr-reviewer'),
};

// -> the role's config, or throws naming the role and the actor. Human or AI: only the held role counts.
export function authorise(role, actorEnv) {
  const cfg = ROLES[role];
  if (!cfg) throw new Error(`unknown role "${role}" (known: ${Object.keys(ROLES).join(', ')})`);
  let actor; try { actor = JSON.parse(actorEnv); } catch { /* handled below */ }
  if (!actor?.id) throw new Error(`SRS_ACTOR must be a JSON actor {"kind","id"}; cannot act as ${role}`);
  if (actor.id !== cfg.actor) throw new Error(`actor ${actor.id} does not hold the role "${role}" (held by ${cfg.actor})`);
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
