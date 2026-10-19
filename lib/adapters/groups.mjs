// The working groups chartered in the programme repo: read here, never hard-coded.
import { srsCli, srs } from './cli.mjs';
import { ROLES } from '../practice/roles.mjs';
import { groupsFrom, centralGroupFrom } from '../practice/groups.mjs';

const rows = (p) => p.records ?? p.instances ?? [];

export function loadGroups(repo, cli = srsCli(repo)) {
  const S = (a) => srs(cli, repo, a);
  const roles = rows(S(['record', 'list', '--type', 'governance/role']));
  if (!roles.some((r) => r.record.fieldValues?.group_label)) return []; // a repository without the group fields has no groups
  return groupsFrom(roles, rows(S(['record', 'list', '--type', 'com.mudemocracy.stewardship/agent'])),
    S(['relation', 'list', '--type', 'com.mudemocracy.stewardship/authorised-by']).relations ?? [], S(['container', 'list']).containers,
    S(['relation', 'list', '--type', 'com.semanticops.method/holds-domain']).relations ?? []);
}

// The central group, found the way the session tool finds it: the role record titled ROLES.owner.roleTitle, named ROLES.owner.context.
export function loadCentralGroup(repo, cli = srsCli(repo)) {
  const S = (a) => srs(cli, repo, a), { roleTitle, context } = ROLES.owner;
  const role = rows(S(['record', 'list', '--type', 'governance/role'])).find((r) => r.record.fieldValues?.title === roleTitle);
  if (!role) throw new Error(`no governance role record titled "${roleTitle}" (the central group's authority)`);
  return centralGroupFrom(role, rows(S(['record', 'list', '--type', 'com.mudemocracy.stewardship/agent'])),
    S(['relation', 'list', '--type', 'com.mudemocracy.stewardship/authorised-by']).relations ?? [], context);
}
