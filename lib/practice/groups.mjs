// A working group's charter, from parsed records: pure. A group is a governance/role record that has a group_label;
// its members are the stewardship agents authorised-by that role. adapters/groups.mjs does the reading.
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === '' ? [] : [v]);

// roles, agents: records [{instanceId, record}]; authorisedBy: relations [{sourceId, targetId}]; containers: [{containerId, title}].
// -> [{id, title, roleId, label, members:[{actor, role, agentId}], quorum:{min, seats, requiredSeat}, budget, cycleClose, maxUnacked, repos, logId}]
// holdsDomain: com.semanticops.method/holds-domain relations ({sourceId: role, targetId: domain}); a group's domains are its charter's (D15).
export function groupsFrom(roles, agents, authorisedBy, containers, holdsDomain = []) {
  return roles.filter((r) => r.record.fieldValues?.group_label).map((r) => {
    const f = r.record.fieldValues, mine = new Set(authorisedBy.filter((x) => x.targetId === r.instanceId).map((x) => x.sourceId));
    const logId = containers.find((c) => c.title === f.title)?.containerId;
    if (!logId) throw new Error(`working group "${f.title}" has no container with that title (its log)`);
    return {
      id: r.instanceId, title: f.title, roleId: r.instanceId, label: f.group_label, logId,
      members: agents.filter((a) => mine.has(a.instanceId) && a.record.fieldValues?.actor_id)
        .map((a) => ({ actor: a.record.fieldValues.actor_id, role: a.record.fieldValues.seat ?? '', agentId: a.instanceId })),
      quorum: { min: num(f.quorum_min_members) ?? 0, seats: list(f.quorum_seats), requiredSeat: f.quorum_required_seat || undefined },
      budget: num(f.budget_per_cycle), cycleClose: f.cycle_close_utc, maxUnacked: num(f.max_unacked_reports), repos: list(f.governed_repos),
      domains: holdsDomain.filter((x) => x.sourceId === r.instanceId).map((x) => x.targetId),
    };
  });
}

// The central group: the group of the role the session tool already calls "SemanticOps" (ROLES.owner in roles.mjs: the role record titled
// "Owner"). It has no label and no charter of its own; it does the work that falls within no working group's delegated authority.
// Members: agents authorised-by that role with actor_id + seat. Pure; not part of groupsFrom, so no chartered-group consumer sees it.
export function centralGroupFrom(centralRole, agents, authorisedBy, title) {
  const mine = new Set(authorisedBy.filter((x) => x.targetId === centralRole.instanceId).map((x) => x.sourceId));
  return { id: centralRole.instanceId, title, roleId: centralRole.instanceId, central: true,
    members: agents.filter((a) => mine.has(a.instanceId) && a.record.fieldValues?.actor_id)
      .map((a) => ({ actor: a.record.fieldValues.actor_id, role: a.record.fieldValues.seat ?? '', agentId: a.instanceId })) };
}
